import { beforeEach, describe, expect, it } from "vitest";

import { autoConfirmReturns } from "../routes/loans.js";
import {
  GARAGE_ID,
  FAMILY_PHONE,
  seedGarage,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { installDdbMock, listAll, resetDdbStore } from "./_setup.js";
import { putLoan } from "../lib/repo.js";
import { LIABILITY_COPY_VERSION } from "../lib/liability.js";
import type { Loan } from "@garageborrow/shared";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
});

describe("autoConfirmReturns", () => {
  it("flips loans whose return_claimed_at is older than 48h to returned", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "drill" });

    const oldClaim = new Date(Date.now() - 49 * 3600_000).toISOString();
    const recentClaim = new Date(Date.now() - 5 * 3600_000).toISOString();

    const oldLoan: Loan & { return_claimed_at: string } = {
      id: "loan-old",
      garage_id: GARAGE_ID,
      item_id: "drill",
      borrower_phone: FAMILY_PHONE,
      borrowed_at: "2026-04-20T12:00:00Z",
      expected_return_at: "2026-04-23T12:00:00Z",
      status: "active",
      extension_count: 0,
      liability_acknowledged_at: "2026-04-20T12:00:00Z",
      liability_copy_version: LIABILITY_COPY_VERSION,
      return_claimed_at: oldClaim,
    };
    const recentLoan: Loan & { return_claimed_at: string } = {
      ...oldLoan,
      id: "loan-recent",
      return_claimed_at: recentClaim,
    };
    await putLoan(oldLoan);
    await putLoan(recentLoan);

    const swept = await autoConfirmReturns(GARAGE_ID);
    expect(swept).toBe(1);

    const items = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("LOAN#"),
    );
    const byId = new Map(items.map((it) => [(it as unknown as Loan).id, it as unknown as Loan]));
    expect(byId.get("loan-old")?.status).toBe("returned");
    expect(byId.get("loan-recent")?.status).toBe("active");
  });
});
