import { beforeEach, describe, expect, it, vi } from "vitest";
import { reservationKey } from "@garageborrow/shared";

import { runCronSweep } from "../notifier.js";
import { setSmsDriver } from "../lib/channels.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  seedGarage,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { installDdbMock, resetDdbStore, seedItem } from "./_setup.js";

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
