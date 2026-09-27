import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { FAMILY_PHONE, GARAGE_ID, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

describe("GET /v1/me/data-export", () => {
  it("returns the caller's own data as a download, not an email", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");

    const res = await createApp().request("/v1/me/data-export?email=someone@example.org", {
      method: "GET",
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { user: { phone: string }; garages: string[] };
    expect(body.user.phone).toBe(FAMILY_PHONE);
    expect(body.garages).toContain(GARAGE_ID);
  });

  it("requires a signed-in caller", async () => {
    const res = await createApp().request("/v1/me/data-export", { method: "GET" });
    expect(res.status).toBe(401);
  });
});
