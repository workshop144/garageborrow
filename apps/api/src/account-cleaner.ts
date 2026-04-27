// Account-cleaner Lambda: runs nightly @ 07:00 UTC (≈3am ET). Two jobs:
//
//   1. Hard-delete users whose deleted_at is older than 30 days. For each
//      such user, walk every garage they belonged to and overwrite their
//      borrower / requester / donor / reporter phones in loans, reservations,
//      donations, waitlist entries, and incident reports with a deterministic
//      SHA-256-prefixed pseudonym. Then drop the per-tenant USER and MEMBER
//      records and remove the Cognito identity.
//
//   2. Reset the per-day notifications_sent_today counter on every user
//      record. The counter resets at user-local midnight; running this at
//      03:00 ET is "close enough" for our single-tenant New York MVP.
//
// We intentionally don't try to reuse the api Lambda's repo functions for
// the cross-entity scrubbing — the repo layer is shaped for one-record-at-
// a-time access and we want a single Scan + bulk update here.

import { createHash } from "node:crypto";

import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { BatchWriteCommand, DeleteCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./lib/ddb.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
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
    const anonymized = await anonymizeAcrossEntities(phone);
    counts.records_anonymized += anonymized;
    await deleteUserRecords(phone, entry.pks);
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
    await ddb().send(
      new PutCommand({
        TableName: env.tableName(),
        Item: { ...item, notifications_sent_today: 0 },
      }),
    );
    counts.counters_reset++;
  }

  return counts;
}

async function anonymizeAcrossEntities(phone: string): Promise<number> {
  const replacement = pseudonymFor(phone);
  const targets = await scanAll({
    filterExpression:
      "borrower_phone = :p OR requester_phone = :p OR donor_phone = :p OR reporter_phone = :p",
    expressionAttributeValues: { ":p": phone },
  });
  let n = 0;
  // Decrement wishlist vote counts when this user had voted. Wishlist is
  // not a current schema; we still scan defensively in case future versions
  // store votes via VOTE# rows referencing voter_phone.
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
  for (const t of targets) {
    const row = t as Record<string, unknown> & { PK: string; SK: string };
    const next = { ...row };
    if (next["borrower_phone"] === phone) next["borrower_phone"] = replacement;
    if (next["requester_phone"] === phone) next["requester_phone"] = replacement;
    if (next["donor_phone"] === phone) next["donor_phone"] = replacement;
    if (next["reporter_phone"] === phone) next["reporter_phone"] = replacement;
    // Strip GSI projections that index on the phone — leaving them in place
    // would expose the original phone via the byUser index.
    if (typeof next["GSI1PK"] === "string" && (next["GSI1PK"] as string) === `USER#${phone}`) {
      next["GSI1PK"] = `USER#${replacement}`;
    }
    await ddb().send(new PutCommand({ TableName: env.tableName(), Item: next }));
    n++;
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
