import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantMemberKey } from "@garageborrow/shared";

import { runCronSweep } from "../notifier.js";
import { setSmsDriver } from "../lib/channels.js";
import { getLoan } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  seedGarage,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { installDdbMock, listAll, resetDdbStore } from "./_setup.js";

const NOW = new Date("2026-04-26T13:00:00Z");
const h = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();

function member(): Record<string, unknown> {
  const k = tenantMemberKey(GARAGE_ID, FAMILY_PHONE);
  return listAll().find((it) => it.PK === k.pk && it.SK === k.sk)!;
}

const sms = vi.fn(() => Promise.resolve());

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family", { borrows_active: 3 });
  sms.mockClear();
  setSmsDriver(sms);
});

afterEach(() => setSmsDriver(undefined));

describe("cron sweep auto-confirms claimed returns", () => {
  it("flips a 49h-old claim to returned and updates the counters", async () => {
    seedLoanRecord({
      id: "loan-claimed",
      item_id: "item-1",
      borrowed_at: "2026-04-20T12:00:00Z",
      expected_return_at: "2026-04-28T12:00:00Z",
      status: "active",
      actual_return_at: h(49),
      ...({ return_claimed_at: h(49) } as object),
    });
    const counts = await runCronSweep({ now: NOW, garage_ids: [GARAGE_ID] });
    expect(counts.returns_confirmed).toBe(1);
    expect((await getLoan(GARAGE_ID, "loan-claimed"))?.status).toBe("returned");
    expect(member()["borrows_active"]).toBe(2);
    expect(member()["returns_on_time"]).toBe(1);
  });

  it("counts a claim made after the due date as late, and confirms overdue loans", async () => {
    seedLoanRecord({
      id: "loan-late",
      item_id: "item-1",
      borrowed_at: "2026-04-10T12:00:00Z",
      expected_return_at: "2026-04-20T12:00:00Z",
      status: "overdue",
      actual_return_at: h(60),
      ...({ return_claimed_at: h(60) } as object),
    });
    await runCronSweep({ now: NOW, garage_ids: [GARAGE_ID] });
    expect((await getLoan(GARAGE_ID, "loan-late"))?.status).toBe("returned");
    expect(member()["returns_late"]).toBe(1);
    expect(member()["returns_on_time"]).toBe(0);
  });

  it("leaves a disputed claim and a fresh claim alone", async () => {
    seedLoanRecord({
      id: "loan-disputed",
      item_id: "item-1",
      borrowed_at: "2026-04-20T12:00:00Z",
      expected_return_at: "2026-04-28T12:00:00Z",
      status: "active",
      actual_return_at: h(72),
      ...({ return_claimed_at: h(72), disputed_at: h(70) } as object),
    });
    seedLoanRecord({
      id: "loan-fresh",
      item_id: "item-1",
      borrowed_at: "2026-04-21T12:00:00Z",
      expected_return_at: "2026-04-28T12:00:00Z",
      status: "active",
      actual_return_at: h(5),
      ...({ return_claimed_at: h(5) } as object),
    });
    const counts = await runCronSweep({ now: NOW, garage_ids: [GARAGE_ID] });
    expect(counts.returns_confirmed).toBe(0);
    expect((await getLoan(GARAGE_ID, "loan-disputed"))?.status).toBe("active");
    expect((await getLoan(GARAGE_ID, "loan-fresh"))?.status).toBe("active");
  });

  it("sends no due-today reminder for a loan already claimed returned", async () => {
    seedLoanRecord({
      id: "loan-handed-back",
      item_id: "item-1",
      borrowed_at: "2026-04-23T12:00:00Z",
      expected_return_at: "2026-04-26T18:00:00Z",
      status: "active",
      actual_return_at: h(3),
      ...({ return_claimed_at: h(3) } as object),
    });
    const counts = await runCronSweep({ now: NOW, garage_ids: [GARAGE_ID] });
    expect(counts.due_today).toBe(0);
    expect(sms).not.toHaveBeenCalled();
  });
});
