import { describe, expect, it } from "vitest";

import {
  APP_TIMEZONE,
  formatDateInput,
  formatInAppZone,
  formatRelative,
  formatTime,
  fromAppZone,
  toAppZone,
} from "../dates";

describe("APP_TIMEZONE", () => {
  it("is the default IANA zone", () => {
    expect(APP_TIMEZONE).toBe("America/New_York");
  });
});

describe("formatDateInput", () => {
  it("renders a US-style 'MMM d, yyyy' in app zone", () => {
    expect(formatDateInput("2026-04-26T12:00:00Z")).toMatch(/Apr 26, 2026/);
  });
});

describe("formatTime", () => {
  it("renders a wall-clock time in New York", () => {
    // 13:30 UTC on 2026-04-26 → 09:30 EDT (New York observes DST in April).
    expect(formatTime("2026-04-26T13:30:00Z")).toBe("9:30 AM");
  });
});

describe("formatRelative", () => {
  it("returns 'tomorrow' for ~24h in the future", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    expect(formatRelative("2026-04-27T15:00:00Z", now)).toBe("tomorrow");
  });

  it("returns 'yesterday' for ~24h in the past", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    expect(formatRelative("2026-04-25T08:00:00Z", now)).toBe("yesterday");
  });

  it("returns absolute date once outside the week", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    expect(formatRelative("2026-01-10T12:00:00Z", now)).toMatch(/Jan 10, 2026/);
  });
});

describe("toAppZone / fromAppZone (round-trip across DST)", () => {
  it("a UTC instant survives toAppZone → fromAppZone", () => {
    // March 8 2026 at 13:00 UTC = 09:00 EDT (the morning after spring-forward).
    const utc = "2026-03-08T13:00:00Z";
    const local = toAppZone(utc);
    const round = fromAppZone(local);
    expect(new Date(round).getTime()).toBe(new Date(utc).getTime());
  });

  it("preserves wall-clock minute across November fall-back", () => {
    // November 1 2026 at 13:00 UTC = 08:00 EST (after fall-back).
    const utc = "2026-11-01T13:00:00Z";
    expect(formatTime(utc)).toBe("8:00 AM");
  });
});

describe("formatInAppZone (custom pattern)", () => {
  it("supports arbitrary date-fns format strings", () => {
    expect(formatInAppZone("2026-04-26T12:00:00Z", "yyyy-MM-dd")).toBe("2026-04-26");
  });
});
