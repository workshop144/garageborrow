import { TIER_NAMES } from "../schemas/common.js";
import type { TierName } from "../schemas/common.js";

export const TIER_RANK: Readonly<Record<TierName, number>> = {
  howdy: 0,
  friend: 1,
  family: 2,
};

export type AccessLevel = "hidden" | "request" | "instant";

export function tierRank(tier: TierName): number {
  return TIER_RANK[tier];
}

export function resolveItemAccess(
  user_tier: TierName,
  item_min_tier: TierName,
  item_auto_approve_tier: TierName,
): AccessLevel {
  const u = TIER_RANK[user_tier];
  const min = TIER_RANK[item_min_tier];
  const auto = TIER_RANK[item_auto_approve_tier];
  if (u < min) return "hidden";
  if (u >= auto) return "instant";
  return "request";
}

export const ALL_TIER_NAMES = TIER_NAMES;
