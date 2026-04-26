import { Hono } from "hono";
import {
  GarageStatusSchema,
  IncidentStatusSchema,
  ItemSchema,
  NonprofitOrgSchema,
  TierLabelsSchema,
  TierNameSchema,
} from "@garageborrow/shared";
import type {
  AuditLogEntry,
  Garage,
  GarageMembership,
  IncidentReport,
  Item,
  ItemStatus,
  Loan,
} from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import {
  getIncident,
  getLoan,
  getMembership,
  getUser,
  listAuditLogEntries,
  listIncidents,
  listLoansByGarage,
  listMembers,
  putGarage,
  putIncident,
  putItem,
  putLoan,
  putMembership,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { audit, setAuditDetails } from "../middleware/audit.js";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const adminRoutes = new Hono<AppEnv>();

// All /admin/* mutations are owner-only and audited. The audit middleware
// is mounted broadly so any future admin route picks it up automatically.
adminRoutes.use("/v1/g/:garage/admin/*", requireAuth(), ownerOnly(), audit());

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
  const updated: GarageMembership = {
    ...existing,
    ...(body.tier ? { tier: body.tier } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.ai_budget_override_tokens !== undefined
      ? { ai_budget_override_tokens: body.ai_budget_override_tokens }
      : {}),
    // Promotion to family lights up the celebration overlay on the next
    // /v1/me read. Demotion or lateral moves don't touch the flag.
    ...(promotedToFamily ? { celebration_pending: true } : {}),
  };
  await putMembership(updated);
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
      payload: { user_phone: phone, new_tier: body.tier },
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
    tier_labels: TierLabelsSchema.optional(),
    quality_tiers: z.array(z.string().min(1)).optional(),
    payforward_orgs: z.array(NonprofitOrgSchema).optional(),
    payforward_intro_copy: z.string().optional(),
    ai_enabled: z.boolean().optional(),
    ai_min_tier: TierNameSchema.optional(),
    ai_total_monthly_cap_cents: z.number().int().nonnegative().optional(),
    ai_default_user_monthly_tokens: z.number().int().nonnegative().optional(),
    ai_default_model: z.enum(["haiku", "sonnet"]).optional(),
    vouching_required: z.boolean().optional(),
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
    resolution_notes: z.string().optional(),
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
    ...(body.resolution_notes !== undefined ? { suggested_action: body.resolution_notes } : {}),
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
  const loan = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  if (loan.status !== "active") {
    throw new ApiError("conflict", "Loan is not active");
  }
  const ts = nowIso();
  const updated: Loan = { ...loan, status: "returned", actual_return_at: ts };
  await putLoan(updated);
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
    payload: { loan_id: loan.id, claimed_at: ts, by: "owner" },
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
    payload: {
      loan_id: loan.id,
      borrower_phone: loan.borrower_phone,
      expected_return_at: loan.expected_return_at,
    },
  });
  return c.json({ status: "queued" });
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

const BulkItemRowSchema = z
  .object({
    name: z.string().min(1),
    category: z.string().min(1),
    description: z.string().optional(),
    primary_photo_key: z.string().optional(),
    handling_notes: z.string().optional(),
    default_duration_days: z.coerce.number().int().positive().optional(),
    requires_approval: z.coerce.boolean().optional(),
    min_tier: TierNameSchema.optional(),
    auto_approve_tier: TierNameSchema.optional(),
    quality_tier: z.string().optional(),
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
