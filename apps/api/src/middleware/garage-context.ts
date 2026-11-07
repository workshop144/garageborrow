import type { Context, MiddlewareHandler, Next } from "hono";
import type { Garage, GarageMembership } from "@garageborrow/shared";

import { ApiError } from "../lib/errors.js";
import { getGarage, getMembership, getUser } from "../lib/repo.js";
import type { AppEnv, AuthUser } from "../lib/types.js";

// Loads the garage and the caller's membership for /v1/g/:garage routes.
// 404 if garage doesn't exist; 403 if the caller is not a member (and not
// the owner — owners are members by definition, but membership records may
// lag behind, so we treat owner_phone as a member shortcut). 403 too once a
// member has asked for their account to be deleted: notifications to them are
// already suppressed and the cleaner will erase them, so they may not borrow,
// reserve or otherwise act in the garage meanwhile. The garage owner is exempt,
// so a pending deletion never leaves a garage without a working admin (item
// management and disputes run through here as well as /admin/*); they can
// still cancel with POST /v1/me/delete-request/cancel like anyone else.
export interface GarageContext {
  garage: Garage;
  isOwner: boolean;
  membership: GarageMembership;
}

// The checks behind loadGarageContext, for routes that take the garage from
// somewhere other than the :garage path param (GET /v1/me/stuff?garage=).
export async function resolveGarageContext(
  user: AuthUser,
  garageId: string,
): Promise<GarageContext> {
  const garage = await getGarage(garageId);
  if (!garage) throw new ApiError("not_found", "Garage not found");
  const isOwner = garage.owner_phone === user.phone;
  if (!isOwner) {
    const profile = await getUser(garageId, user.phone);
    if (profile?.deleted_at) {
      throw new ApiError("forbidden", "Account is scheduled for deletion");
    }
  }
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
  return { garage, isOwner, membership };
}

export function loadGarageContext(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get("user");
    if (!user) throw new ApiError("unauthorized", "Authentication required");
    const garageId = c.req.param("garage");
    if (!garageId) throw new ApiError("bad_request", "Missing :garage param");
    const { garage, isOwner, membership } = await resolveGarageContext(user, garageId);
    c.set("garage", garage);
    c.set("isOwner", isOwner);
    c.set("membership", membership);
    await next();
  };
}
