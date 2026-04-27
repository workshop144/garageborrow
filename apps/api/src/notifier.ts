// Notifier Lambda: handles two trigger shapes —
//   1. EventBridge daily cron @ 13:00 UTC (≈9am ET) → discovers loans and
//      reservations needing reminders.
//   2. Direct invoke (InvocationType=Event) from the api Lambda → fans an
//      event out to push/SMS/inapp using the recipient's prefs.
//
// Channel selection follows the user's notification_prefs: push when there
// is at least one push subscription registered, SMS for everyone outside
// quiet hours, in-app inbox always (the inbox is the durable record).
//
// Deferral: non-urgent notifications during quiet hours land in the inbox
// with a deliver_after timestamp; push/SMS are skipped. "Urgent" =
// waitlist-now-available, request approve/decline. Everything else is
// deferrable.
//
// Spam ceiling: each user has a notifications_sent_today counter on their
// user record; the notifier increments it atomically before delivery. After
// 5 sends in a day, further notifications are dropped (still written to the
// inbox so the user can see them). The counter is reset by account-cleaner.

import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./lib/ddb.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { initSentry } from "./lib/sentry.js";

initSentry();
import { isInQuietHours, nextEndInstant } from "./lib/quiet-hours.js";
import { markDispatched, shouldSkipDuplicate } from "./lib/notify-dedup.js";
import { reserveSlot, releaseSlot } from "./lib/spam-cap.js";
import { deliverInapp, deliverPush, deliverSms, type ChannelMessage } from "./lib/channels.js";
import {
  getMembership,
  getUser,
  listLoansByGarage,
  listMembers,
  listWaitlist,
} from "./lib/repo.js";
import type {
  Loan,
  NotificationPrefs,
  Reservation,
  User,
  WaitlistEntry,
} from "@garageborrow/shared";

const URGENT_TYPES: ReadonlySet<string> = new Set([
  "waitlist_unblocked",
  "borrow_request_decided",
  "reservation_decided",
]);

interface DispatchContext {
  user: User;
  garage_id: string;
  prefs: NotificationPrefs;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  urgent: boolean;
  now: Date;
}

export async function dispatch(ctx: DispatchContext): Promise<void> {
  const nowSec = Math.floor(ctx.now.getTime() / 1000);

  // Per-(user, type, payload) dedup window.
  if (await shouldSkipDuplicate(ctx.user.phone, ctx.type, ctx.payload, nowSec)) {
    logger.info({ type: ctx.type }, "notifier_dedup_skip");
    return;
  }

  const slot = await reserveSlot(ctx.garage_id, ctx.user.phone);
  if (!slot.allowed) {
    logger.info({ type: ctx.type, count: slot.count_after }, "notifier_spam_cap_drop");
    // Even when capped, write to the inbox so the inbox stays a complete
    // record of what we *would* have sent.
    await deliverInapp(buildMsg(ctx, undefined), "inapp");
    return;
  }

  const inQuiet =
    !ctx.urgent &&
    isInQuietHours(ctx.now, {
      start: ctx.prefs.quiet_hours_start,
      end: ctx.prefs.quiet_hours_end,
    });

  if (inQuiet) {
    const deliver_after = nextEndInstant(ctx.now, {
      start: ctx.prefs.quiet_hours_start,
      end: ctx.prefs.quiet_hours_end,
    }).toISOString();
    await deliverInapp(buildMsg(ctx, deliver_after), "inapp");
    await markDispatched(ctx.user.phone, ctx.type, ctx.payload, nowSec);
    return;
  }

  const msg = buildMsg(ctx, undefined);
  const inappRecord = await deliverInapp(msg, pickInappChannel(ctx.prefs));

  let delivered = false;
  if (ctx.prefs.push_enabled) {
    const count = await deliverPush(msg);
    if (count > 0) delivered = true;
  }
  if (ctx.prefs.sms_enabled) {
    await deliverSms(msg);
    delivered = true;
  }

  await markDispatched(ctx.user.phone, ctx.type, ctx.payload, nowSec);

  if (!delivered) {
    // No external channel worked; we still have the inbox record but want
    // to release the spam slot we burned on a no-op send.
    await releaseSlot(ctx.garage_id, ctx.user.phone);
    logger.info({ type: ctx.type, inapp_id: inappRecord.id }, "notifier_inapp_only");
  }
}

function buildMsg(ctx: DispatchContext, deliver_after: string | undefined): ChannelMessage {
  const base: ChannelMessage = {
    user_phone: ctx.user.phone,
    garage_id: ctx.garage_id,
    type: ctx.type,
    title: ctx.title,
    body: ctx.body,
    payload: ctx.payload,
  };
  if (deliver_after) base.deliver_after = deliver_after;
  return base;
}

function pickInappChannel(prefs: NotificationPrefs): "push" | "sms" | "inapp" {
  // The Notification record's `channel` field records which external path
  // the user is best served by, so the inbox UI can label "sent via push"
  // vs "sent as SMS". We pick the most specific in priority order.
  if (prefs.push_enabled) return "push";
  if (prefs.sms_enabled) return "sms";
  return "inapp";
}

// ─────────────────────── Direct-invoke handlers ──────────────────────

interface DirectInvokeEvent {
  type: string;
  garage_id: string;
  user_phone?: string;
  payload: Record<string, unknown>;
}

const COPY: Record<string, { title: string; body: string }> = {
  waitlist_unblocked: {
    title: "Your turn!",
    body: "Something on your waitlist just opened up. Tap to grab it.",
  },
  tier_promoted: {
    title: "You're in the family.",
    body: "Owner promoted you. New tools just opened up on the pegboard.",
  },
  donation_accepted: {
    title: "Thanks for the donation",
    body: "Your offer was accepted and is on the pegboard now.",
  },
  donation_declined: {
    title: "Donation update",
    body: "Owner couldn't take this one — check your donation list for details.",
  },
  loan_extended: {
    title: "Got it — extended.",
    body: "We bumped the return date a few days. No rush.",
  },
  loan_returned: {
    title: "Return logged",
    body: "Marked as returned. Owner has 48 hours to dispute.",
  },
  loan_disputed: {
    title: "Heads up — return disputed",
    body: "Owner flagged the return. Check the loan details when you can.",
  },
  loan_reminder: {
    title: "Quick reminder",
    body: "Looks like a tool's still out — extend it any time if you need more days.",
  },
  reservation_decided: {
    title: "Reservation update",
    body: "Owner just acted on your reservation — check the details.",
  },
  incident_logged: {
    title: "Incident logged",
    body: "We recorded an incident on the loan. Owner will follow up.",
  },
  hard_delete_warning: {
    title: "Final notice",
    body: "Your account will be permanently deleted in 7 days. Reply STOP to keep it.",
  },
  borrow_request_decided: {
    title: "Borrow request update",
    body: "Owner just decided on your borrow request — open the app to see.",
  },
};

export async function handleDirectInvoke(event: DirectInvokeEvent, now: Date): Promise<void> {
  if (!event.type || !event.garage_id) {
    logger.warn({ event }, "notifier_invalid_direct_event");
    return;
  }
  const phone = event.user_phone;
  if (!phone) {
    // Some types fan out to many recipients (e.g. waitlist_unblocked
    // resolves to the head of the waitlist). Handle those out-of-band.
    if (event.type === "waitlist_unblocked") {
      await fanOutWaitlist(event, now);
      return;
    }
    logger.warn({ type: event.type }, "notifier_missing_user_phone");
    return;
  }

  const user = await getUser(event.garage_id, phone);
  if (!user) {
    logger.warn({ type: event.type }, "notifier_user_not_found");
    return;
  }

  const copy = COPY[event.type] ?? { title: "Garage Borrow", body: "You have a new update." };
  await dispatch({
    user,
    garage_id: event.garage_id,
    prefs: user.notification_prefs,
    type: event.type,
    title: copy.title,
    body: copy.body,
    payload: event.payload,
    urgent: URGENT_TYPES.has(event.type),
    now,
  });
}

async function fanOutWaitlist(event: DirectInvokeEvent, now: Date): Promise<void> {
  const itemId =
    typeof event.payload["item_id"] === "string" ? (event.payload["item_id"] as string) : undefined;
  if (!itemId) return;
  const entries = await listWaitlist(event.garage_id, itemId);
  if (entries.length === 0) return;
  entries.sort((a: WaitlistEntry, b: WaitlistEntry) => a.joined_at.localeCompare(b.joined_at));
  const head = entries[0];
  if (!head) return;
  const user = await getUser(event.garage_id, head.borrower_phone);
  if (!user) return;
  const copy = COPY["waitlist_unblocked"]!;
  await dispatch({
    user,
    garage_id: event.garage_id,
    prefs: user.notification_prefs,
    type: "waitlist_unblocked",
    title: copy.title,
    body: copy.body,
    payload: { item_id: itemId, ...event.payload },
    urgent: true,
    now,
  });
}

// ─────────────────────── Cron sweep ──────────────────────

const ONE_DAY_MS = 86400_000;

interface CronOptions {
  now: Date;
  // Tests pass a focused garage list so the sweep is deterministic;
  // production discovers garages via a Scan over TENANT#... META rows.
  garage_ids?: string[];
}

interface CronCounts {
  due_today: number;
  overdue_2d: number;
  reservations_tomorrow: number;
}

export async function runCronSweep(opts: CronOptions): Promise<CronCounts> {
  const counts: CronCounts = { due_today: 0, overdue_2d: 0, reservations_tomorrow: 0 };
  const garages = opts.garage_ids ?? (await listAllGarageIds());
  const now = opts.now;
  for (const garage_id of garages) {
    const loans = await listLoansByGarage(garage_id);
    const today = now.toISOString().slice(0, 10);
    const twoDaysAgo = new Date(now.getTime() - 2 * ONE_DAY_MS).toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + ONE_DAY_MS).toISOString().slice(0, 10);

    for (const loan of loans) {
      if (loan.status !== "active") continue;
      const dueDate = loan.expected_return_at.slice(0, 10);
      if (dueDate === today) {
        await dispatchLoanReminder(garage_id, loan, "loan_due_today", now);
        counts.due_today++;
      } else if (dueDate === twoDaysAgo) {
        await dispatchLoanReminder(garage_id, loan, "loan_overdue_2d", now);
        counts.overdue_2d++;
      }
    }

    const reservations = await listReservationsForDate(garage_id, tomorrow);
    for (const res of reservations) {
      if (res.status !== "approved") continue;
      const user = await getUser(garage_id, res.borrower_phone);
      if (!user) continue;
      await dispatch({
        user,
        garage_id,
        prefs: user.notification_prefs,
        type: "reservation_tomorrow",
        title: "Heads up — pickup tomorrow",
        body: `Reservation starts tomorrow. Text Dad to coordinate pickup.`,
        payload: { reservation_id: res.id, item_id: res.item_id, start_at: res.start_at },
        urgent: false,
        now,
      });
      counts.reservations_tomorrow++;
    }
  }
  return counts;
}

async function dispatchLoanReminder(
  garage_id: string,
  loan: Loan,
  type: "loan_due_today" | "loan_overdue_2d",
  now: Date,
): Promise<void> {
  const user = await getUser(garage_id, loan.borrower_phone);
  if (!user) return;
  const copy =
    type === "loan_due_today"
      ? {
          title: "Due back today",
          body: "Hey, the borrow's due back today. No worries if you need more time — just hit extend.",
        }
      : {
          title: "Just checking",
          body: "Still got it? All good if so — we just wanted to make sure it didn't get lost in the shuffle.",
        };
  await dispatch({
    user,
    garage_id,
    prefs: user.notification_prefs,
    type,
    title: copy.title,
    body: copy.body,
    payload: { loan_id: loan.id, item_id: loan.item_id },
    urgent: false,
    now,
  });
}

async function listAllGarageIds(): Promise<string[]> {
  const r = await ddb().send(
    new ScanCommand({
      TableName: env.tableName(),
      FilterExpression: "SK = :meta",
      ExpressionAttributeValues: { ":meta": "META" },
      ProjectionExpression: "PK",
    }),
  );
  const ids: string[] = [];
  for (const it of r.Items ?? []) {
    const pk = (it as { PK?: string }).PK;
    if (pk && pk.startsWith("TENANT#")) ids.push(pk.slice("TENANT#".length));
  }
  return ids;
}

async function listReservationsForDate(garage_id: string, date: string): Promise<Reservation[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: env.tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": `RES#${date}#`,
      },
    }),
  );
  return (r.Items ?? []) as Reservation[];
}

// ─────────────────────── Lambda entry ──────────────────────

interface ScheduledEvent {
  source?: string;
  "detail-type"?: string;
}

export interface NotifierLambdaEvent extends Partial<DirectInvokeEvent>, ScheduledEvent {}

export async function handler(event: NotifierLambdaEvent): Promise<{ ok: true }> {
  const now = new Date();
  if (event.source === "aws.events" || event["detail-type"] === "Scheduled Event") {
    await runCronSweep({ now });
    return { ok: true };
  }
  if (event.type && event.garage_id) {
    await handleDirectInvoke(event as DirectInvokeEvent, now);
    return { ok: true };
  }
  logger.warn({ event }, "notifier_unrecognized_event");
  return { ok: true };
}

// Test-only helpers — exported so vitest can drive the helpers without going
// through the Lambda invocation envelope.
export const __test = {
  COPY,
  URGENT_TYPES,
  dispatchLoanReminder,
  fanOutWaitlist,
  listReservationsForDate,
  listAllGarageIds,
  listMembers,
  getMembership,
};
