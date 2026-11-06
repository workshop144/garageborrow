import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { getLoan } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
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
  seedUser(OWNER_PHONE);
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

function post(path: string, phone: string, body: unknown = {}) {
  return createApp().request(`/v1/g/${GARAGE_ID}${path}`, {
    method: "POST",
    headers: { ...authHeader(phone), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /loans/:id/dispute", () => {
  it("puts a disputed unit back out, so nobody else can borrow it", async () => {
    expect((await post("/loans/loan-1/return", FAMILY_PHONE)).status).toBe(200);
    const res = await post("/loans/loan-1/dispute", OWNER_PHONE, { reason: "Not back yet" });
    expect(res.status).toBe(200);

    const loan = (await getLoan(GARAGE_ID, "loan-1")) as Record<string, unknown>;
    expect(loan["actual_return_at"]).toBeUndefined();
    expect(loan["return_claimed_at"]).toBeUndefined();
    expect(loan["disputed_at"]).toBeDefined();

    const borrow = await post("/loans", FRIEND_PHONE, {
      item_id: "drill",
      liability_acknowledged: true,
    });
    expect(borrow.status).toBe(409);
  });

  it("refuses a dispute when there is no return claim", async () => {
    const res = await post("/loans/loan-1/dispute", OWNER_PHONE, { reason: "?" });
    expect(res.status).toBe(409);
  });
});
