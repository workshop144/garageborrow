// Notification fan-out. Each channel has its own delivery semantics and
// failure modes; we encapsulate them here so the notifier handler can pick
// channels by user prefs without knowing how a push payload is encrypted or
// how SNS Publish formats SMS.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./ddb.js";
import { env } from "./env.js";
import { newId, nowIso } from "./ids.js";
import { logger } from "./logger.js";
import { putNotification } from "./repo.js";
import { sendSms } from "./sns.js";
import type { Notification, NotificationChannel, PushSubscription } from "@garageborrow/shared";

export interface ChannelMessage {
  user_phone: string;
  garage_id?: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  // Inapp records optionally carry deliver_after for quiet-hour deferral.
  deliver_after?: string;
}

// The push driver is injected so tests can run without a real VAPID keypair
// or the web-push package, and so the notifier can stub it during a deploy
// where SSM is not reachable.
export type PushDriver = (sub: PushSubscription, payload: string) => Promise<void>;
export type SmsDriver = (phone: string, body: string) => Promise<void>;

// Noop placeholder used when no driver is configured. Logs and resolves so
// the rest of the pipeline keeps running.
const noopPush: PushDriver = async (sub) => {
  logger.warn({ endpoint: sub.endpoint }, "push_driver_unset_skipping");
};

let pushDriver: PushDriver = noopPush;
let smsDriver: SmsDriver = sendSms;

export function setPushDriver(d: PushDriver | undefined): void {
  pushDriver = d ?? noopPush;
}

export function setSmsDriver(d: SmsDriver | undefined): void {
  smsDriver = d ?? sendSms;
}

export async function listPushSubscriptions(user_phone: string): Promise<PushSubscription[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: env.tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${user_phone}`,
        ":sk": "PUSH#",
      },
    }),
  );
  return (r.Items ?? []) as PushSubscription[];
}

export async function deliverPush(msg: ChannelMessage): Promise<number> {
  const subs = await listPushSubscriptions(msg.user_phone);
  if (subs.length === 0) return 0;
  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body,
    data: { type: msg.type, ...msg.payload },
  });
  let delivered = 0;
  for (const sub of subs) {
    try {
      await pushDriver(sub, payload);
      delivered++;
    } catch (err) {
      logger.warn({ err, type: msg.type }, "push_delivery_failed");
    }
  }
  return delivered;
}

export async function deliverSms(msg: ChannelMessage): Promise<void> {
  try {
    await smsDriver(msg.user_phone, `${msg.title}\n${msg.body}`);
  } catch (err) {
    logger.warn({ err, type: msg.type }, "sms_delivery_failed");
  }
}

export async function deliverInapp(
  msg: ChannelMessage,
  channel: NotificationChannel,
): Promise<Notification> {
  const note: Notification = {
    id: newId(),
    user_phone: msg.user_phone,
    ...(msg.garage_id ? { garage_id: msg.garage_id } : {}),
    type: msg.type,
    payload: msg.payload,
    channel,
    sent_at: nowIso(),
    ...(msg.deliver_after ? { deliver_after: msg.deliver_after } : {}),
  };
  await putNotification(note);
  return note;
}
