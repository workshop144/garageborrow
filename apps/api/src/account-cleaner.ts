// Account-cleaner Lambda: runs nightly @ 07:00 UTC (≈3am ET). Two jobs:
//
//   1. Hard-delete users whose deleted_at is older than 30 days. For each
//      such user, drop the per-tenant USER and MEMBER records and the user
//      partition, then replace every remaining occurrence of their phone in
//      the table (any attribute, nested snapshots such as audit before/after,
//      and keys such as waitlist sort keys) with a random pseudonym, and
//      remove the Cognito identity. The pseudonym is not derived from the
//      phone, so retained history cannot be re-linked by hashing a number.
//      Before anything is deleted, a pending-scrub row records the phone and
//      its pseudonym; it is removed only once the scrub and the Cognito delete
//      both finished, so an interrupted or partial run resumes the next night.
//
//   2. Reset the per-day notifications_sent_today counter on every user
//      record. The counter resets at user-local midnight; running this at
//      03:00 ET is "close enough" for our single-tenant MVP.
//
// We intentionally don't try to reuse the api Lambda's repo functions for
// the cross-entity scrubbing — the repo layer is shaped for one-record-at-
// a-time access and we want a single Scan + bulk update here.

import { randomBytes } from "node:crypto";

import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { ddb } from "./lib/ddb.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { rewriteRow, type Row } from "./lib/row-rewrite.js";
import { initSentry } from "./lib/sentry.js";
import type { User } from "@garageborrow/shared";

initSentry();

const THIRTY_DAYS_MS = 30 * 24 * 3600_000;

let cachedCognito: CognitoIdentityProviderClient | undefined;

function cognito(): CognitoIdentityProviderClient {
  if (!cachedCognito) cachedCognito = new CognitoIdentityProviderClient({ region: env.region() });
  return cachedCognito;
}

export function setCognitoClient(c: CognitoIdentityProviderClient | undefined): void {
  cachedCognito = c;
}

// Random, never derived from the phone: an unkeyed hash of a phone number can
// be recomputed by anyone who knows (or enumerates) the number. 12 hex chars is
// plenty of collision space at our scale and fits ordinary display widgets.
export function newPseudonym(): string {
  return `deleted-user-${randomBytes(6).toString("hex")}`;
}

// Durable hard-delete work queue: one row per phone still being scrubbed. It
// holds the raw phone only until the scrub completes, and the scrub skips it.
export const PENDING_SCRUB_PK = "CLEANER#PENDING";

interface PendingScrub {
  PK: string;
  SK: string;
  phone: string;
  pseudonym: string;
  created_at: string;
}

async function ensurePendingScrub(phone: string, now: Date): Promise<void> {
  try {
    await ddb().send(
      new PutCommand({
        TableName: env.tableName(),
        Item: {
          PK: PENDING_SCRUB_PK,
          SK: `PHONE#${phone}`,
          phone,
          pseudonym: newPseudonym(),
          created_at: now.toISOString(),
        } satisfies PendingScrub,
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (err) {
    // Already queued by an earlier run: keep its pseudonym so every row of
    // this user ends up under the same one.
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
  }
}

async function listPendingScrubs(): Promise<PendingScrub[]> {
  const out: PendingScrub[] = [];
  let last: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: env.tableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": PENDING_SCRUB_PK },
        ConsistentRead: true,
        ...(last ? { ExclusiveStartKey: last } : {}),
      }),
    );
    out.push(...((r.Items ?? []) as PendingScrub[]));
    last = r.LastEvaluatedKey;
  } while (last);
  return out;
}

export async function getPendingScrub(phone: string): Promise<PendingScrub | undefined> {
  const r = await ddb().send(
    new GetCommand({
      TableName: env.tableName(),
      Key: { PK: PENDING_SCRUB_PK, SK: `PHONE#${phone}` },
      ConsistentRead: true,
    }),
  );
  return r.Item as PendingScrub | undefined;
}

async function scanAll(opts: {
  filterExpression?: string;
  expressionAttributeValues?: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
}): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let last: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new ScanCommand({
        TableName: env.tableName(),
        ...(opts.filterExpression ? { FilterExpression: opts.filterExpression } : {}),
        ...(opts.expressionAttributeValues
          ? { ExpressionAttributeValues: opts.expressionAttributeValues }
          : {}),
        ...(opts.expressionAttributeNames
          ? { ExpressionAttributeNames: opts.expressionAttributeNames }
          : {}),
        ...(last ? { ExclusiveStartKey: last } : {}),
      }),
    );
    if (r.Items) out.push(...r.Items);
    last = r.LastEvaluatedKey;
  } while (last);
  return out;
}

interface DeleteCounts {
  hard_deleted_users: number;
  records_anonymized: number;
  counters_reset: number;
}

export async function runCleanup(now: Date): Promise<DeleteCounts> {
  const counts: DeleteCounts = {
    hard_deleted_users: 0,
    records_anonymized: 0,
    counters_reset: 0,
  };

  // Job 1: hard-delete past-30d soft-deleted users.
  const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
  const usersToDelete = await scanAll({
    filterExpression:
      "begins_with(PK, :tenant) AND begins_with(SK, :user) AND attribute_exists(deleted_at) AND deleted_at < :cutoff",
    expressionAttributeValues: {
      ":tenant": "TENANT#",
      ":user": "USER#",
      ":cutoff": cutoff,
    },
  });

  // Group by phone so we run the per-user cleanup once even when the user
  // appears across multiple tenant partitions.
  const byPhone = new Map<string, { user: User; pks: string[] }>();
  for (const item of usersToDelete) {
    const u = item as User & { PK?: string };
    const phone = u.phone;
    if (!phone) continue;
    const entry = byPhone.get(phone) ?? { user: u, pks: [] };
    if (u.PK) entry.pks.push(u.PK);
    entry.user = u;
    byPhone.set(phone, entry);
  }

  // Queue every due phone before touching its rows: deleting the USER rows
  // destroys the selector above, so the queue is what lets a failed or timed
  // out scrub resume on the next run.
  for (const phone of byPhone.keys()) await ensurePendingScrub(phone, now);

  for (const pending of await listPendingScrubs()) {
    const phone = pending.phone;
    try {
      await deleteUserRecords(phone, byPhone.get(phone)?.pks ?? []);
      const scrub = await anonymizeAcrossEntities(phone, pending.pseudonym);
      counts.records_anonymized += scrub.written;
      const cognitoGone = await deleteCognitoUser(phone);
      if (scrub.complete && cognitoGone) {
        await ddb().send(
          new DeleteCommand({
            TableName: env.tableName(),
            Key: { PK: pending.PK, SK: pending.SK },
          }),
        );
        counts.hard_deleted_users++;
        logger.info({ count: scrub.written }, "cleaner_hard_deleted_user");
      } else {
        logger.error(
          { scrub_complete: scrub.complete, cognito_deleted: cognitoGone },
          "cleaner_hard_delete_incomplete_will_retry",
        );
      }
    } catch (err) {
      // Leave the pending row: the next run resumes this phone.
      logger.error({ err }, "cleaner_hard_delete_failed_will_retry");
    }
  }

  // Job 2: reset notifications_sent_today on every user record.
  const allUsers = await scanAll({
    filterExpression: "begins_with(PK, :tenant) AND begins_with(SK, :user)",
    expressionAttributeValues: {
      ":tenant": "TENANT#",
      ":user": "USER#",
    },
  });
  for (const u of allUsers) {
    const item = u as User & { PK: string; SK: string; notifications_sent_today?: number };
    if (!item.notifications_sent_today) continue;
    // Touch only the counter: a whole-item put of the Scan snapshot would revert
    // profile edits made since, and recreate a row deleted meanwhile.
    try {
      await ddb().send(
        new UpdateCommand({
          TableName: env.tableName(),
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: "SET notifications_sent_today = :zero",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":zero": 0 },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
      continue;
    }
    counts.counters_reset++;
  }

  return counts;
}

// Matches the phone as stored ("+15555550100") and percent-encoded the way it
// appears in request paths the audit log recorded ("%2B15555550100"). The
// digit guard keeps a shorter number from matching inside a longer one.
function phonePattern(phone: string): RegExp {
  if (/^\+\d+$/.test(phone)) return new RegExp(`(?:\\+|%2[Bb])${phone.slice(1)}(?!\\d)`, "g");
  return new RegExp(`${phone.replace(/[^\d]/g, (ch) => `\\${ch}`)}(?!\\d)`, "g");
}

export function mentionsPhone(value: unknown, phone: string): boolean {
  return phonePattern(phone).test(JSON.stringify(value));
}

// Replaces the phone wherever it appears in a value: top-level attributes,
// nested snapshots (audit before/after), arrays, and composite keys.
export function scrubPhone(value: unknown, phone: string, replacement: string): unknown {
  if (typeof value === "string") {
    return value.replace(phonePattern(phone), replacement);
  }
  if (Array.isArray(value)) return value.map((v) => scrubPhone(v, phone, replacement));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubPhone(v, phone, replacement)]),
    );
  }
  return value;
}

async function anonymizeAcrossEntities(
  phone: string,
  replacement: string,
): Promise<{ written: number; complete: boolean }> {
  let n = 0;
  let complete = true;
  // Votes are dropped rather than kept under a pseudonym.
  const votes = await scanAll({
    filterExpression: "voter_phone = :p",
    expressionAttributeValues: { ":p": phone },
  });
  for (const v of votes) {
    const row = v as { PK: string; SK: string };
    await ddb().send(
      new DeleteCommand({ TableName: env.tableName(), Key: { PK: row.PK, SK: row.SK } }),
    );
    n++;
  }
  // Copies of the phone are not limited to the *_phone attributes: accepted
  // donations carry donated_by_phone, audit entries embed whole records (and
  // the request path, percent-encoded), and some sort keys (waitlist) contain
  // it. Walk the whole table, as the rest of this job does, and rewrite every
  // row that still mentions it. The Scan is a snapshot: rewriteRow writes only
  // the scrubbed attributes and only while they still hold the scanned values,
  // so an edit made mid-sweep is never reverted (it re-reads and scrubs the
  // current row instead).
  const rows = await scanAll({});
  for (const r of rows) {
    const snapshot = r as Row;
    if (snapshot.PK === PENDING_SCRUB_PK) continue;
    if (!mentionsPhone(snapshot, phone)) continue;
    const outcome = await rewriteRow({
      table: env.tableName(),
      snapshot,
      transform: (row) =>
        mentionsPhone(row, phone) ? (scrubPhone(row, phone, replacement) as Row) : null,
    });
    if (outcome === "written") n++;
    if (outcome === "gave_up") {
      // Five conflicting edits in a row: the pending row stays, so the next
      // run scrubs this phone again.
      complete = false;
      logger.error({ sk_prefix: snapshot.SK.split("#")[0] }, "cleaner_scrub_gave_up");
    }
  }
  return { written: n, complete };
}

async function deleteUserRecords(phone: string, pks: string[]): Promise<void> {
  // Delete the per-tenant user row and the per-tenant member row, plus any
  // user-partition records (notifications, push subs, dedup rows). We
  // batch these for the user partition; tenant partitions are deleted
  // individually since they may belong to different garages.
  for (const pk of pks) {
    await ddb().send(
      new DeleteCommand({
        TableName: env.tableName(),
        Key: { PK: pk, SK: `USER#${phone}` },
      }),
    );
    await ddb().send(
      new DeleteCommand({
        TableName: env.tableName(),
        Key: { PK: pk, SK: `MEMBER#${phone}` },
      }),
    );
  }
  await deleteUserPartition(phone);
}

async function deleteUserPartition(phone: string): Promise<void> {
  const items = await scanAll({
    filterExpression: "PK = :pk",
    expressionAttributeValues: { ":pk": `USER#${phone}` },
  });
  // BatchWrite supports up to 25 deletes per batch.
  for (let i = 0; i < items.length; i += 25) {
    const slice = items.slice(i, i + 25);
    await ddb().send(
      new BatchWriteCommand({
        RequestItems: {
          [env.tableName()]: slice.map((row) => ({
            DeleteRequest: {
              Key: { PK: (row as { PK: string }).PK, SK: (row as { SK: string }).SK },
            },
          })),
        },
      }),
    );
  }
}

// True once the Cognito identity is gone (deleted now or already absent).
async function deleteCognitoUser(phone: string): Promise<boolean> {
  const userPoolId = env.userPoolId();
  if (!userPoolId) {
    logger.debug({}, "cleaner_no_user_pool_skipping_cognito");
    return true;
  }
  try {
    await cognito().send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: phone }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "UserNotFoundException") return true;
    logger.warn({ err }, "cleaner_cognito_delete_failed");
    return false;
  }
}

interface ScheduledEvent {
  source?: string;
}

export async function handler(_event: ScheduledEvent): Promise<DeleteCounts> {
  const result = await runCleanup(new Date());
  logger.info(result, "cleaner_summary");
  return result;
}
