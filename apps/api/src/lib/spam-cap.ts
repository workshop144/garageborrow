// Per-user, per-day notification ceiling. The counter lives on the user
// record (any tenant; tier rolls over together) and is incremented atomically
// via DDB ADD so concurrent notifier invocations don't race past the cap.
//
// The cap is intentionally generous (5/day) — we'd rather drop a sixth
// well-deserved push than spam a user out of consent.

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./ddb.js";
import { env } from "./env.js";
import { tenantUserKey } from "@garageborrow/shared";

export const DAILY_NOTIFICATION_CAP = 5;

// Member-triggered borrow/reservation request pings to the owner count in
// their own bucket, so requests from members cannot use up the owner's shared
// 5/day budget (wishlist digests, other alerts). Reset with the main counter.
export const BORROW_REQUEST_NOTIFICATION_CAP = 10;
export const BORROW_REQUEST_COUNTER = "borrow_requests_notified_today";
export const DAILY_COUNTER = "notifications_sent_today";
// Every per-day counter attribute the account cleaner resets.
export const DAILY_COUNTERS = [DAILY_COUNTER, BORROW_REQUEST_COUNTER] as const;

function bucketFor(type: string | undefined): { attr: string; cap: number } {
  return type === "borrow_request_pending"
    ? { attr: BORROW_REQUEST_COUNTER, cap: BORROW_REQUEST_NOTIFICATION_CAP }
    : { attr: DAILY_COUNTER, cap: DAILY_NOTIFICATION_CAP };
}

export interface CapResult {
  allowed: boolean;
  count_after: number;
  // The user row is gone or soft-deleted: send nothing and write nothing.
  gone?: true;
}

function isConditionFailure(err: unknown): boolean {
  return (err as { name?: string }).name === "ConditionalCheckFailedException";
}

// Atomically bump and read the counter. If the result exceeds the cap, the
// caller drops the notification. The counter itself is reset by
// account-cleaner's daily sweep at user-local midnight.
export async function reserveSlot(
  garage_id: string,
  user_phone: string,
  type?: string,
): Promise<CapResult> {
  const k = tenantUserKey(garage_id, user_phone);
  const bucket = bucketFor(type);
  let r;
  try {
    // ADD creates a missing item, so without the condition a notification
    // racing the account cleaner's hard delete would recreate a row keyed by
    // the deleted user's phone that no later cleaner run selects again.
    r = await ddb().send(
      new UpdateCommand({
        TableName: env.tableName(),
        Key: { PK: k.pk, SK: k.sk },
        UpdateExpression: "ADD #n :one",
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(deleted_at)",
        ExpressionAttributeNames: { "#n": bucket.attr },
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
  } catch (err) {
    if (isConditionFailure(err)) return { allowed: false, count_after: 0, gone: true };
    throw err;
  }
  const updated = r.Attributes as Record<string, unknown> | undefined;
  const raw = updated?.[bucket.attr];
  const count = typeof raw === "number" ? raw : 1;
  return { allowed: count <= bucket.cap, count_after: count };
}

// Decrement-back when delivery is skipped *after* the slot was reserved
// (e.g., dedup hit detected after the increment). Keeps the daily ceiling
// honest in cases where reservation happened pre-skip.
export async function releaseSlot(
  garage_id: string,
  user_phone: string,
  type?: string,
): Promise<void> {
  const k = tenantUserKey(garage_id, user_phone);
  const bucket = bucketFor(type);
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: env.tableName(),
        Key: { PK: k.pk, SK: k.sk },
        UpdateExpression: "ADD #n :neg",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#n": bucket.attr },
        ExpressionAttributeValues: { ":neg": -1 },
      }),
    );
  } catch (err) {
    if (!isConditionFailure(err)) throw err;
  }
}
