// Recent-send dedup: when the notifier is asked to deliver the same
// (user, type, payload) combo more than once within an hour, we skip the
// downstream channel work. The dedup record itself lives in DDB with a TTL
// so we don't accumulate junk.

import { createHash } from "node:crypto";

import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./ddb.js";
import { env } from "./env.js";

const DEDUP_WINDOW_SECONDS = 3600;

function dedupKey(
  userPhone: string,
  type: string,
  payloadHash: string,
): { pk: string; sk: string } {
  return { pk: `USER#${userPhone}`, sk: `DEDUP#${type}#${payloadHash}` };
}

// Stable hash over the payload so the same logical event collapses across
// retries even if object key order shifts. JSON.stringify is fine here
// because callers construct payloads in a consistent shape.
export function payloadHash(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const stable = sortedKeys.map((k) => [k, payload[k]] as const);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export async function shouldSkipDuplicate(
  userPhone: string,
  type: string,
  payload: Record<string, unknown>,
  nowEpochSec: number,
): Promise<boolean> {
  const k = dedupKey(userPhone, type, payloadHash(payload));
  const r = await ddb().send(
    new GetCommand({ TableName: env.tableName(), Key: { PK: k.pk, SK: k.sk } }),
  );
  const item = r.Item as { expires_at?: number } | undefined;
  if (!item || typeof item.expires_at !== "number") return false;
  return item.expires_at > nowEpochSec;
}

export async function markDispatched(
  userPhone: string,
  type: string,
  payload: Record<string, unknown>,
  nowEpochSec: number,
): Promise<void> {
  const k = dedupKey(userPhone, type, payloadHash(payload));
  await ddb().send(
    new PutCommand({
      TableName: env.tableName(),
      Item: {
        PK: k.pk,
        SK: k.sk,
        expires_at: nowEpochSec + DEDUP_WINDOW_SECONDS,
      },
    }),
  );
}
