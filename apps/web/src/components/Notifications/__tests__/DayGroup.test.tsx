import { describe, expect, it } from "vitest";
import type { Notification } from "@garageborrow/shared";

import { bucketFor, groupByDay } from "../DayGroup";

function note(overrides: Partial<Notification>): Notification {
  return {
    id: "n",
    user_phone: "+15555550100",
    type: "loan_due",
    payload: {},
    channel: "inapp",
    sent_at: "2026-04-26T12:00:00Z",
    ...overrides,
  };
}

describe("bucketFor", () => {
  // New York is UTC-4 in late April (EDT). Pick a "now" that lands cleanly
  // in the local day.
  const now = new Date("2026-04-26T18:00:00Z"); // 2:00 PM EDT in New York

  it("buckets a notification sent earlier today as 'today'", () => {
    expect(bucketFor("2026-04-26T15:00:00Z", now)).toBe("today");
  });

  it("buckets a notification just past midnight ET as today even when UTC date differs", () => {
    // 2026-04-26 01:00 EDT → 05:00 UTC, which is the same New York day.
    expect(bucketFor("2026-04-26T05:00:00Z", now)).toBe("today");
  });

  it("buckets a notification sent yesterday as 'yesterday'", () => {
    expect(bucketFor("2026-04-25T16:00:00Z", now)).toBe("yesterday");
  });

  it("buckets a notification 4 days ago as 'thisWeek'", () => {
    expect(bucketFor("2026-04-22T16:00:00Z", now)).toBe("thisWeek");
  });

  it("buckets a notification 30 days ago as 'older'", () => {
    expect(bucketFor("2026-03-26T16:00:00Z", now)).toBe("older");
  });
});

describe("groupByDay", () => {
  const now = new Date("2026-04-26T18:00:00Z");

  it("orders buckets today → yesterday → thisWeek → older and skips empties", () => {
    const items = [
      note({ id: "today-1", sent_at: "2026-04-26T15:00:00Z" }),
      note({ id: "older-1", sent_at: "2026-03-01T12:00:00Z" }),
      note({ id: "yesterday-1", sent_at: "2026-04-25T15:00:00Z" }),
    ];
    const grouped = groupByDay(items, now);
    expect(grouped.map((g) => g.bucket)).toEqual(["today", "yesterday", "older"]);
    expect(grouped[0]?.items[0]?.id).toBe("today-1");
  });
});
