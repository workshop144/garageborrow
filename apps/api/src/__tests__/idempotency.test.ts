import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  seedGarage,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

describe("Idempotency-Key middleware", () => {
  it("replays the original response on duplicate POSTs", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "drill" });

    const app = createApp();
    const init = {
      method: "POST",
      headers: {
        ...authHeader(FAMILY_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "abc-123",
      },
      body: JSON.stringify({ item_id: "drill", liability_acknowledged: true }),
    } as const;

    const first = await app.request(`/v1/g/${GARAGE_ID}/loans`, init);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { loan: { id: string } };
    const loanId = firstBody.loan.id;

    const second = await app.request(`/v1/g/${GARAGE_ID}/loans`, init);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { loan: { id: string } };
    expect(secondBody.loan.id).toBe(loanId);

    // Only one Loan record should be persisted.
    const loanItems = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("LOAN#"),
    );
    expect(loanItems).toHaveLength(1);
  });
});
