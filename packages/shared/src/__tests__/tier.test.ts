import { describe, expect, it } from "vitest";

import { resolveItemAccess, TIER_RANK } from "../logic/tier.js";
import { TIER_NAMES } from "../schemas/common.js";
import type { TierName } from "../schemas/common.js";

type AccessLevel = "hidden" | "request" | "instant";

function expected(user: TierName, min: TierName, auto: TierName): AccessLevel {
  const u = TIER_RANK[user];
  if (u < TIER_RANK[min]) return "hidden";
  if (u >= TIER_RANK[auto]) return "instant";
  return "request";
}

describe("tier resolution truth table", () => {
  it("ranks the 3 default tiers in order howdy < friend < family", () => {
    expect(TIER_RANK.howdy).toBeLessThan(TIER_RANK.friend);
    expect(TIER_RANK.friend).toBeLessThan(TIER_RANK.family);
  });

  // Full 3 × 3 × 3 = 27 truth table.
  for (const user of TIER_NAMES) {
    for (const min of TIER_NAMES) {
      for (const auto of TIER_NAMES) {
        it(`user=${user} min=${min} auto=${auto} → ${expected(user, min, auto)}`, () => {
          expect(resolveItemAccess(user, min, auto)).toBe(expected(user, min, auto));
        });
      }
    }
  }

  // Spot-checks for the rule statements.
  it("hidden when user_tier rank < item_min_tier rank", () => {
    expect(resolveItemAccess("howdy", "friend", "family")).toBe("hidden");
    expect(resolveItemAccess("friend", "family", "family")).toBe("hidden");
  });

  it("instant when user_tier rank >= item_auto_approve_tier rank", () => {
    expect(resolveItemAccess("family", "howdy", "family")).toBe("instant");
    expect(resolveItemAccess("friend", "howdy", "friend")).toBe("instant");
  });

  it("request otherwise", () => {
    expect(resolveItemAccess("friend", "howdy", "family")).toBe("request");
  });
});
