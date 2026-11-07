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
//   2. Reset the per-day notification counters (DAILY_COUNTERS) on every user
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
import { PENDING_SCRUB_PK, pendingScrubKey } from "./lib/pending-scrub.js";
import { DAILY_COUNTERS } from "./lib/spam-cap.js";
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
export { PENDING_SCRUB_PK };

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
          ...pendingScrubKey(phone),
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
      Key: pendingScrubKey(phone),
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

  // Job 2 runs first, in its own try: the 5/day spam cap depends on this
  // reset, so it must not wait on (or die with) the slow hard-delete job.
  try {
    const allUsers = await scanAll({
      filterExpression: "begins_with(PK, :tenant) AND begins_with(SK, :user)",
      expressionAttributeValues: {
        ":tenant": "TENANT#",
        ":user": "USER#",
      },
    });
    for (const u of allUsers) {
      const item = u as User & { PK: string; SK: string } & Record<string, unknown>;
      const set = DAILY_COUNTERS.filter((attr) => item[attr]);
      if (set.length === 0) continue;
      // Touch only the counters: a whole-item put of the Scan snapshot would revert
      // profile edits made since, and recreate a row deleted meanwhile.
      try {
        await ddb().send(
          new UpdateCommand({
            TableName: env.tableName(),
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: `SET ${set.map((_, i) => `#c${i} = :zero`).join(", ")}`,
            ConditionExpression: "attribute_exists(PK)",
            ExpressionAttributeNames: Object.fromEntries(set.map((a, i) => [`#c${i}`, a])),
            ExpressionAttributeValues: { ":zero": 0 },
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
        continue;
      }
      counts.counters_reset++;
    }
  } catch (err) {
    logger.error({ err }, "cleaner_counter_reset_failed");
  }

  // Job 1: hard-delete past-30d soft-deleted users.
  try {
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
        // The queue may be a day old (a run that timed out) or older than the
        // member's cancel: re-check the profiles before deleting anything
        // (2026-11-07 review F3).
        const due = await stillDueForDelete(phone, byPhone.get(phone)?.pks ?? [], cutoff);
        if (!due.due) {
          await ddb().send(
            new DeleteCommand({
              TableName: env.tableName(),
              Key: { PK: pending.PK, SK: pending.SK },
            }),
          );
          logger.info({}, "cleaner_pending_dropped_deletion_cancelled");
          continue;
        }
        await deleteUserRecords(phone, due.pks);
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
  } catch (err) {
    // The pending-scrub rows stay; the next run resumes.
    logger.error({ err }, "cleaner_hard_delete_job_failed");
  }

  return counts;
}

// Whether a queued phone should still be hard-deleted. Reads every profile row
// of the phone with ConsistentRead (the garages come from this run's Scan and
// the byUser index). Not due when a profile still exists and none of them
// carries a deleted_at older than the cutoff: the member cancelled (cancel
// clears deleted_at on every profile) or asked again recently. Due when every
// profile row is gone: an earlier run already deleted them and must finish
// the scrub.
async function stillDueForDelete(
  phone: string,
  knownPks: string[],
  cutoff: string,
): Promise<{ due: boolean; pks: string[] }> {
  const pks = new Set(knownPks);
  let last: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: env.tableName(),
        IndexName: "byUser",
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
        ExpressionAttributeValues: { ":pk": `USER#${phone}`, ":sk": "USER#" },
        ProjectionExpression: "PK",
        ...(last ? { ExclusiveStartKey: last } : {}),
      }),
    );
    for (const it of r.Items ?? []) {
      if (typeof it["PK"] === "string" && it["PK"].startsWith("TENANT#")) pks.add(it["PK"]);
    }
    last = r.LastEvaluatedKey;
  } while (last);
  const profiles: { deleted_at?: string }[] = [];
  for (const pk of pks) {
    const r = await ddb().send(
      new GetCommand({
        TableName: env.tableName(),
        Key: { PK: pk, SK: `USER#${phone}` },
        ConsistentRead: true,
      }),
    );
    if (r.Item) profiles.push(r.Item as { deleted_at?: string });
  }
  if (profiles.length === 0) return { due: true, pks: [...pks] };
  const due = profiles.some((p) => typeof p.deleted_at === "string" && p.deleted_at < cutoff);
  return { due, pks: [...pks] };
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
  // The partition is one key: Query it rather than Scan the whole table.
  const items: { PK: string; SK: string }[] = [];
  let last: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: env.tableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `USER#${phone}` },
        ProjectionExpression: "PK, SK",
        ...(last ? { ExclusiveStartKey: last } : {}),
      }),
    );
    items.push(...((r.Items ?? []) as { PK: string; SK: string }[]));
    last = r.LastEvaluatedKey;
  } while (last);
  // BatchWrite supports up to 25 deletes per batch.
  for (let i = 0; i < items.length; i += 25) {
    await batchWriteAll(
      items.slice(i, i + 25).map((row) => ({ DeleteRequest: { Key: { PK: row.PK, SK: row.SK } } })),
    );
  }
}

const BATCH_RETRY_ATTEMPTS = 8;

// BatchWrite may hand back UnprocessedItems (throttling) without failing;
// resend those with backoff until none are left, or throw so the pending
// scrub row stays and the next run finishes the job.
async function batchWriteAll(requests: Record<string, unknown>[]): Promise<void> {
  let pending = requests;
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt >= BATCH_RETRY_ATTEMPTS) {
      throw new Error(`BatchWrite left ${pending.length} items unprocessed`);
    }
    if (attempt > 0) await sleep(Math.min(50 * 2 ** attempt, 2000));
    const r = await ddb().send(
      new BatchWriteCommand({ RequestItems: { [env.tableName()]: pending } }),
    );
    pending = (r.UnprocessedItems?.[env.tableName()] ?? []) as Record<string, unknown>[];
  }
}

let sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Tests skip the backoff waits.
export function setCleanerSleepForTest(fn: ((ms: number) => Promise<void>) | undefined): void {
  sleep = fn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
