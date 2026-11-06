import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tenantMemberKey } from "@garageborrow/shared";

import { createApp } from "../index.js";
import { getLoan } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { clearNotifierSpy, spyNotifier } from "./_notifier-spy.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

function member(): Record<string, unknown> {
  const k = tenantMemberKey(GARAGE_ID, FAMILY_PHONE);
  return listAll().find((it) => it.PK === k.pk && it.SK === k.sk)!;
}

function ownerReturn(id: string) {
  return createApp().request(`/v1/g/${GARAGE_ID}/admin/loans/${id}/return`, {
    method: "POST",
    headers: authHeader(OWNER_PHONE),
  });
}

let sent: ReturnType<typeof spyNotifier>;

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  sent = spyNotifier();
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family", { borrows_active: 2 });
  seedItemRecord({ id: "drill" });
});

afterEach(() => clearNotifierSpy());

describe("POST /admin/loans/:id/return", () => {
  it("drops borrows_active and counts an on-time return", async () => {
    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      borrowed_at: "2026-01-01T12:00:00Z",
      expected_return_at: "2099-01-04T12:00:00Z",
      status: "active",
    });
    expect((await ownerReturn("loan-1")).status).toBe(200);
    expect(member()["borrows_active"]).toBe(1);
    expect(member()["returns_on_time"]).toBe(1);
    expect(member()["returns_late"]).toBe(0);
  });

  it("accepts an overdue loan and counts it late", async () => {
    seedLoanRecord({
      id: "loan-2",
      item_id: "drill",
      borrowed_at: "2026-01-01T12:00:00Z",
      expected_return_at: "2026-01-04T12:00:00Z",
      status: "overdue",
    });
    expect((await ownerReturn("loan-2")).status).toBe(200);
    expect((await getLoan(GARAGE_ID, "loan-2"))?.status).toBe("returned");
    expect(member()["borrows_active"]).toBe(1);
    expect(member()["returns_late"]).toBe(1);
  });

  it("does not count twice once the loan is returned", async () => {
    seedLoanRecord({
      id: "loan-3",
      item_id: "drill",
      borrowed_at: "2026-01-01T12:00:00Z",
      expected_return_at: "2099-01-04T12:00:00Z",
      status: "active",
    });
    expect((await ownerReturn("loan-3")).status).toBe(200);
    expect((await ownerReturn("loan-3")).status).toBe(409);
    expect(member()["borrows_active"]).toBe(1);
  });

  it("tells the item's waitlist that it is free", async () => {
    seedLoanRecord({
      id: "loan-4",
      item_id: "drill",
      borrowed_at: "2026-01-01T12:00:00Z",
      expected_return_at: "2099-01-04T12:00:00Z",
      status: "active",
    });
    expect((await ownerReturn("loan-4")).status).toBe(200);
    const wl = sent.find((e) => e.type === "waitlist_unblocked");
    expect(wl).toMatchObject({ garage_id: GARAGE_ID, payload: { item_id: "drill" } });
    expect(wl?.user_phone).toBeUndefined();
  });
});
