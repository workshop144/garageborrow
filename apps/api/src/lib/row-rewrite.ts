// Rewrites one table row from a Scan snapshot without losing edits made since.
//
// A sweep (the nightly account cleaner, the photo-key migration) reads rows with
// a Scan and writes corrected copies later. A whole-item Put of the snapshot
// would silently revert anything a member changed in between. Instead:
//
//   - same key: SET only the attributes the transform changed, on condition
//     that each still holds the value the transform started from;
//   - key changes too (e.g. a waitlist sort key that embeds a phone): one
//     transaction deletes the old row, on condition that none of its
//     attributes changed, and creates the new row, on condition it is new.
//
// A failed condition means the row moved under us: re-read it and transform the
// current version, up to `maxAttempts` times.

import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./ddb.js";

export type Row = Record<string, unknown> & { PK: string; SK: string };

export type RewriteOutcome = "written" | "unchanged" | "gone" | "gave_up";

const KEY_ATTRS = new Set(["PK", "SK"]);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function isConflict(err: unknown): boolean {
  const name = (err as { name?: string }).name;
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

// "attribute_exists(PK) AND #a0 = :o0 AND ..." over the given attributes.
function unchangedCondition(
  row: Row,
  attrs: string[],
  names: Record<string, string>,
  values: Record<string, unknown>,
): string {
  const parts = ["attribute_exists(PK)"];
  attrs.forEach((attr, i) => {
    names[`#c${i}`] = attr;
    values[`:o${i}`] = row[attr];
    parts.push(`#c${i} = :o${i}`);
  });
  return parts.join(" AND ");
}

async function writeOnce(table: string, row: Row, next: Row): Promise<void> {
  if (next.PK === row.PK && next.SK === row.SK) {
    const changed = Object.keys(next).filter((a) => !KEY_ATTRS.has(a) && !same(row[a], next[a]));
    const removed = Object.keys(row).filter((a) => !KEY_ATTRS.has(a) && !(a in next));
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const condition = unchangedCondition(row, [...changed, ...removed], names, values);
    const sets = changed.map((attr, i) => {
      names[`#s${i}`] = attr;
      values[`:n${i}`] = next[attr];
      return `#s${i} = :n${i}`;
    });
    const removes = removed.map((attr, i) => {
      names[`#r${i}`] = attr;
      return `#r${i}`;
    });
    const clauses = [
      ...(sets.length ? [`SET ${sets.join(", ")}`] : []),
      ...(removes.length ? [`REMOVE ${removes.join(", ")}`] : []),
    ];
    await ddb().send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: clauses.join(" "),
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return;
  }
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const nonKey = Object.keys(row).filter((a) => !KEY_ATTRS.has(a));
  const condition = unchangedCondition(row, nonKey, names, values);
  await ddb().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: table,
            Key: { PK: row.PK, SK: row.SK },
            ConditionExpression: condition,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          },
        },
        {
          Put: { TableName: table, Item: next, ConditionExpression: "attribute_not_exists(PK)" },
        },
      ],
    }),
  );
}

export async function rewriteRow(opts: {
  table: string;
  snapshot: Row;
  // The corrected row, or null when this row needs no change.
  transform: (row: Row) => Row | null;
  maxAttempts?: number;
}): Promise<RewriteOutcome> {
  const attempts = opts.maxAttempts ?? 5;
  let row: Row | undefined = opts.snapshot;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const r = await ddb().send(
        new GetCommand({
          TableName: opts.table,
          Key: { PK: opts.snapshot.PK, SK: opts.snapshot.SK },
          ConsistentRead: true,
        }),
      );
      row = r.Item as Row | undefined;
    }
    if (!row) return "gone";
    const next = opts.transform(row);
    if (!next || same(next, row)) return "unchanged";
    try {
      await writeOnce(opts.table, row, next);
      return "written";
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  }
  return "gave_up";
}
