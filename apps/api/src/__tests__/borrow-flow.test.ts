import { beforeEach, describe, expect, it } from "vitest";

import { LIABILITY_COPY_VERSION } from "../lib/liability.js";
import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  seedGarage,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

describe("POST /v1/g/:garage/loans — borrow flow", () => {
  it("creates a loan when access resolves to instant; stamps liability version", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "drill", min_tier: "howdy", auto_approve_tier: "family" });

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/loans`, {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ item_id: "drill", liability_acknowledged: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      loan: { status: string; liability_copy_version: string; borrower_phone: string };
    };
    expect(body.loan.status).toBe("active");
    expect(body.loan.liability_copy_version).toBe(LIABILITY_COPY_VERSION);
    expect(body.loan.borrower_phone).toBe(FAMILY_PHONE);
  });

  it("403s when access resolves to hidden", async () => {
    seedGarage();
    seedUser(HOWDY_PHONE);
    seedMembership(HOWDY_PHONE, "howdy");
    seedItemRecord({ id: "fancy", min_tier: "family", auto_approve_tier: "family" });

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/loans`, {
      method: "POST",
      headers: { ...authHeader(HOWDY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ item_id: "fancy", liability_acknowledged: true }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 202 + reservation when access is request (approval required)", async () => {
    seedGarage();
    seedUser(HOWDY_PHONE);
    seedMembership(HOWDY_PHONE, "howdy");
    seedItemRecord({ id: "saw", min_tier: "howdy", auto_approve_tier: "family" });

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/loans`, {
      method: "POST",
      headers: { ...authHeader(HOWDY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ item_id: "saw", liability_acknowledged: true }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      reservation: { status: string; approval_required: boolean };
    };
    expect(body.reservation.status).toBe("pending");
    expect(body.reservation.approval_required).toBe(true);
  });
});
