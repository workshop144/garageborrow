import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { getLoan } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  seedGarage,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
  seedUser(FRIEND_PHONE);
  seedMembership(FRIEND_PHONE, "family");
  seedItemRecord({ id: "drill" });
  seedLoanRecord({
    id: "loan-1",
    item_id: "drill",
    borrower_phone: FAMILY_PHONE,
    borrowed_at: "2026-01-01T12:00:00Z",
    expected_return_at: "2099-01-04T12:00:00Z",
    status: "active",
  });
});

function postReturn(phone: string) {
  return createApp().request(`/v1/g/${GARAGE_ID}/loans/loan-1/return`, {
    method: "POST",
    headers: { ...authHeader(phone), "content-type": "application/json" },
    body: "{}",
  });
}

function borrow(phone: string) {
  return createApp().request(`/v1/g/${GARAGE_ID}/loans`, {
    method: "POST",
    headers: { ...authHeader(phone), "content-type": "application/json" },
    body: JSON.stringify({ item_id: "drill", liability_acknowledged: true }),
  });
}

describe("POST /loans/:id/return", () => {
  it("refuses another member's loan, and the unit stays out", async () => {
    const res = await postReturn(FRIEND_PHONE);
    expect(res.status).toBe(403);
    const loan = await getLoan(GARAGE_ID, "loan-1");
    expect(loan?.actual_return_at).toBeUndefined();
    // The single drill is still out: the other member cannot borrow it.
    expect((await borrow(FRIEND_PHONE)).status).toBe(409);
  });

  it("lets the borrower claim once; a repeat does not move the claim", async () => {
    const first = await postReturn(FAMILY_PHONE);
    expect(first.status).toBe(200);
    const claimed = (await getLoan(GARAGE_ID, "loan-1")) as { return_claimed_at?: string };
    expect(claimed.return_claimed_at).toBeDefined();

    const again = await postReturn(FAMILY_PHONE);
    expect(again.status).toBe(409);
    const after = (await getLoan(GARAGE_ID, "loan-1")) as { return_claimed_at?: string };
    expect(after.return_claimed_at).toBe(claimed.return_claimed_at);
  });

  it("refuses a loan that is already returned", async () => {
    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      borrower_phone: FAMILY_PHONE,
      borrowed_at: "2026-01-01T12:00:00Z",
      status: "returned",
      actual_return_at: "2099-01-02T12:00:00Z",
    });
    const res = await postReturn(FAMILY_PHONE);
    expect(res.status).toBe(409);
    expect((await getLoan(GARAGE_ID, "loan-1"))?.actual_return_at).toBe("2099-01-02T12:00:00Z");
  });
});
