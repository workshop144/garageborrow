import type { Context, MiddlewareHandler, Next } from "hono";

import { ApiError } from "../lib/errors.js";
import { getGarage } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";

// Loads the garage record from the URL :garage param, ensures the caller is
// the registered owner_phone, and stores both garage and isOwner=true on the
// context for downstream handlers.
export function ownerOnly(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get("user");
    if (!user) throw new ApiError("unauthorized", "Authentication required");
    const garageId = c.req.param("garage");
    if (!garageId) throw new ApiError("bad_request", "Missing :garage param");
    const garage = await getGarage(garageId);
    if (!garage) throw new ApiError("not_found", "Garage not found");
    if (garage.owner_phone !== user.phone) {
      throw new ApiError("forbidden", "Owner only");
    }
    c.set("garage", garage);
    c.set("isOwner", true);
    await next();
  };
}
