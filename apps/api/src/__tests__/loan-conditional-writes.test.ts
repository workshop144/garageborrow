import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { getLoan, updateLoan } from "../lib/repo.js";
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
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
  seedItemRecord({ id: "drill" });
});

describe("loan writes are conditional on the snapshot read", () => {
  it("a stale extend cannot resurrect a loan the owner just returned", async () => {
    seedLoanRecord({
      id: "loan-1",
      item_id: "drill",
      borrowed_at: "2099-01-01T12:00:00Z",
      expected_return_at: "2099-01-04T12:00:00Z",
      status: "active",
    });
    // The extend handler read the loan while it was active...
    const stale = await getLoan(GARAGE_ID, "loan-1");
    expect(stale?.status).toBe("active");

    // ...then the owner marked it returned...
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/admin/loans/loan-1/return`, {
      method: "POST",
      headers: authHeader(OWNER_PHONE),
    });
    expect(res.status).toBe(200);

    // ...and the extend's write of its snapshot is refused.
    const ok = await updateLoan(
      { ...stale!, expected_return_at: "2099-01-07T12:00:00Z", extension_count: 1 },
      stale!,
    );
    expect(ok).toBe(false);
    const after = await getLoan(GARAGE_ID, "loan-1");
    expect(after?.status).toBe("returned");
    expect(after?.actual_return_at).toBeDefined();
  });

  it("two writers from the same snapshot: only the first lands", async () => {
    seedLoanRecord({ id: "loan-2", item_id: "drill", status: "active" });
    const snap = (await getLoan(GARAGE_ID, "loan-2"))!;
    expect(await updateLoan({ ...snap, extension_count: 1 }, snap)).toBe(true);
    expect(await updateLoan({ ...snap, extension_count: 9 }, snap)).toBe(false);
    const after = (await getLoan(GARAGE_ID, "loan-2"))!;
    expect(after.extension_count).toBe(1);
    // The next write from the fresh row succeeds.
    expect(await updateLoan({ ...after, extension_count: 2 }, after)).toBe(true);
  });
});
