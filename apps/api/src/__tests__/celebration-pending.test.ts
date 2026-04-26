import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

describe("celebration_pending lifecycle", () => {
  it("promoting to family sets celebration_pending; /me consumes it once", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "friend");

    const app = createApp();
    const promote = await app.request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "celeb-1",
      },
      body: JSON.stringify({ tier: "family" }),
    });
    expect(promote.status).toBe(200);
    const promoted = (await promote.json()) as {
      membership: { tier: string; celebration_pending: boolean };
    };
    expect(promoted.membership.tier).toBe("family");
    expect(promoted.membership.celebration_pending).toBe(true);

    const me1 = await app.request("/v1/me", { headers: authHeader(FAMILY_PHONE) });
    expect(me1.status).toBe(200);
    const meBody1 = (await me1.json()) as {
      celebration_pending: boolean;
      memberships: Array<{ celebration_pending: boolean; celebration_seen_at?: string }>;
    };
    expect(meBody1.celebration_pending).toBe(true);
    expect(meBody1.memberships[0]?.celebration_seen_at).toBeTruthy();

    const me2 = await app.request("/v1/me", { headers: authHeader(FAMILY_PHONE) });
    const meBody2 = (await me2.json()) as { celebration_pending: boolean };
    expect(meBody2.celebration_pending).toBe(false);
  });

  it("lateral or downward moves do not set celebration_pending", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");

    const app = createApp();
    const downgrade = await app.request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "celeb-2",
      },
      body: JSON.stringify({ tier: "friend" }),
    });
    expect(downgrade.status).toBe(200);
    const body = (await downgrade.json()) as {
      membership: { tier: string; celebration_pending: boolean };
    };
    expect(body.membership.tier).toBe("friend");
    expect(body.membership.celebration_pending).toBe(false);

    const me = await app.request("/v1/me", { headers: authHeader(FAMILY_PHONE) });
    const meBody = (await me.json()) as { celebration_pending: boolean };
    expect(meBody.celebration_pending).toBe(false);
  });

  it("/me top-level tier reflects ownership", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    seedMembership(OWNER_PHONE, "family");

    const app = createApp();
    const me = await app.request("/v1/me", { headers: authHeader(OWNER_PHONE) });
    const body = (await me.json()) as { tier: string; owned_garages: string[] };
    expect(body.tier).toBe("owner");
    expect(body.owned_garages).toContain(GARAGE_ID);
  });
});
