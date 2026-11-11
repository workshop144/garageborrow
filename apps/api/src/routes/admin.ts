import { Hono } from "hono";
import {
  GarageStatusSchema,
  IncidentStatusSchema,
  ItemSchema,
  MAX_LOAN_DAYS,
  NonprofitOrgSchema,
  PhoneE164,
  ReservationStatusSchema,
  TierLabelsSchema,
  TierNameSchema,
} from "@garageborrow/shared";
import type {
  AuditLogEntry,
  GarageInvite,
  Garage,
  IncidentReport,
  Item,
  ItemStatus,
  Loan,
  Reservation,
} from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import {
  paginate,
  paginateByKey,
  parseKeysetPageParams,
  parsePageParams,
} from "../lib/pagination.js";
import { PhotoKey } from "../lib/photo-key.js";
import {
  deleteInvite,
  getIncident,
  getLoan,
  getMembership,
  getUser,
  listAuditLogEntries,
  listIncidents,
  listInvitesForGarage,
  listLoansByGarage,
  listMembers,
  putGarage,
  putIncident,
  putInvite,
  putItem,
  updateMembershipFields,
  type LoanRecord,
  getItem,
  getReservation,
  listReservationsByGarage,
  putReservationIfPending,
  putReservationIfStatus,
  reservationRow,
  STILL_PENDING,
  updateLoan,
} from "../lib/repo.js";
import { commitAvailable } from "../lib/availability.js";
import { settleReturnCounters } from "../lib/loan-lifecycle.js";
import type { AppEnv } from "../lib/types.js";
import { audit, setAuditDetails } from "../middleware/audit.js";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const adminRoutes = new Hono<AppEnv>();

// All /admin/* mutations are owner-only and audited. The audit middleware
// is mounted broadly so any future admin route picks it up automatically.
adminRoutes.use("/v1/g/:garage/admin/*", requireAuth(), ownerOnly(), audit());

// ─────────────────────────── Invites ────────────────────────────
//
// Self-service sign-up is closed: a new number can only get an account through
// an owner's invite (POST /v1/auth/start creates the Cognito user, POST
// /v1/me/join turns the invite into a membership). Invites expire after
// INVITE_TTL_DAYS and a garage holds at most MAX_PENDING_INVITES at once. Nothing
// is texted here; the owner tells the neighbor to sign in.

const INVITE_TTL_DAYS = 14;
export const MAX_PENDING_INVITES = 200;

const InviteBodySchema = z
  .object({ phone: PhoneE164, tier: TierNameSchema.default("howdy") })
  .strict();

adminRoutes.get("/v1/g/:garage/admin/invites", async (c) => {
  const garage = mustGarage(c);
  const invites = await listInvitesForGarage(garage.id, Math.floor(Date.now() / 1000));
  invites.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return c.json({ invites });
});

adminRoutes.post("/v1/g/:garage/admin/invites", async (c) => {
  const garage = mustGarage(c);
  const user = c.get("user");
  if (!user) throw new ApiError("unauthorized", "Authentication required");
  const body = InviteBodySchema.parse(await c.req.json());
  if (await getMembership(garage.id, body.phone)) {
    throw new ApiError("conflict", "Already a member of this garage");
  }
  const now = Math.floor(Date.now() / 1000);
  const pending = await listInvitesForGarage(garage.id, now);
  if (pending.length >= MAX_PENDING_INVITES && !pending.some((i) => i.phone === body.phone)) {
    throw new ApiError("conflict", `At most ${MAX_PENDING_INVITES} pending invites`);
  }
  const invite: GarageInvite = {
    garage_id: garage.id,
    phone: body.phone,
    tier: body.tier,
    invited_by_phone: user.phone,
    created_at: nowIso(),
    expires_at: now + INVITE_TTL_DAYS * 86400,
  };
  await putInvite(invite);
  setAuditDetails(c, {
    action_type: "invite_created",
    entity_type: "member",
    entity_id: body.phone,
    after_snapshot: invite,
  });
  return c.json({ invite }, 201);
});

adminRoutes.delete("/v1/g/:garage/admin/invites/:phone", async (c) => {
  const garage = mustGarage(c);
  const phone = PhoneE164.parse(c.req.param("phone"));
  await deleteInvite(phone, garage.id);
  setAuditDetails(c, {
    action_type: "invite_revoked",
    entity_type: "member",
    entity_id: phone,
  });
  return c.json({ status: "revoked" });
});

// ─────────────────────────── Members ────────────────────────────

adminRoutes.get("/v1/g/:garage/admin/members", async (c) => {
  const garage = mustGarage(c);
  const params = parsePageParams(c);
  const all = await listMembers(garage.id);
  // Stable sort so cursors paginate the same view across calls.
  all.sort((a, b) => a.user_phone.localeCompare(b.user_phone));
  const { page, next_cursor } = paginate(all, params);
  return c.json(next_cursor ? { members: page, next_cursor } : { members: page });
});

const MemberPatchSchema = z
  .object({
    tier: TierNameSchema.optional(),
    notes: z.string().optional(),
    ai_budget_override_tokens: z.number().int().nonnegative().optional(),
  })
  .strict();

adminRoutes.use("/v1/g/:garage/admin/members/:phone", idempotency());
adminRoutes.patch("/v1/g/:garage/admin/members/:phone", async (c) => {
  const garage = mustGarage(c);
  const phone = c.req.param("phone");
  if (!phone) throw new ApiError("bad_request", "Missing phone");
  const existing = await getMembership(garage.id, phone);
  if (!existing) throw new ApiError("not_found", "Member not found");
  const body = MemberPatchSchema.parse(await c.req.json());
  const promoted = body.tier !== undefined && body.tier !== existing.tier;
  const promotedToFamily = promoted && body.tier === "family" && existing.tier !== "family";
  // Only the changed fields are written: borrow and return counters move by
  // atomic ADD meanwhile, and a whole-row put would undo them (review F4).
  const updated = await updateMembershipFields(garage.id, phone, {
    ...(body.tier ? { tier: body.tier } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.ai_budget_override_tokens !== undefined
      ? { ai_budget_override_tokens: body.ai_budget_override_tokens }
      : {}),
    // Promotion to family lights up the celebration overlay on the next
    // /v1/me read. Demotion or lateral moves don't touch the flag.
    ...(promotedToFamily ? { celebration_pending: true } : {}),
  });
  if (!updated) throw new ApiError("not_found", "Member not found");
  setAuditDetails(c, {
    action_type: promoted ? "member.tier_changed" : "member.updated",
    entity_type: "member",
    entity_id: phone,
    before_snapshot: existing,
    after_snapshot: updated,
  });
  if (promoted && body.tier) {
    await invokeNotifier({
      type: "tier_promoted",
      garage_id: garage.id,
      user_phone: phone,
      payload: { new_tier: body.tier, promoted_to_family: promotedToFamily },
    });
  }
  return c.json({ membership: updated });
});

const PROMOTION_THRESHOLD = 3;

adminRoutes.get("/v1/g/:garage/admin/promotion-suggestions", async (c) => {
  const garage = mustGarage(c);
  const members = await listMembers(garage.id);
  const suggestions = members
    .filter((m) => m.tier === "howdy" && m.returns_on_time >= PROMOTION_THRESHOLD)
    .map((m) => ({
      user_phone: m.user_phone,
      current_tier: m.tier,
      suggested_tier: "friend" as const,
      returns_on_time: m.returns_on_time,
    }));
  return c.json({ suggestions, threshold: PROMOTION_THRESHOLD });
});

// ─────────────────────────── Settings ────────────────────────────

const SettingsPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: GarageStatusSchema.optional(),
    closed_until_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    // unwrap(): Zod 4 would otherwise apply the default when the key is omitted.
    tier_labels: TierLabelsSchema.unwrap().optional(),
    quality_tiers: z.array(z.string().min(1)).optional(),
    payforward_orgs: z.array(NonprofitOrgSchema).optional(),
    payforward_intro_copy: z.string().optional(),
    ai_enabled: z.boolean().optional(),
    ai_min_tier: TierNameSchema.optional(),
    ai_total_monthly_cap_cents: z.number().int().nonnegative().optional(),
    ai_default_user_monthly_tokens: z.number().int().nonnegative().optional(),
    ai_default_model: z.enum(["haiku", "sonnet"]).optional(),
    vouching_required: z.boolean().optional(),
    wishlist_enabled: z.boolean().optional(),
    wishlist_popular_threshold: z.number().int().positive().optional(),
  })
  .strict();

adminRoutes.get("/v1/g/:garage/admin/settings", async (c) => {
  const garage = mustGarage(c);
  return c.json({ garage });
});

adminRoutes.use("/v1/g/:garage/admin/settings", idempotency());
adminRoutes.patch("/v1/g/:garage/admin/settings", async (c) => {
  const garage = mustGarage(c);
  const body = SettingsPatchSchema.parse(await c.req.json());
  const updated: Garage = {
    ...garage,
    ...(body.name ? { name: body.name } : {}),
    ...(body.status ? { status: body.status } : {}),
    ...(body.closed_until_date !== undefined ? { closed_until_date: body.closed_until_date } : {}),
    ...(body.tier_labels ? { tier_labels: body.tier_labels } : {}),
    ...(body.quality_tiers ? { quality_tiers: body.quality_tiers } : {}),
    ...(body.payforward_orgs ? { payforward_orgs: body.payforward_orgs } : {}),
    ...(body.payforward_intro_copy !== undefined
      ? { payforward_intro_copy: body.payforward_intro_copy }
      : {}),
    ...(body.ai_enabled !== undefined ? { ai_enabled: body.ai_enabled } : {}),
    ...(body.ai_min_tier ? { ai_min_tier: body.ai_min_tier } : {}),
    ...(body.ai_total_monthly_cap_cents !== undefined
      ? { ai_total_monthly_cap_cents: body.ai_total_monthly_cap_cents }
      : {}),
    ...(body.ai_default_user_monthly_tokens !== undefined
      ? { ai_default_user_monthly_tokens: body.ai_default_user_monthly_tokens }
      : {}),
    ...(body.ai_default_model ? { ai_default_model: body.ai_default_model } : {}),
    ...(body.vouching_required !== undefined ? { vouching_required: body.vouching_required } : {}),
    ...(body.wishlist_enabled !== undefined ? { wishlist_enabled: body.wishlist_enabled } : {}),
    ...(body.wishlist_popular_threshold !== undefined
      ? { wishlist_popular_threshold: body.wishlist_popular_threshold }
      : {}),
    updated_at: nowIso(),
  };
  await putGarage(updated);
  setAuditDetails(c, {
    action_type: "garage.settings_updated",
    entity_type: "garage",
    entity_id: garage.id,
    before_snapshot: garage,
    after_snapshot: updated,
  });
  return c.json({ garage: updated });
});

// ─────────────────────────── Incidents ────────────────────────────

adminRoutes.get("/v1/g/:garage/admin/incidents", async (c) => {
  const garage = mustGarage(c);
  const params = parsePageParams(c);
  const statusRaw = c.req.query("status");
  let all = await listIncidents(garage.id);
  if (statusRaw) {
    const parsed = IncidentStatusSchema.safeParse(statusRaw);
    if (!parsed.success) {
      throw new ApiError("bad_request", "Invalid status; expected open|resolved|closed");
    }
    all = all.filter((i) => i.status === parsed.data);
  }
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { page, next_cursor } = paginate(all, params);
  return c.json(next_cursor ? { incidents: page, next_cursor } : { incidents: page });
});

const IncidentPatchSchema = z
  .object({
    status: IncidentStatusSchema.optional(),
    resolution_notes: z.string().max(1000).optional(),
  })
  .strict();

adminRoutes.use("/v1/g/:garage/admin/incidents/:id", idempotency());
adminRoutes.patch("/v1/g/:garage/admin/incidents/:id", async (c) => {
  const garage = mustGarage(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing incident id");
  const existing = await getIncident(garage.id, id);
  if (!existing) throw new ApiError("not_found", "Incident not found");
  const body = IncidentPatchSchema.parse(await c.req.json());
  const ts = nowIso();
  const updated: IncidentReport = {
    ...existing,
    ...(body.status ? { status: body.status } : {}),
    ...(body.status && body.status !== "open" && !existing.resolved_at ? { resolved_at: ts } : {}),
    // Owner notes get their own field; they used to overwrite the reporter's
    // suggested_action.
    ...(body.resolution_notes !== undefined ? { resolution_notes: body.resolution_notes } : {}),
  };
  await putIncident(updated);
  setAuditDetails(c, {
    action_type: "incident.updated",
    entity_type: "incident",
    entity_id: id,
    before_snapshot: existing,
    after_snapshot: updated,
  });
  return c.json({ incident: updated });
});

// ─────────────────────────── Active loans ────────────────────────

// Owner-facing live loan board: every loan currently with status === "active",
// enriched with the borrower's display name (so the UI doesn't have to fan
// out a query per row). Reads only — no audit entry is written here.
adminRoutes.get("/v1/g/:garage/admin/active-loans", async (c) => {
  const garage = mustGarage(c);
  const loans = await listLoansByGarage(garage.id);
  const active = loans.filter((l) => l.status === "active");
  active.sort((a, b) => a.expected_return_at.localeCompare(b.expected_return_at));
  const enriched: Array<Loan & { borrower_display_name: string; item_id: string }> = [];
  for (const loan of active) {
    const borrower = await getUser(garage.id, loan.borrower_phone);
    enriched.push({
      ...loan,
      borrower_display_name: borrower?.display_name ?? loan.borrower_phone.slice(-4),
    });
  }
  return c.json({ loans: enriched });
});

adminRoutes.use("/v1/g/:garage/admin/loans/:id/return", idempotency());
adminRoutes.post("/v1/g/:garage/admin/loans/:id/return", async (c) => {
  const garage = mustGarage(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing loan id");
  const loan: LoanRecord | undefined = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  if (loan.status !== "active" && loan.status !== "overdue") {
    throw new ApiError("conflict", "Loan is not out");
  }
  const ts = nowIso();
  // Keep the borrower's claim time when there is one: that is when it came back.
  const returnedAt = loan.return_claimed_at ? (loan.actual_return_at ?? ts) : ts;
  const updated: LoanRecord = { ...loan, status: "returned", actual_return_at: returnedAt };
  if (!(await updateLoan(updated, loan))) {
    throw new ApiError("conflict", "This loan just changed; reload and try again");
  }
  await settleReturnCounters(loan, returnedAt);
  setAuditDetails(c, {
    action_type: "loan.owner_returned",
    entity_type: "item",
    entity_id: loan.item_id,
    before_snapshot: loan,
    after_snapshot: updated,
  });
  await invokeNotifier({
    type: "loan_returned",
    garage_id: garage.id,
    user_phone: loan.borrower_phone,
    payload: { loan_id: loan.id, claimed_at: ts, by: "owner" },
  });
  await invokeNotifier({
    type: "waitlist_unblocked",
    garage_id: garage.id,
    payload: { item_id: loan.item_id },
  });
  return c.json({ loan: updated });
});

adminRoutes.use("/v1/g/:garage/admin/loans/:id/remind", idempotency());
adminRoutes.post("/v1/g/:garage/admin/loans/:id/remind", async (c) => {
  const garage = mustGarage(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing loan id");
  const loan = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  setAuditDetails(c, {
    action_type: "loan.reminder_sent",
    entity_type: "item",
    entity_id: loan.item_id,
    before_snapshot: null,
    after_snapshot: { loan_id: loan.id, borrower_phone: loan.borrower_phone },
  });
  await invokeNotifier({
    type: "loan_reminder",
    garage_id: garage.id,
    user_phone: loan.borrower_phone,
    payload: { loan_id: loan.id, expected_return_at: loan.expected_return_at },
  });
  return c.json({ status: "queued" });
});

// ─────────────────────────── Pending requests ────────────────────
//
// Borrows and reservations that need approval wait as pending reservations.
// The owner lists them and approves (which takes a unit, atomically, like an
// auto-approved reservation) or declines; the member is told either way.

adminRoutes.get("/v1/g/:garage/admin/reservations", async (c) => {
  const garage = mustGarage(c);
  const status = ReservationStatusSchema.parse(c.req.query("status") ?? "pending");
  const params = parseKeysetPageParams(c);
  const all = await listReservationsByGarage(garage.id);
  const rows = all.filter((r) => r.status === status);
  // Keyset cursor on (start_at, id): deciding rows from one page shrinks the
  // pending queue, and an offset cursor would then skip that many requests.
  rows.sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id));
  const { page, next_cursor } = paginateByKey(rows, params, (r) => [r.start_at, r.id]);
  return c.json(next_cursor ? { reservations: page, next_cursor } : { reservations: page });
});

const ReservationDecideSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("decline"), decline_reason: z.string().max(500).optional() }),
]);

adminRoutes.use("/v1/g/:garage/admin/reservations/:id/decide", idempotency());
adminRoutes.post("/v1/g/:garage/admin/reservations/:id/decide", async (c) => {
  const garage = mustGarage(c);
  const owner = c.get("user");
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing reservation id");
  const body = ReservationDecideSchema.parse(await c.req.json());
  const res = await getReservation(garage.id, id);
  if (!res) throw new ApiError("not_found", "Reservation not found");
  if (res.status !== "pending") {
    throw new ApiError("conflict", `Reservation already ${res.status}`);
  }
  const ts = nowIso();
  const decided = { decided_at: ts, ...(owner ? { decided_by_phone: owner.phone } : {}) };
  let updated: Reservation;
  if (body.decision === "approve") {
    const item = await getItem(garage.id, res.item_id);
    if (!item) throw new ApiError("not_found", "Item not found");
    updated = await commitAvailable(
      {
        item,
        instanceId: res.instance_id,
        borrowerPhone: res.borrower_phone,
        window: { start: Date.parse(res.start_at), end: Date.parse(res.end_at) },
      },
      (instanceId): Reservation => ({
        ...res,
        ...(instanceId ? { instance_id: instanceId } : {}),
        status: "approved",
        ...decided,
      }),
      reservationRow,
      STILL_PENDING,
    );
  } else {
    updated = {
      ...res,
      status: "declined",
      ...decided,
      ...(body.decline_reason ? { decline_reason: body.decline_reason } : {}),
    };
    if (!(await putReservationIfPending(updated))) {
      throw new ApiError("conflict", "Reservation already decided");
    }
  }
  setAuditDetails(c, {
    action_type: `reservation.${updated.status}`,
    entity_type: "item",
    entity_id: res.item_id,
    before_snapshot: res,
    after_snapshot: updated,
  });
  await invokeNotifier({
    type: res.source === "borrow" ? "borrow_request_decided" : "reservation_decided",
    garage_id: garage.id,
    user_phone: res.borrower_phone,
    payload: { reservation_id: res.id, item_id: res.item_id, status: updated.status },
  });
  return c.json({ reservation: updated });
});

// The owner releases an approved reservation (for example one that holds a
// unit too long). Conditional on the status read, so a concurrent borrower
// cancel or a second owner click is a clean 409; a cancelled one is a no-op.
// Pending requests are declined through /decide instead.
adminRoutes.use("/v1/g/:garage/admin/reservations/:id/cancel", idempotency());
adminRoutes.post("/v1/g/:garage/admin/reservations/:id/cancel", async (c) => {
  const garage = mustGarage(c);
  const owner = c.get("user");
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing reservation id");
  const existing = await getReservation(garage.id, id);
  if (!existing) throw new ApiError("not_found", "Reservation not found");
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gpk,
    GSI1SK: _gsk,
    ...res
  } = existing as Reservation & Record<string, unknown>;
  if (res.status === "cancelled") return c.json({ reservation: res });
  if (res.status !== "approved") {
    throw new ApiError("conflict", `Reservation is ${res.status}`);
  }
  const updated: Reservation = {
    ...res,
    status: "cancelled",
    // Separate from decided_at/decided_by_phone, which keep the approval.
    cancelled_at: nowIso(),
    ...(owner ? { cancelled_by_phone: owner.phone } : {}),
  };
  if (!(await putReservationIfStatus(updated, "approved"))) {
    throw new ApiError("conflict", "Reservation changed, reload and try again");
  }
  setAuditDetails(c, {
    action_type: "reservation.cancelled_by_owner",
    entity_type: "item",
    entity_id: res.item_id,
    before_snapshot: res,
    after_snapshot: updated,
  });
  await invokeNotifier({
    type: res.source === "borrow" ? "borrow_request_decided" : "reservation_decided",
    garage_id: garage.id,
    user_phone: res.borrower_phone,
    payload: { reservation_id: res.id, item_id: res.item_id, status: "cancelled" },
  });
  return c.json({ reservation: updated });
});

// ─────────────────────────── Audit log ───────────────────────────

const AuditLogQuerySchema = z.object({
  action_type: z.string().optional(),
  actor_phone: z.string().optional(),
  entity_type: z.string().optional(),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

adminRoutes.get("/v1/g/:garage/admin/audit-log", async (c) => {
  const garage = mustGarage(c);
  const filters = AuditLogQuerySchema.parse({
    action_type: c.req.query("action_type"),
    actor_phone: c.req.query("actor_phone"),
    entity_type: c.req.query("entity_type"),
    since: c.req.query("since"),
    until: c.req.query("until"),
  });
  const params = parsePageParams(c);
  const all = await listAuditLogEntries(garage.id);
  const filtered = all.filter((e: AuditLogEntry) => {
    if (filters.action_type && e.action_type !== filters.action_type) return false;
    if (filters.actor_phone && e.actor_phone !== filters.actor_phone) return false;
    if (filters.entity_type && e.entity_type !== filters.entity_type) return false;
    if (filters.since && e.date < filters.since) return false;
    if (filters.until && e.date > filters.until) return false;
    return true;
  });
  // Newest first — audit consumers nearly always want the latest first.
  filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { page, next_cursor } = paginate(filtered, params);
  return c.json(next_cursor ? { entries: page, next_cursor } : { entries: page });
});

// ─────────────────────────── Bulk CSV item import ────────────────

// Bulk rows are JSON from the CSV modal, which already converts cells to
// numbers and booleans; a direct API caller may send the CSV text instead.
// Both are accepted, but only exact spellings (2026-11-07 review F8):
// `z.coerce` read "false" as true, "0x10" as 16 and true as 1.
const BulkDurationDays = z
  .union([z.number(), z.string().regex(/^\d{1,3}$/, "Expected a whole number of days")])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive().max(MAX_LOAN_DAYS));
const BulkBoolean = z.union([
  z.boolean(),
  z
    .string()
    .regex(/^(true|false|1|0)$/i, "Expected true, false, 1 or 0")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
]);

const BulkItemRowSchema = z
  .object({
    name: z.string().min(1),
    category: z.string().min(1),
    description: z.string().optional(),
    // CSV cells come through as "" when empty.
    primary_photo_key: PhotoKey.or(z.literal("")).optional(),
    handling_notes: z.string().optional(),
    default_duration_days: BulkDurationDays.optional(),
    requires_approval: BulkBoolean.optional(),
    min_tier: TierNameSchema.optional(),
    auto_approve_tier: TierNameSchema.optional(),
    // In the CSV template, but an item has no quality tier (each instance
    // does), so it is checked for shape and not stored.
    quality_tier: z.string().max(64).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

const BulkImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
});

interface BulkRowSuccess {
  index: number;
  status: "ok";
  item: Item;
}
interface BulkRowError {
  index: number;
  status: "error";
  errors: { path: string; message: string }[];
}
type BulkRowResult = BulkRowSuccess | BulkRowError;

adminRoutes.use("/v1/g/:garage/admin/items/bulk", idempotency());
adminRoutes.post("/v1/g/:garage/admin/items/bulk", async (c) => {
  const garage = mustGarage(c);
  const body = BulkImportSchema.parse(await c.req.json());
  const ts = nowIso();
  const results: BulkRowResult[] = [];
  const created: Item[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const raw = body.rows[i];
    const parsed = BulkItemRowSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({
        index: i,
        status: "error",
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      continue;
    }
    const row = parsed.data;
    const item: Item = {
      id: newId(),
      garage_id: garage.id,
      name: row.name,
      description: row.description ?? "",
      category: row.category,
      primary_photo_key: row.primary_photo_key ?? "",
      ...(row.handling_notes !== undefined ? { handling_notes: row.handling_notes } : {}),
      default_duration_days: row.default_duration_days ?? 3,
      requires_approval: row.requires_approval ?? false,
      min_tier: row.min_tier ?? "howdy",
      auto_approve_tier: row.auto_approve_tier ?? "family",
      tags: row.tags ?? [],
      status: "available" as ItemStatus,
      created_at: ts,
      updated_at: ts,
    };
    await putItem(item);
    created.push(item);
    results.push({ index: i, status: "ok", item });
  }

  setAuditDetails(c, {
    action_type: "items.bulk_imported",
    entity_type: "items_bulk",
    entity_id: `bulk-${ts}`,
    before_snapshot: null,
    after_snapshot: {
      total: body.rows.length,
      created: created.length,
      errors: results.filter((r) => r.status === "error").length,
    },
  });

  return c.json({
    total: body.rows.length,
    created: created.length,
    errors: results.filter((r): r is BulkRowError => r.status === "error").length,
    results,
  });
});

// Re-export the schema for tests that want to round-trip a row outside of
// the request handler.
export { BulkItemRowSchema, ItemSchema as AdminItemSchema };
