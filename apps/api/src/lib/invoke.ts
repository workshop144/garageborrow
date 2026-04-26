import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import { env } from "./env.js";
import { logger } from "./logger.js";

let cached: LambdaClient | undefined;

function lambda(): LambdaClient {
  if (!cached) cached = new LambdaClient({ region: env.region() });
  return cached;
}

export type NotifierEventType =
  | "waitlist_unblocked"
  | "tier_promoted"
  | "donation_accepted"
  | "donation_declined"
  | "loan_extended"
  | "loan_returned"
  | "loan_disputed"
  | "loan_reminder"
  | "reservation_decided"
  | "incident_logged";

export interface NotifierEvent {
  type: NotifierEventType;
  garage_id: string;
  payload: Record<string, unknown>;
}

// Fire-and-forget invocation of the notifier Lambda. We do not await an
// observable result on the response path; failures are logged but never
// propagate to the request, since notification is a best-effort signal.
export async function invokeNotifier(event: NotifierEvent): Promise<void> {
  try {
    await lambda().send(
      new InvokeCommand({
        FunctionName: env.notifierFunctionName(),
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(event)),
      }),
    );
  } catch (err) {
    logger.warn({ err, type: event.type, garage_id: event.garage_id }, "notifier_invoke_failed");
  }
}
