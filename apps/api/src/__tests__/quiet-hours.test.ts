import { describe, expect, it } from "vitest";

import { isInQuietHours, nextEndInstant } from "../lib/quiet-hours.js";

const TZ = "America/New_York";

// New York observes Eastern time with DST. The
// helper resolves wall-clock hours against the target timezone, so a fixed
// quiet window (21:00 → 08:00) shifts UTC equivalents twice a year. These
// tests pin specific UTC instants near the DST boundaries to make sure we
// never round into or out of quiet incorrectly during the transitions.

describe("isInQuietHours across DST boundaries", () => {
  const opts = { start: "21:00", end: "08:00", timezone: TZ } as const;

  it("treats 03:00 ET on a March DST-spring-forward date as inside quiet", () => {
    // Spring forward: 2026-03-08 02:00 ET → 03:00 ET. Skipping 02:00 ET
    // doesn't change whether 03:00 ET is inside the overnight window.
    const utc = new Date("2026-03-08T07:00:00Z"); // 03:00 EST → 02:00 EDT depending on tz; we pin a clear post-jump moment.
    expect(isInQuietHours(utc, opts)).toBe(true);
  });

  it("treats 09:00 ET on a March DST-spring-forward date as outside quiet", () => {
    const utc = new Date("2026-03-08T13:00:00Z"); // 09:00 ET (after DST started)
    expect(isInQuietHours(utc, opts)).toBe(false);
  });

  it("treats 03:00 ET on a November DST-fall-back date as inside quiet", () => {
    const utc = new Date("2026-11-01T08:00:00Z"); // 03:00 ET after the fall back
    expect(isInQuietHours(utc, opts)).toBe(true);
  });

  it("treats 12:00 ET on a November DST-fall-back date as outside quiet", () => {
    const utc = new Date("2026-11-01T17:00:00Z"); // 12:00 ET (post-fallback)
    expect(isInQuietHours(utc, opts)).toBe(false);
  });

  it("handles a same-day quiet window correctly", () => {
    const opts2 = { start: "13:00", end: "14:00", timezone: TZ } as const;
    const inside = new Date("2026-04-26T17:30:00Z"); // 13:30 ET
    const outside = new Date("2026-04-26T18:30:00Z"); // 14:30 ET
    expect(isInQuietHours(inside, opts2)).toBe(true);
    expect(isInQuietHours(outside, opts2)).toBe(false);
  });

  it("nextEndInstant rolls forward past today's end when now is already past it", () => {
    const opts3 = { start: "21:00", end: "08:00", timezone: TZ } as const;
    const now = new Date("2026-04-26T13:00:00Z"); // 09:00 ET — past today's 08:00 end
    const next = nextEndInstant(now, opts3);
    // Should be 08:00 ET *tomorrow* — i.e. > 18 hours from now, but < 26.
    const diffHours = (next.getTime() - now.getTime()) / 3600_000;
    expect(diffHours).toBeGreaterThan(18);
    expect(diffHours).toBeLessThan(26);
  });
});
