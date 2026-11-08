import { beforeEach, describe, expect, it, vi } from "vitest";
import { reservationKey } from "@garageborrow/shared";

import { runCronSweep } from "../notifier.js";
import { setSmsDriver } from "../lib/channels.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { installDdbMock, listAll, resetDdbStore, seedItem } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
});

describe("notifier cron sweep", () => {
  it("identifies loans due today", async () => {
    const today = "2026-04-26";
    seedLoanRecord({
      id: "loan-due",
      item_id: "item-1",
      borrowed_at: "2026-04-23T12:00:00Z",
      expected_return_at: `${today}T18:00:00Z`,
      status: "active",
    });
    const smsSpy = vi.fn(() => Promise.resolve());
    setSmsDriver(smsSpy);
    const counts = await runCronSweep({
      now: new Date(`${today}T13:00:00Z`),
      garage_ids: [GARAGE_ID],
    });
    expect(counts.due_today).toBe(1);
    expect(smsSpy).toHaveBeenCalledTimes(1);
    setSmsDriver(undefined);
  });

  it("identifies loans 2 days overdue", async () => {
    const now = new Date("2026-04-26T13:00:00Z");
    const twoDaysAgo = "2026-04-24";
    seedLoanRecord({
      id: "loan-overdue",
      item_id: "item-1",
      borrowed_at: "2026-04-20T12:00:00Z",
      expected_return_at: `${twoDaysAgo}T18:00:00Z`,
      status: "active",
    });
    const smsSpy = vi.fn(() => Promise.resolve());
    setSmsDriver(smsSpy);
    const counts = await runCronSweep({ now, garage_ids: [GARAGE_ID] });
    expect(counts.overdue_2d).toBe(1);
    setSmsDriver(undefined);
  });

  it("ignores returned and not-yet-due loans", async () => {
    const today = "2026-04-26";
    seedLoanRecord({
      id: "loan-returned",
      item_id: "item-1",
      borrowed_at: "2026-04-20T12:00:00Z",
      expected_return_at: `${today}T18:00:00Z`,
      status: "returned",
    });
    seedLoanRecord({
      id: "loan-future",
      item_id: "item-1",
      borrowed_at: "2026-04-25T12:00:00Z",
      expected_return_at: "2026-04-30T12:00:00Z",
      status: "active",
    });
    const smsSpy = vi.fn(() => Promise.resolve());
    setSmsDriver(smsSpy);
    const counts = await runCronSweep({
      now: new Date(`${today}T13:00:00Z`),
      garage_ids: [GARAGE_ID],
    });
    expect(counts.due_today).toBe(0);
    expect(counts.overdue_2d).toBe(0);
    expect(smsSpy).not.toHaveBeenCalled();
    setSmsDriver(undefined);
  });

  it("notifies for reservations starting tomorrow", async () => {
    const tomorrow = "2026-04-27";
    const reservation = {
      id: "res-tomorrow",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      start_at: `${tomorrow}T12:00:00Z`,
      end_at: `${tomorrow}T18:00:00Z`,
      status: "approved" as const,
      approval_required: false,
    };
    const k = reservationKey(GARAGE_ID, tomorrow, reservation.id);
    seedItem({ ...reservation, PK: k.pk, SK: k.sk });
    const smsSpy = vi.fn(() => Promise.resolve());
    setSmsDriver(smsSpy);
    const counts = await runCronSweep({
      now: new Date("2026-04-26T13:00:00Z"),
      garage_ids: [GARAGE_ID],
    });
    expect(counts.reservations_tomorrow).toBe(1);
    setSmsDriver(undefined);
  });
});

describe("wishlist digest (GB-F5-3)", () => {
  it("texts the owner static copy and never the member-written item names", async () => {
    seedUser(OWNER_PHONE);
    const now = new Date("2026-04-26T13:00:00Z");
    const lure = "Free drill! Verify your account at https://evil.example/x";
    for (let i = 0; i < 7; i++) {
      seedItem({
        PK: `TENANT#${GARAGE_ID}`,
        SK: `WISH#wish-${i}`,
        id: `wish-${i}`,
        garage_id: GARAGE_ID,
        item_name: i === 0 ? lure : `Request ${i}`,
        status: "open",
        created_at: "2026-04-26T08:00:00Z",
      });
    }
    const sent: Array<{ phone: string; body: string }> = [];
    setSmsDriver((phone, body) => {
      sent.push({ phone, body });
      return Promise.resolve();
    });
    try {
      const counts = await runCronSweep({ now, garage_ids: [GARAGE_ID] });
      expect(counts.wishlist_digests).toBe(1);
    } finally {
      setSmsDriver(undefined);
    }
    const toOwner = sent.filter((m) => m.phone === OWNER_PHONE);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]?.body).toBe(
      "7 new wishlist requests\nOpen the app to see what folks are wishing for.",
    );
    expect(toOwner[0]?.body).not.toContain("evil.example");
    expect(toOwner[0]?.body).not.toContain("Request 1");

    // The in-app record carries ids and a count only, no request text either.
    const notes = listAll().filter((it) => String(it.SK).startsWith("NOTIFICATION#"));
    const digest = notes.find((n) => n["type"] === "wishlist_digest");
    expect(digest?.["payload"]).toEqual({
      count: 7,
      request_ids: expect.arrayContaining(["wish-0", "wish-6"]) as unknown,
    });
    expect(JSON.stringify(digest)).not.toContain("evil.example");
  });
});
