import { beforeEach, describe, expect, it } from "vitest";
import { reservationKey } from "@garageborrow/shared";

import { createApp } from "../index.js";
import { getLoan } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  seedGarage,
  seedInstanceRecord,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore, seedItem } from "./_setup.js";

const DUE = "2099-01-04T12:00:00Z";

function seedReservation(start: string, end: string, extra: Record<string, unknown> = {}): void {
  const k = reservationKey(GARAGE_ID, start.slice(0, 10), "res-1");
  seedItem({
    PK: k.pk,
    SK: k.sk,
    id: "res-1",
    garage_id: GARAGE_ID,
    item_id: "drill",
    borrower_phone: FRIEND_PHONE,
    start_at: start,
    end_at: end,
    status: "approved",
    approval_required: false,
    ...extra,
  });
}

function extend() {
  return createApp().request(`/v1/g/${GARAGE_ID}/loans/loan-1/extend`, {
    method: "POST",
    headers: authHeader(FAMILY_PHONE),
  });
}

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
  seedItemRecord({ id: "drill" });
});

describe("POST /loans/:id/extend", () => {
  it("refuses when another member's approved reservation starts in the extra days", async () => {
    seedLoanRecord({ id: "loan-1", item_id: "drill", expected_return_at: DUE, status: "active" });
    seedReservation("2099-01-05T12:00:00Z", "2099-01-08T12:00:00Z");
    const res = await extend();
    expect(res.status).toBe(409);
    expect((await getLoan(GARAGE_ID, "loan-1"))?.expected_return_at).toBe(DUE);
  });

  it("extends when the reservation is on another unit", async () => {
    seedInstanceRecord("drill", { id: "u1" });
    seedInstanceRecord("drill", { id: "u2" });
    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      instance_id: "u1",
      expected_return_at: DUE,
      status: "active",
    });
    seedReservation("2099-01-05T12:00:00Z", "2099-01-08T12:00:00Z", { instance_id: "u2" });
    const res = await extend();
    expect(res.status).toBe(200);
    expect((await getLoan(GARAGE_ID, "loan-1"))?.expected_return_at).toBe(
      "2099-01-07T12:00:00.000Z",
    );
  });

  it("extends a loan whose due date is already past (it does not block itself)", async () => {
    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      expected_return_at: "2026-01-04T12:00:00Z",
      status: "active",
    });
    expect((await extend()).status).toBe(200);
  });

  it("refuses a loan already claimed returned, and caps the extension count", async () => {
    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      expected_return_at: DUE,
      status: "active",
      ...({ return_claimed_at: "2098-12-30T12:00:00Z" } as object),
    });
    expect((await extend()).status).toBe(409);

    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      expected_return_at: DUE,
      status: "active",
      extension_count: 3,
    });
    expect((await extend()).status).toBe(409);
  });
});
