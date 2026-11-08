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
// inbox so the user can see them). borrow_request_pending has its own bucket
// (lib/spam-cap.ts) so member requests cannot use up the owner's 5. The
// counters are reset by account-cleaner.

import { ScanCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./lib/ddb.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { captureError, initSentry } from "./lib/sentry.js";

initSentry();
import { isInQuietHours, nextEndInstant } from "./lib/quiet-hours.js";
import { claimDispatch, releaseDispatch } from "./lib/notify-dedup.js";
import { reserveSlot, releaseSlot } from "./lib/spam-cap.js";
import { deliverInapp, deliverPush, deliverSms, type ChannelMessage } from "./lib/channels.js";
import {
  getGarage,
  getItem,
  getMembership,
  getUser,
  listLoansByGarage,
  listMembers,
  listWaitlist,
  listWishlistRequests,
  type LoanRecord,
  queryAll,
} from "./lib/repo.js";
import { AUTO_CONFIRM_AFTER_MS, confirmClaimedReturns } from "./lib/loan-lifecycle.js";
import { resolveItemAccess } from "@garageborrow/shared";
import type {
  Loan,
  NotificationPrefs,
  Reservation,
  User,
  WaitlistEntry,
  WishlistRequest,
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

  // Soft-deleted users get nothing: they asked to leave, and every write below
  // lands in rows keyed by their phone that the account cleaner must be able
  // to remove for good.
  if (ctx.user.deleted_at) {
    logger.info({ type: ctx.type }, "notifier_skip_deleted_user");
    return;
  }

  // Per-(user, type, payload) dedup window, claimed before anything is sent.
  if (!(await claimDispatch(ctx.user.phone, ctx.type, ctx.payload, nowSec))) {
    logger.info({ type: ctx.type }, "notifier_dedup_skip");
    return;
  }

  let sentExternally = false;
  try {
    const slot = await reserveSlot(ctx.garage_id, ctx.user.phone, ctx.type);
    if (slot.gone) {
      // Deleted meanwhile: leave no row keyed by their phone behind.
      await releaseDispatch(ctx.user.phone, ctx.type, ctx.payload);
      logger.info({ type: ctx.type }, "notifier_skip_missing_user");
      return;
    }
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
      return;
    }

    const msg = buildMsg(ctx, undefined);
    const inappRecord = await deliverInapp(msg, pickInappChannel(ctx.prefs));

    let delivered = false;
    if (ctx.prefs.push_enabled) {
      const count = await deliverPush(msg);
      if (count > 0) delivered = sentExternally = true;
    }
    if (ctx.prefs.sms_enabled) {
      await deliverSms(msg);
      delivered = sentExternally = true;
    }

    if (!delivered) {
      // No external channel worked; we still have the inbox record but want
      // to release the spam slot we burned on a no-op send.
      await releaseSlot(ctx.garage_id, ctx.user.phone, ctx.type);
      logger.info({ type: ctx.type, inapp_id: inappRecord.id }, "notifier_inapp_only");
    }
  } catch (err) {
    // Nothing reached the member's phone yet: let a retry deliver. Once a
    // push or SMS went out, keep the claim so a retry cannot repeat it.
    if (!sentExternally) {
      await releaseDispatch(ctx.user.phone, ctx.type, ctx.payload).catch(() => undefined);
    }
    throw err;
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
  borrow_request_pending: {
    title: "Someone wants to borrow something",
    body: "A member asked to borrow or reserve a tool. Open the app to approve or decline.",
  },
  borrow_request_decided: {
    title: "Borrow request update",
    body: "Owner just decided on your borrow request — open the app to see.",
  },
  wishlist_popular: {
    title: "Wishlist heat",
    body: "Folks are wishing for something — might be worth a look.",
  },
  wishlist_acquired: {
    title: "It's in the garage",
    body: "Hey — that thing you wanted is on the pegboard now.",
  },
  wishlist_declined: {
    title: "Wishlist update",
    body: "Dad passed on a wishlist item you submitted.",
  },
  wishlist_duplicated: {
    title: "Wishlist update",
    body: "Your wishlist item was merged with an existing request — vote moved over.",
  },
  wishlist_digest: {
    title: "New wishlist requests",
    body: "Open the app to see what folks are wishing for.",
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
  const item = await getItem(event.garage_id, itemId);
  if (!item) return;
  // Notify the first waiter who can still borrow it: a member who left, was
  // deleted, or dropped below the item's tier must not hold up the queue or
  // learn about an item hidden from them.
  let user: User | undefined;
  for (const entry of entries) {
    const [candidate, membership] = await Promise.all([
      getUser(event.garage_id, entry.borrower_phone),
      getMembership(event.garage_id, entry.borrower_phone),
    ]);
    if (!candidate || candidate.deleted_at || !membership) continue;
    if (resolveItemAccess(membership.tier, item.min_tier, item.auto_approve_tier) === "hidden") {
      continue;
    }
    user = candidate;
    break;
  }
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
  wishlist_digests: number;
  returns_confirmed: number;
  // Steps that threw and were skipped (logged and sent to Sentry).
  failures: number;
}

// One failing step (a throttled read, a bad row, a channel error) is logged
// and reported, and the sweep carries on with the next loan or garage instead
// of abandoning every reminder after it.
async function isolated(
  step: string,
  garage_id: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    logger.error({ err, step, garage_id }, "notifier_cron_step_failed");
    captureError(err, { step, garage_id });
    return false;
  }
}

export async function runCronSweep(opts: CronOptions): Promise<CronCounts> {
  const counts: CronCounts = {
    due_today: 0,
    overdue_2d: 0,
    reservations_tomorrow: 0,
    wishlist_digests: 0,
    returns_confirmed: 0,
    failures: 0,
  };
  const garages = opts.garage_ids ?? (await listAllGarageIds());
  const now = opts.now;
  const step = async (name: string, garage_id: string, fn: () => Promise<void>) => {
    if (!(await isolated(name, garage_id, fn))) counts.failures++;
  };
  for (const garage_id of garages) {
    await step("garage", garage_id, () => sweepGarage(garage_id, now, counts, step));
  }
  return counts;
}

async function sweepGarage(
  garage_id: string,
  now: Date,
  counts: CronCounts,
  step: (name: string, garage_id: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  // Close claimed returns past the 48h dispute window first, so their
  // borrowers get no "due back" reminders and the next waiter hears.
  await step("auto_confirm", garage_id, async () => {
    const confirmed = await confirmClaimedReturns(garage_id, now.getTime() - AUTO_CONFIRM_AFTER_MS);
    counts.returns_confirmed += confirmed.length;
    for (const loan of confirmed) {
      await step("waitlist", garage_id, () =>
        fanOutWaitlist(
          { type: "waitlist_unblocked", garage_id, payload: { item_id: loan.item_id } },
          now,
        ),
      );
    }
  });

  const loans: LoanRecord[] = await listLoansByGarage(garage_id);
  const today = now.toISOString().slice(0, 10);
  const twoDaysAgo = new Date(now.getTime() - 2 * ONE_DAY_MS).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + ONE_DAY_MS).toISOString().slice(0, 10);

  for (const loan of loans) {
    if (loan.status !== "active") continue;
    // Handed back (claim inside the dispute window): nothing to remind about.
    if (loan.return_claimed_at || loan.actual_return_at) continue;
    const dueDate = loan.expected_return_at.slice(0, 10);
    if (dueDate === today) {
      await step("loan_due_today", garage_id, async () => {
        await dispatchLoanReminder(garage_id, loan, "loan_due_today", now);
        counts.due_today++;
      });
    } else if (dueDate === twoDaysAgo) {
      await step("loan_overdue_2d", garage_id, async () => {
        await dispatchLoanReminder(garage_id, loan, "loan_overdue_2d", now);
        counts.overdue_2d++;
      });
    }
  }

  await step("reservations_tomorrow", garage_id, async () => {
    const reservations = await listReservationsForDate(garage_id, tomorrow);
    for (const res of reservations) {
      if (res.status !== "approved") continue;
      await step("reservation_tomorrow", garage_id, async () => {
        const user = await getUser(garage_id, res.borrower_phone);
        if (!user) return;
        await dispatch({
          user,
          garage_id,
          prefs: user.notification_prefs,
          type: "reservation_tomorrow",
          title: "Heads up — pickup tomorrow",
          body: `Reservation starts tomorrow. Text the owner to coordinate pickup.`,
          payload: { reservation_id: res.id, item_id: res.item_id, start_at: res.start_at },
          urgent: false,
          now,
        });
        counts.reservations_tomorrow++;
      });
    }
  });

  await step("wishlist_digest", garage_id, async () => {
    if (await dispatchWishlistDigest(garage_id, now)) counts.wishlist_digests++;
  });
}

// Digest of wishlist requests created in the last 24h, sent to the owner
// once per cron tick. Skipped when:
//   - the garage has wishlist disabled
//   - no new requests since the last cron run
// Honors the same dispatch path (quiet hours, spam cap, dedup) as every
// other notifier event.
async function dispatchWishlistDigest(garage_id: string, now: Date): Promise<boolean> {
  const garage = await getGarage(garage_id);
  if (!garage || garage.wishlist_enabled === false) return false;
  const all = await listWishlistRequests(garage_id);
  const cutoff = new Date(now.getTime() - ONE_DAY_MS).toISOString();
  const fresh = all.filter((r: WishlistRequest) => r.created_at >= cutoff);
  if (fresh.length === 0) return false;
  const owner = await getUser(garage_id, garage.owner_phone);
  if (!owner) return false;
  // Static copy only (GB-F5-3): item names are member-written and this goes
  // out by SMS from the number the owner trusts for sign-in codes. The app
  // shows the requests themselves (by id) on the wishlist page.
  await dispatch({
    user: owner,
    garage_id,
    prefs: owner.notification_prefs,
    type: "wishlist_digest",
    title: `${fresh.length} new wishlist request${fresh.length === 1 ? "" : "s"}`,
    body: COPY["wishlist_digest"]!.body,
    payload: { count: fresh.length, request_ids: fresh.map((r) => r.id) },
    urgent: false,
    now,
  });
  return true;
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

// Scan pages hold at most 1 MB before the filter, and the table is mostly
// loans, audit and notification rows, so follow LastEvaluatedKey to the end.
async function listAllGarageIds(): Promise<string[]> {
  const ids: string[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new ScanCommand({
        TableName: env.tableName(),
        FilterExpression: "SK = :meta",
        ExpressionAttributeValues: { ":meta": "META" },
        ProjectionExpression: "PK",
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    for (const it of r.Items ?? []) {
      const pk = (it as { PK?: string }).PK;
      if (pk && pk.startsWith("TENANT#")) ids.push(pk.slice("TENANT#".length));
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return ids;
}

async function listReservationsForDate(garage_id: string, date: string): Promise<Reservation[]> {
  const r = await queryAll({
    TableName: env.tableName(),
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: {
      ":pk": `TENANT#${garage_id}`,
      ":sk": `RES#${date}#`,
    },
  });
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
