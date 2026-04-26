import { Hono } from "hono";
import {
  GarageStatusSchema,
  NonprofitOrgSchema,
  TierLabelsSchema,
  TierNameSchema,
} from "@garageborrow/shared";
import type { Garage, GarageMembership } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { invokeNotifier } from "../lib/invoke.js";
import { getMembership, listMembers, putGarage, putMembership } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("/v1/g/:garage/admin/members", requireAuth(), ownerOnly());
adminRoutes.use("/v1/g/:garage/admin/members/*", requireAuth(), ownerOnly());
adminRoutes.use("/v1/g/:garage/admin/promotion-suggestions", requireAuth(), ownerOnly());
adminRoutes.use("/v1/g/:garage/admin/settings", requireAuth(), ownerOnly());

adminRoutes.get("/v1/g/:garage/admin/members", async (c) => {
  const garage = mustGarage(c);
  const members = await listMembers(garage.id);
  return c.json({ members });
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
  const updated: GarageMembership = {
    ...existing,
    ...(body.tier ? { tier: body.tier } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.ai_budget_override_tokens !== undefined
      ? { ai_budget_override_tokens: body.ai_budget_override_tokens }
      : {}),
  };
  await putMembership(updated);
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

const SettingsPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: GarageStatusSchema.optional(),
    closed_until_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    tier_labels: TierLabelsSchema.optional(),
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
    updated_at: new Date().toISOString(),
  };
  await putGarage(updated);
  return c.json({ garage: updated });
});
