import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import { env } from "./env.js";
import { newId, nowIso, todayDate } from "./ids.js";
import { logger } from "./logger.js";
import { putAuditLogEntry } from "./repo.js";

let cached: LambdaClient | undefined;

function lambda(): LambdaClient {
  if (!cached) cached = new LambdaClient({ region: env.region() });
  return cached;
}

// Tests inject a stub by replacing the singleton.
export function setLambdaClient(client: LambdaClient | undefined): void {
  cached = client;
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
  | "incident_logged"
  | "hard_delete_warning"
  | "borrow_request_decided";

export interface NotifierEvent {
  type: NotifierEventType;
  garage_id: string;
  // The phone of the user this notification targets, when known. Optional so
  // the cron-driven sweep paths (which discover recipients from DDB) can omit
  // it. Direct-invoke callers should set it whenever the recipient is implied
  // by the event payload.
  user_phone?: string;
  payload: Record<string, unknown>;
}

// Fire-and-forget invocation of the notifier Lambda. We do not await an
// observable result on the response path; failures are logged but never
// propagate to the request, since notification is a best-effort signal.
//
// Each call also writes a lightweight audit entry so admins can see the
// dispatch in the activity log. The audit entry deliberately omits the
// payload contents (recipient phone, item names) — the action_type encodes
// what was triggered, and the activity log is owner-visible.
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
  await writeDispatchAudit(event);
}

async function writeDispatchAudit(event: NotifierEvent): Promise<void> {
  if (!event.garage_id) return;
  try {
    await putAuditLogEntry({
      id: newId(),
      garage_id: event.garage_id,
      date: todayDate(),
      // Audit log requires an actor_phone; system-dispatched notifications
      // have no human actor, so we use a synthetic system phone. The
      // action_type carries the real signal.
      actor_phone: "+10000000000",
      action_type: `notification.dispatched.${event.type}`,
      entity_type: "garage",
      entity_id: event.garage_id,
      before_snapshot: null,
      // Deliberately strip payload — admins see the dispatch happened,
      // not who or what was inside it.
      after_snapshot: { type: event.type },
      http_method: "POST",
      path: "/internal/notifier",
      created_at: nowIso(),
    });
  } catch (err) {
    logger.warn({ err, type: event.type }, "notifier_audit_failed");
  }
}
