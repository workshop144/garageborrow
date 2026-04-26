import type { Context } from "hono";
import type { Garage, GarageMembership } from "@garageborrow/shared";

import { ApiError } from "./errors.js";
import type { AppEnv, AuthUser } from "./types.js";

export function mustUser(c: Context<AppEnv>): AuthUser {
  const u = c.get("user");
  if (!u) throw new ApiError("unauthorized", "Authentication required");
  return u;
}

export function mustGarage(c: Context<AppEnv>): Garage {
  const g = c.get("garage");
  if (!g) throw new ApiError("internal_error", "Garage context not loaded");
  return g;
}

export function mustMembership(c: Context<AppEnv>): GarageMembership {
  const m = c.get("membership");
  if (!m) throw new ApiError("internal_error", "Membership context not loaded");
  return m;
}
