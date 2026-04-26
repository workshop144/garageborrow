import type { Context, MiddlewareHandler, Next } from "hono";

import { ApiError } from "../lib/errors.js";
import { getGarage, getMembership } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";

// Loads the garage and the caller's membership for /v1/g/:garage routes.
// 404 if garage doesn't exist; 403 if the caller is not a member (and not
// the owner — owners are members by definition, but membership records may
// lag behind, so we treat owner_phone as a member shortcut).
export function loadGarageContext(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get("user");
    if (!user) throw new ApiError("unauthorized", "Authentication required");
    const garageId = c.req.param("garage");
    if (!garageId) throw new ApiError("bad_request", "Missing :garage param");
    const garage = await getGarage(garageId);
    if (!garage) throw new ApiError("not_found", "Garage not found");
    c.set("garage", garage);
    const isOwner = garage.owner_phone === user.phone;
    c.set("isOwner", isOwner);
    let membership = await getMembership(garageId, user.phone);
    if (!membership) {
      if (!isOwner) throw new ApiError("forbidden", "Not a member of this garage");
      membership = {
        garage_id: garage.id,
        user_phone: user.phone,
        tier: "family",
        joined_at: garage.created_at,
        borrows_total: 0,
        borrows_active: 0,
        returns_on_time: 0,
        returns_late: 0,
        no_shows: 0,
        ai_tokens_used_this_month: 0,
        ai_tokens_used_total: 0,
        celebration_pending: false,
      };
    }
    c.set("membership", membership);
    await next();
  };
}
