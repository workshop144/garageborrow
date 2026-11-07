import { Hono } from "hono";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  DisplayName,
  HttpUrl,
  NotificationPrefsSchema,
  UserVisibilitySchema,
  patchSchemaOf,
  tierRank,
} from "@garageborrow/shared";
import type {
  GarageMembership,
  Loan,
  Reservation,
  User,
  WaitlistEntry,
} from "@garageborrow/shared";

import { mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import {
  memberDonationView,
  memberLoanView,
  memberReservationView,
  memberWaitlistView,
  myStuffItemView,
  type MyStuffItemView,
} from "../lib/member-views.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import {
  getGarage,
  getItem,
  getMembership,
  getNotification,
  getUserAnyGarage,
  deleteInvite,
  deleteWaitlist,
  listAllWishlistVotesForVoter,
  listDonations,
  listInvitesForPhone,
  listNotifications,
  listPushSubscriptions,
  listUserIndexRows,
  listUserProfiles,
  listWaitlistByGarage,
  listWaitlistForPhone,
  listWishlistRequests,
  putMembership,
  putNotification,
  putPushSubscription,
  putReservationIfStatus,
  putUser,
  removeUserFields,
  updateUserFields,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveGarageContext } from "../middleware/garage-context.js";
import { idempotency, requireIdempotencyKey } from "../middleware/idempotency.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth());

// What a member may see of their own membership row. The row also carries the
// owner's private `notes`, the AI budget override, who vouched for them and
// their tier label; those are owner-side data (routes/garage.ts hides the tier
// label from members on purpose), so /v1/me returns this projection only.
export interface MemberMembershipView {
  garage_id: string;
  joined_at: string;
  borrows_total: number;
  borrows_active: number;
  returns_on_time: number;
  returns_late: number;
  celebration_pending: boolean;
}

export function memberMembershipView(m: GarageMembership): MemberMembershipView {
  return {
    garage_id: m.garage_id,
    joined_at: m.joined_at,
    borrows_total: m.borrows_total,
    borrows_active: m.borrows_active,
    returns_on_time: m.returns_on_time,
    returns_late: m.returns_late,
    celebration_pending: m.celebration_pending,
  };
}

meRoutes.get("/v1/me", async (c) => {
  const user = mustUser(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");

  const memberships: GarageMembership[] = [];
  const owned: string[] = [];
  let celebrationPending = false;
  const aiEligibleGarages: string[] = [];
  const ts = nowIso();

  for (const garageId of primary.garages_member_of) {
    const m = await getMembership(garageId, user.phone);
    const g = await getGarage(garageId);
    if (m) memberships.push(m);
    if (g && g.owner_phone === user.phone) owned.push(garageId);
    // A capability, not the tier label: the garages where the member's tier
    // reaches that garage's AI minimum (drives the "AI coming soon" card, which
    // Pegboard checks against the garage it is showing).
    else if (m && g && tierRank(m.tier) >= tierRank(g.ai_min_tier))
      aiEligibleGarages.push(garageId);
  }

  // Consume celebration_pending the first time /me is read after the owner
  // promoted the user to family. We mark celebration_seen_at on the same
  // membership so a follow-up /me read returns the flag as false.
  for (const m of memberships) {
    if (m.celebration_pending) {
      celebrationPending = true;
      const cleared: GarageMembership = {
        ...m,
        celebration_pending: false,
        celebration_seen_at: ts,
      };
      await putMembership(cleared);
      // Mutate in place so the response reflects the cleared state too.
      m.celebration_pending = false;
      m.celebration_seen_at = ts;
    }
  }

  return c.json({
    user: primary,
    memberships: memberships.map(memberMembershipView),
    owned_garages: owned,
    is_owner: owned.length > 0,
    ai_eligible_garages: aiEligibleGarages,
    celebration_pending: celebrationPending,
  });
});

// ─────────────────────────── /v1/me/join ───────────────────────
//
// Turns the caller's pending invites into memberships (at the invited tier,
// vouched by the inviting owner) and creates or updates their per-garage profile
// rows. Called by the PWA right after sign-in; a no-op without invites. An
// account scheduled for deletion accepts nothing.

meRoutes.post("/v1/me/join", async (c) => {
  const user = mustUser(c);
  const now = Math.floor(Date.now() / 1000);
  const ts = nowIso();
  const profiles = await listUserProfiles(user.phone);
  if (profiles.some((p) => p.deleted_at)) {
    throw new ApiError("conflict", "Account is scheduled for deletion");
  }
  const joined: string[] = [];
  for (const inv of await listInvitesForPhone(user.phone, now)) {
    const garage = await getGarage(inv.garage_id);
    if (garage && garage.status !== "closed_indefinitely") {
      if (!(await getMembership(garage.id, user.phone))) {
        await putMembership({
          garage_id: garage.id,
          user_phone: user.phone,
          tier: inv.tier,
          joined_at: ts,
          vouched_by_phone: inv.invited_by_phone,
          borrows_total: 0,
          borrows_active: 0,
          returns_on_time: 0,
          returns_late: 0,
          no_shows: 0,
          ai_tokens_used_this_month: 0,
          ai_tokens_used_total: 0,
          celebration_pending: false,
        });
      }
      joined.push(garage.id);
    }
    await deleteInvite(user.phone, inv.garage_id);
  }
  if (joined.length > 0) {
    const garages = [...new Set([...profiles.flatMap((p) => p.garages_member_of), ...joined])];
    const base: User = profiles[0] ?? {
      phone: user.phone,
      display_name: "New neighbor",
      visibility: "visible",
      garages_member_of: [],
      notification_prefs: NotificationPrefsSchema.parse({}),
      created_at: ts,
      last_seen_at: ts,
    };
    for (const garageId of garages) {
      // Existing rows only gain the garage list; new garages get a copy of the
      // base profile without its per-row notification counter.
      const own = profiles.find((p) => (p as { PK?: string }).PK === `TENANT#${garageId}`);
      if (own && (await updateUserFields(garageId, user.phone, { garages_member_of: garages }))) {
        continue;
      }
      const {
        notifications_sent_today: _counter,
        borrow_requests_notified_today: _requests,
        ...profile
      } = base as User & {
        notifications_sent_today?: number;
        borrow_requests_notified_today?: number;
      };
      await putUser(garageId, { ...profile, garages_member_of: garages });
    }
  }
  return c.json({ joined });
});

const PatchMeSchema = z
  .object({
    display_name: DisplayName.optional(),
    visibility: UserVisibilitySchema.optional(),
    notification_prefs: patchSchemaOf(NotificationPrefsSchema).optional(),
  })
  .strict();

meRoutes.patch("/v1/me", async (c) => {
  const user = mustUser(c);
  const body = PatchMeSchema.parse(await c.req.json());
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const prefs = { ...primary.notification_prefs };
  if (body.notification_prefs) {
    for (const [k, v] of Object.entries(body.notification_prefs)) {
      if (v !== undefined) (prefs as unknown as Record<string, unknown>)[k] = v;
    }
  }
  const updated: User = {
    ...primary,
    ...(body.display_name ? { display_name: body.display_name } : {}),
    ...(body.visibility ? { visibility: body.visibility } : {}),
    notification_prefs: prefs,
    last_seen_at: nowIso(),
  };
  // Set only what the caller changed on each garage's row: a whole-row put of
  // the primary row reset other rows' notification counters and fields.
  const fields: Record<string, unknown> = { last_seen_at: updated.last_seen_at };
  if (body.display_name) fields["display_name"] = body.display_name;
  if (body.visibility) fields["visibility"] = body.visibility;
  for (const [k, v] of Object.entries(body.notification_prefs ?? {})) {
    if (v !== undefined) fields[`notification_prefs.${k}`] = v;
  }
  for (const garageId of updated.garages_member_of) {
    await updateUserFields(garageId, user.phone, fields);
  }
  return c.json({ user: updated });
});

meRoutes.use("/v1/me/delete-request", idempotency());
meRoutes.post("/v1/me/delete-request", requireIdempotencyKey(), async (c) => {
  const user = mustUser(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  // A pending deletion locks a member out of every garage (owners excepted,
  // see loadGarageContext) and silences notifications, and the cleaner later
  // pseudonymises open loans. Gear that is still out, or an approved
  // reservation that has not ended yet, has to be settled first. Approved
  // reservations whose window is over hold nothing and do not block.
  const now = Date.now();
  const openLoans = (await listUserIndexRows(user.phone, "LOAN#")).filter(
    (l) => l["status"] === "active" || l["status"] === "overdue",
  );
  const reservations = (await listUserIndexRows(user.phone, "RES#")) as unknown as Reservation[];
  const currentApproved = reservations.filter(
    (r) => r.status === "approved" && Date.parse(r.end_at) > now,
  );
  if (openLoans.length > 0 || currentApproved.length > 0) {
    throw new ApiError(
      "conflict",
      "Return borrowed items and cancel upcoming reservations (My Stuff) before deleting your account",
    );
  }
  const ts = nowIso();
  for (const garageId of primary.garages_member_of) {
    await updateUserFields(garageId, user.phone, { deleted_at: ts });
  }
  // Nothing may be handed to an account that can no longer act: withdraw the
  // caller's pending requests (so the owner cannot approve them) and waitlist
  // places (so a promotion never lands on them). The pending write is
  // conditional; one the owner approved in the meantime is left as it is.
  for (const r of reservations.filter((x) => x.status === "pending")) {
    const {
      PK: _pk,
      SK: _sk,
      GSI1PK: _gpk,
      GSI1SK: _gsk,
      ...stored
    } = r as Reservation & Record<string, unknown>;
    await putReservationIfStatus({ ...stored, status: "cancelled" }, "pending");
  }
  for (const garageId of primary.garages_member_of) {
    for (const w of await listWaitlistForPhone(garageId, user.phone)) {
      await deleteWaitlist(garageId, w.item_id, w.joined_at, user.phone);
    }
  }
  // The account-cleaner Lambda hard-deletes records 30 days after deleted_at.
  return c.json({ scheduled_for_hard_delete_at: ts, status: "deletion_requested" });
});

// Undo a deletion request within the 30-day window: clears deleted_at on every
// profile row, which restores garage access and notifications. Idempotent: an
// account with no pending deletion gets the same answer. Requests withdrawn by
// the delete-request (pending reservations, waitlist places) stay withdrawn.
// After the cleaner has run there are no profile rows left, so this is a 404.
meRoutes.use("/v1/me/delete-request/cancel", idempotency());
meRoutes.post("/v1/me/delete-request/cancel", requireIdempotencyKey(), async (c) => {
  const user = mustUser(c);
  const profiles = await listUserProfiles(user.phone);
  if (profiles.length === 0) throw new ApiError("not_found", "User not found");
  for (const p of profiles) {
    if (!p.deleted_at) continue;
    const pk = (p as { PK?: string }).PK;
    if (typeof pk === "string" && pk.startsWith("TENANT#")) {
      await removeUserFields(pk.slice(7), user.phone, ["deleted_at"]);
    }
  }
  return c.json({ status: "deletion_cancelled" });
});

// Table keys and index attributes are storage details, not the user's data.
const STORAGE_KEY = /^(PK|SK|GSI\d+(PK|SK))$/;
// Phone numbers that are not the caller's (the owner who vouched or decided)
// stay out of the export: members never see other people's phones.
const PHONE_VALUE = /^\+\d{6,15}$/;
// The same inside free text (a note or notification payload quoting a number).
const PHONE_IN_TEXT = /\+\d{6,15}\b/g;

function exportValue(v: unknown, callerPhone: string): unknown {
  if (typeof v === "string") {
    return v.replace(PHONE_IN_TEXT, (m) => (m === callerPhone ? m : "[redacted]"));
  }
  if (Array.isArray(v)) {
    return v
      .filter((x) => !(typeof x === "string" && PHONE_VALUE.test(x) && x !== callerPhone))
      .map((x) => exportValue(x, callerPhone));
  }
  if (v !== null && typeof v === "object") return exportRow(v, callerPhone);
  return v;
}

// Drops storage keys and other people's phone-valued fields at every depth
// (nested payloads included) and redacts other phones quoted inside text.
function exportRow(row: object, callerPhone: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(
        ([k, v]) =>
          !STORAGE_KEY.test(k) &&
          !(typeof v === "string" && PHONE_VALUE.test(v) && v !== callerPhone),
      )
      .map(([k, v]) => [k, exportValue(v, callerPhone)]),
  );
}

// The export is returned to the signed-in caller as a JSON download. It used to be
// emailed to a caller-chosen ?email= address (any recipient, via the operator's SES
// sender); users have no verified email, so there is no address to bind it to.
// It covers every record the service keys by the caller's phone (the same set
// the account cleaner scrubs). Memberships use the member-facing view, so the
// owner's private notes stay private here too.
meRoutes.get("/v1/me/data-export", async (c) => {
  const user = mustUser(c);
  const phone = user.phone;
  const profiles = await listUserIndexRows(phone, "USER#");
  if (profiles.length === 0) throw new ApiError("not_found", "User not found");
  const loans = await listUserIndexRows(phone, "LOAN#");
  const reservations = await listUserIndexRows(phone, "RES#");

  const garageIds = new Set<string>();
  for (const p of profiles) {
    for (const g of (p as unknown as User).garages_member_of ?? []) garageIds.add(g);
    const pk = p["PK"];
    if (typeof pk === "string" && pk.startsWith("TENANT#")) garageIds.add(pk.slice(7));
  }
  for (const r of [...loans, ...reservations]) {
    if (typeof r["garage_id"] === "string") garageIds.add(r["garage_id"]);
  }

  const memberships: MemberMembershipView[] = [];
  const waitlist: object[] = [];
  const donations: object[] = [];
  const wishlistRequests: object[] = [];
  const wishlistVotes: object[] = [];
  for (const garageId of [...garageIds].sort()) {
    const m = await getMembership(garageId, phone);
    if (m) memberships.push(memberMembershipView(m));
    waitlist.push(...(await listWaitlistForPhone(garageId, phone)));
    donations.push(
      ...(await listDonations(garageId))
        .filter((d) => d.donor_phone === phone)
        .map(memberDonationView),
    );
    wishlistRequests.push(
      ...(await listWishlistRequests(garageId)).filter((w) => w.requester_phone === phone),
    );
    wishlistVotes.push(...(await listAllWishlistVotesForVoter(garageId, phone)));
  }
  const notifications = await listNotifications(phone);
  const pushSubscriptions = (await listPushSubscriptions(phone)).map((p) => ({
    endpoint: p.endpoint,
    created_at: p.created_at,
  }));

  const clean = (rows: object[]): Record<string, unknown>[] => rows.map((r) => exportRow(r, phone));
  const exportPayload = {
    exported_at: nowIso(),
    phone,
    garages: [...garageIds].sort(),
    profiles: clean(profiles),
    memberships,
    loans: clean(loans),
    reservations: clean(reservations),
    waitlist: clean(waitlist),
    donations: clean(donations),
    wishlist_requests: clean(wishlistRequests),
    wishlist_votes: clean(wishlistVotes),
    notifications: clean(notifications),
    push_subscriptions: pushSubscriptions,
  };
  c.header("Cache-Control", "no-store");
  c.header("Content-Disposition", 'attachment; filename="garageborrow-export.json"');
  return c.json(exportPayload);
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// GET /v1/me/notifications — last 30 days, sorted desc by sent_at. Optional
// ?unread=true|false filter, opaque cursor pagination.
meRoutes.get("/v1/me/notifications", async (c) => {
  const user = mustUser(c);
  const params = parsePageParams(c);
  const unreadRaw = c.req.query("unread");
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const all = await listNotifications(user.phone);
  let scoped = all.filter((n) => n.sent_at >= cutoff);
  if (unreadRaw === "true") {
    scoped = scoped.filter((n) => !n.read_at);
  } else if (unreadRaw === "false") {
    scoped = scoped.filter((n) => Boolean(n.read_at));
  }
  scoped.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  const { page, next_cursor } = paginate(scoped, params);
  return c.json(next_cursor ? { items: page, next_cursor } : { items: page });
});

meRoutes.post("/v1/me/notifications/:id/read", async (c) => {
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing notification id");
  const existing = await getNotification(user.phone, id);
  if (!existing) throw new ApiError("not_found", "Notification not found");
  if (existing.read_at) {
    return c.json({ notification: existing });
  }
  const updated = { ...existing, read_at: nowIso() };
  await putNotification(updated);
  return c.json({ notification: updated });
});

// GET /v1/me/donations — cross-garage list of donations the caller has
// offered, sorted desc by created_at, opaque cursor pagination.
meRoutes.get("/v1/me/donations", async (c) => {
  const user = mustUser(c);
  const params = parsePageParams(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const all = [];
  for (const garageId of primary.garages_member_of) {
    const garageDonations = await listDonations(garageId);
    for (const d of garageDonations) {
      if (d.donor_phone === user.phone) all.push(d);
    }
  }
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { page, next_cursor } = paginate(all.map(memberDonationView), params);
  return c.json(next_cursor ? { donations: page, next_cursor } : { donations: page });
});

// GET /v1/me/stuff?garage=<id> — My Stuff for one garage: the caller's loans
// that are out, their pending or approved reservations that have not ended,
// their waitlist places (position recomputed from joined_at, the stored one
// is not renumbered when someone leaves) and their borrow counters. The same
// garage checks as /v1/g/:garage routes apply (404 unknown garage, 403 for a
// non-member or a member whose deletion is pending). Loans and reservations
// come from GSI1 (keyed by the caller's phone, eventually consistent), so a
// row written a moment ago may show on the next refresh.
meRoutes.get("/v1/me/stuff", async (c) => {
  const user = mustUser(c);
  const garageId = c.req.query("garage");
  if (!garageId) throw new ApiError("bad_request", "Missing ?garage");
  const { garage, membership } = await resolveGarageContext(user, garageId);
  const now = Date.now();
  const mine = (row: Record<string, unknown>): boolean =>
    row["garage_id"] === garage.id && row["borrower_phone"] === user.phone;

  const [loanRows, reservationRows, waitlistRows] = await Promise.all([
    listUserIndexRows(user.phone, "LOAN#"),
    listUserIndexRows(user.phone, "RES#"),
    listWaitlistByGarage(garage.id),
  ]);
  const loans = (loanRows.filter(mine) as unknown as Loan[])
    .filter((l) => l.status === "active" || l.status === "overdue")
    .sort((a, b) => a.expected_return_at.localeCompare(b.expected_return_at));
  const reservations = (reservationRows.filter(mine) as unknown as Reservation[])
    .filter(
      (r) => (r.status === "pending" || r.status === "approved") && Date.parse(r.end_at) > now,
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const lines = new Map<string, WaitlistEntry[]>();
  for (const w of waitlistRows) {
    const line = lines.get(w.item_id) ?? [];
    line.push(w);
    lines.set(w.item_id, line);
  }
  const waitlist: WaitlistEntry[] = [];
  for (const line of lines.values()) {
    line.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    line.forEach((w, idx) => {
      if (w.borrower_phone === user.phone) waitlist.push({ ...w, position: idx + 1 });
    });
  }
  waitlist.sort((a, b) => a.joined_at.localeCompare(b.joined_at));

  const itemIds = [...new Set([...loans, ...reservations, ...waitlist].map((row) => row.item_id))];
  const items = new Map(
    await Promise.all(itemIds.map(async (id) => [id, await getItem(garage.id, id)] as const)),
  );
  const itemView = (id: string): MyStuffItemView => myStuffItemView(items.get(id), id);

  return c.json({
    loans: loans.map((l) => ({ loan: memberLoanView(l), item: itemView(l.item_id) })),
    reservations: reservations.map((r) => ({
      reservation: memberReservationView(r),
      item: itemView(r.item_id),
    })),
    waitlist: waitlist.map((w) => ({ entry: memberWaitlistView(w), item: itemView(w.item_id) })),
    stats: {
      borrows_total: membership.borrows_total,
      returns_on_time: membership.returns_on_time,
      borrows_active: membership.borrows_active,
    },
  });
});

meRoutes.post("/v1/me/notifications/read-all", async (c) => {
  const user = mustUser(c);
  const all = await listNotifications(user.phone);
  const ts = nowIso();
  let count = 0;
  for (const n of all) {
    if (n.read_at) continue;
    await putNotification({ ...n, read_at: ts });
    count += 1;
  }
  return c.json({ marked_read: count });
});

const PushSubSchema = z.object({
  endpoint: HttpUrl,
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

meRoutes.use("/v1/me/push-subscription", idempotency());
meRoutes.post("/v1/me/push-subscription", async (c) => {
  const user = mustUser(c);
  const body = PushSubSchema.parse(await c.req.json());
  const sub = {
    user_phone: user.phone,
    endpoint: body.endpoint,
    keys: body.keys,
    created_at: nowIso(),
  };
  const hash = createHash("sha256").update(body.endpoint).digest("hex").slice(0, 32);
  await putPushSubscription(sub, hash);
  // Touch the user's last_seen_at while we're here.
  const primary = await getUserAnyGarage(user.phone);
  if (primary) {
    for (const garageId of primary.garages_member_of) {
      await updateUserFields(garageId, user.phone, { last_seen_at: nowIso() });
    }
  }
  return c.json({ id: newId(), status: "registered" }, 201);
});
