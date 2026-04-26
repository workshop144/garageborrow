import { beforeEach, describe, expect, it } from "vitest";

import { setAuthVerifier } from "../middleware/auth.js";
import { createApp } from "../index.js";
import { GARAGE_ID, OWNER_PHONE, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
});

describe("JWT auth middleware", () => {
  it("401s when Authorization header is missing", async () => {
    setAuthVerifier(undefined);
    const app = createApp();
    const res = await app.request("/v1/me");
    expect(res.status).toBe(401);
  });

  it("401s when token is invalid (expired stub)", async () => {
    installFakeAuth();
    const app = createApp();
    const res = await app.request("/v1/me", {
      headers: { Authorization: "Bearer expired" },
    });
    expect(res.status).toBe(401);
  });

  it("attaches user from valid token and returns 200 on /v1/me when user record exists", async () => {
    installFakeAuth();
    seedGarage();
    seedUser(OWNER_PHONE);
    seedMembership(OWNER_PHONE, "family");

    const app = createApp();
    const res = await app.request("/v1/me", { headers: authHeader(OWNER_PHONE) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { phone: string } };
    expect(body.user.phone).toBe(OWNER_PHONE);
  });

  it("403s on garage routes when caller is not a member of the requested garage", async () => {
    installFakeAuth();
    seedGarage();
    // Owner of GARAGE_ID is OWNER_PHONE; attacker is some other phone.
    const intruder = "+15555559999";
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}`, {
      headers: authHeader(intruder),
    });
    expect(res.status).toBe(403);
  });
});
