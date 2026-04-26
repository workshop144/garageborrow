import { beforeEach, describe, expect, it } from "vitest";

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

describe("GET /v1/g/:garage/items — tier filtering", () => {
  it("hides items above the user's tier and tags accessible ones with access level", async () => {
    seedGarage();
    seedUser(HOWDY_PHONE);
    seedMembership(HOWDY_PHONE, "howdy");

    seedItemRecord({ id: "open-item", min_tier: "howdy", auto_approve_tier: "family" });
    seedItemRecord({
      id: "request-item",
      min_tier: "howdy",
      auto_approve_tier: "family",
    });
    seedItemRecord({
      id: "hidden-item",
      min_tier: "family",
      auto_approve_tier: "family",
    });

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items`, {
      headers: authHeader(HOWDY_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; access: string }> };
    const ids = body.items.map((i) => i.id).sort();
    expect(ids).toEqual(["open-item", "request-item"]);
    for (const it of body.items) {
      // Howdy user, auto_approve=family → request access for anything they can see.
      expect(it.access).toBe("request");
    }
  });

  it("instant access for family tier on a howdy-min item", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "x", min_tier: "howdy", auto_approve_tier: "family" });

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items`, {
      headers: authHeader(FAMILY_PHONE),
    });
    const body = (await res.json()) as { items: Array<{ id: string; access: string }> };
    expect(body.items[0]?.access).toBe("instant");
  });
});
