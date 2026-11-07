import { DeleteCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./ddb.js";
import { env } from "./env.js";

// The account cleaner's durable hard-delete queue (account-cleaner.ts): one
// row per phone still being scrubbed, under this partition.
export const PENDING_SCRUB_PK = "CLEANER#PENDING";

export function pendingScrubKey(phone: string): { PK: string; SK: string } {
  return { PK: PENDING_SCRUB_PK, SK: `PHONE#${phone}` };
}

// Drops a queued hard delete. Called when the member cancels their deletion
// request, so a phone queued by a run that timed out is not deleted anyway.
export async function deletePendingScrub(phone: string): Promise<void> {
  await ddb().send(new DeleteCommand({ TableName: env.tableName(), Key: pendingScrubKey(phone) }));
}
