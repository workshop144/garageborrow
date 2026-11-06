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

  it("runs the handler once when two requests with the same key arrive together", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "drill" });
    seedItemRecord({ id: "saw" });
    const app = createApp();
    const send = () =>
      app.request(`/v1/g/${GARAGE_ID}/loans`, {
        method: "POST",
        headers: {
          ...authHeader(FAMILY_PHONE),
          "content-type": "application/json",
          "Idempotency-Key": "race-1",
        },
        body: JSON.stringify({ item_id: "saw", liability_acknowledged: true }),
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loans = listAll().filter((it) => String(it["SK"]).startsWith("LOAN#"));
    expect(loans).toHaveLength(1);
    // Once the first finished, a retry replays it.
    const c = await send();
    expect(c.status).toBe(201);
  });

  it("does not replay a key's response on a different endpoint", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "drill" });
    const app = createApp();
    const headers = {
      ...authHeader(FAMILY_PHONE),
      "content-type": "application/json",
      "Idempotency-Key": "reused",
    };
    const loan = await app.request(`/v1/g/${GARAGE_ID}/loans`, {
      method: "POST",
      headers,
      body: JSON.stringify({ item_id: "drill", liability_acknowledged: true }),
    });
    expect(loan.status).toBe(201);
    const donation = await app.request(`/v1/g/${GARAGE_ID}/donations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ item_name: "Saw", description: "ok", condition: "good" }),
    });
    expect(donation.status).toBe(201);
    expect(Object.keys((await donation.json()) as object)).not.toContain("loan");
  });

  it("releases the key after a failed request so the retry runs", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    const app = createApp();
    const send = () =>
      app.request(`/v1/g/${GARAGE_ID}/loans`, {
        method: "POST",
        headers: {
          ...authHeader(FAMILY_PHONE),
          "content-type": "application/json",
          "Idempotency-Key": "retry-1",
        },
        body: JSON.stringify({ item_id: "drill", liability_acknowledged: true }),
      });
    expect((await send()).status).toBe(404);
    seedItemRecord({ id: "drill" });
    expect((await send()).status).toBe(201);
  });
});
