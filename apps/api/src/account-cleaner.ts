// Account-cleaner Lambda: runs nightly @ 07:00 UTC (≈3am ET). Two jobs:
//
//   1. Hard-delete users whose deleted_at is older than 30 days. For each
//      such user, drop the per-tenant USER and MEMBER records and the user
//      partition, then replace every remaining occurrence of their phone in
//      the table (any attribute, nested snapshots such as audit before/after,
//      and keys such as waitlist sort keys) with a deterministic
//      SHA-256-prefixed pseudonym, and remove the Cognito identity.
//
//   2. Reset the per-day notifications_sent_today counter on every user
//      record. The counter resets at user-local midnight; running this at
//      03:00 ET is "close enough" for our single-tenant MVP.
//
// We intentionally don't try to reuse the api Lambda's repo functions for
// the cross-entity scrubbing — the repo layer is shaped for one-record-at-
// a-time access and we want a single Scan + bulk update here.

import { createHash } from "node:crypto";

import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  BatchWriteCommand,
  DeleteCommand,
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

export function pseudonymFor(phone: string): string {
  // 12-char prefix is enough collision-space for our scale and short enough
  // that the synthetic phone fits ordinary display widgets.
  return `deleted-user-${createHash("sha256").update(phone).digest("hex").slice(0, 12)}`;
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

  for (const [phone, entry] of byPhone) {
    await deleteUserRecords(phone, entry.pks);
    const anonymized = await anonymizeAcrossEntities(phone);
    counts.records_anonymized += anonymized;
    await deleteCognitoUser(phone);
    counts.hard_deleted_users++;
    logger.info({ count: anonymized }, "cleaner_hard_deleted_user");
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

// Replaces the phone wherever it appears in a value: top-level attributes,
// nested snapshots (audit before/after), arrays, and composite keys. The
// digit guard keeps a shorter number from matching inside a longer one.
export function scrubPhone(value: unknown, phone: string, replacement: string): unknown {
  if (typeof value === "string") {
    const re = new RegExp(`${phone.replace(/[^\d]/g, (ch) => `\\${ch}`)}(?!\\d)`, "g");
    return value.replace(re, replacement);
  }
  if (Array.isArray(value)) return value.map((v) => scrubPhone(v, phone, replacement));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubPhone(v, phone, replacement)]),
    );
  }
  return value;
}

async function anonymizeAcrossEntities(phone: string): Promise<number> {
  const replacement = pseudonymFor(phone);
  let n = 0;
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
  // donations carry donated_by_phone, audit entries embed whole records, and
  // some sort keys (waitlist) contain it. Walk the whole table, as the rest of
  // this job does, and rewrite every row that still mentions it. The Scan is a
  // snapshot: rewriteRow writes only the scrubbed attributes and only while they
  // still hold the scanned values, so an edit made mid-sweep is never reverted
  // (it re-reads and scrubs the current row instead).
  const rows = await scanAll({});
  for (const r of rows) {
    const snapshot = r as Row;
    if (!JSON.stringify(snapshot).includes(phone)) continue;
    const outcome = await rewriteRow({
      table: env.tableName(),
      snapshot,
      transform: (row) =>
        JSON.stringify(row).includes(phone) ? (scrubPhone(row, phone, replacement) as Row) : null,
    });
    if (outcome === "written") n++;
    if (outcome === "gave_up") {
      // Five conflicting edits in a row; the user rows are already gone, so a
      // later run will not revisit this phone. Surface it for a manual re-run.
      logger.error({ sk_prefix: snapshot.SK.split("#")[0] }, "cleaner_scrub_gave_up");
    }
  }
  return n;
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

async function deleteCognitoUser(phone: string): Promise<void> {
  const userPoolId = env.userPoolId();
  if (!userPoolId) {
    logger.debug({}, "cleaner_no_user_pool_skipping_cognito");
    return;
  }
  try {
    await cognito().send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: phone }));
  } catch (err) {
    logger.warn({ err }, "cleaner_cognito_delete_failed");
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
