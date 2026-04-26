import { Hono } from "hono";

import { mustGarage, mustMembership } from "../lib/ctx.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import { listMembers, getUser } from "../lib/repo.js";
import { resolveItemAccess } from "@garageborrow/shared";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";

export const garageRoutes = new Hono<AppEnv>();

garageRoutes.use("/v1/g/:garage", requireAuth(), loadGarageContext());
garageRoutes.use("/v1/g/:garage/members", requireAuth(), loadGarageContext());

// GET /v1/g/:garage — garage profile + the member's *capability* (whether they
// can see the garage at all) but not their tier label. The label is hidden so
// users can't see a leaderboard of their own social position; the UI surfaces
// only what they can borrow, not where they sit.
garageRoutes.get("/v1/g/:garage", async (c) => {
  const garage = mustGarage(c);
  const membership = mustMembership(c);
  return c.json({
    garage: {
      id: garage.id,
      name: garage.name,
      city_display: garage.city_display,
      status: garage.status,
      closed_until_date: garage.closed_until_date,
      payforward_orgs: garage.payforward_orgs,
      payforward_intro_copy: garage.payforward_intro_copy,
      tier_labels: garage.tier_labels,
      ai_enabled: garage.ai_enabled,
      vouching_required: garage.vouching_required,
    },
    member: {
      joined_at: membership.joined_at,
      borrows_total: membership.borrows_total,
      borrows_active: membership.borrows_active,
      // Note: `tier` intentionally omitted — see comment above.
    },
  });
});

garageRoutes.get("/v1/g/:garage/members", async (c) => {
  const garage = mustGarage(c);
  const params = parsePageParams(c);
  const memberships = await listMembers(garage.id);
  memberships.sort((a, b) => a.user_phone.localeCompare(b.user_phone));
  const out: Array<{ phone_last4: string; display_name: string; joined_at: string }> = [];
  for (const m of memberships) {
    const u = await getUser(garage.id, m.user_phone);
    if (!u || u.visibility !== "visible" || u.deleted_at) continue;
    out.push({
      phone_last4: u.phone.slice(-4),
      display_name: u.display_name,
      joined_at: m.joined_at,
    });
  }
  const { page, next_cursor } = paginate(out, params);
  return c.json(next_cursor ? { members: page, next_cursor } : { members: page });
});

// Re-export the helper so other routes can compute access without importing
// from shared at every callsite.
export function itemAccess(
  user_tier: Parameters<typeof resolveItemAccess>[0],
  item_min_tier: Parameters<typeof resolveItemAccess>[1],
  item_auto_approve_tier: Parameters<typeof resolveItemAccess>[2],
): ReturnType<typeof resolveItemAccess> {
  return resolveItemAccess(user_tier, item_min_tier, item_auto_approve_tier);
}
