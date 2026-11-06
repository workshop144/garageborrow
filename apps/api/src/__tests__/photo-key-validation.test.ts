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
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
});

function post(path: string, phone: string, body: unknown) {
  return createApp().request(`/v1/g/${GARAGE_ID}${path}`, {
    method: "POST",
    headers: { ...authHeader(phone), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const offer = (photo_keys: string[]) => ({
  item_name: "Saw",
  description: "Works.",
  condition: "good",
  photo_keys,
});

describe("photo keys must be uploaded keys", () => {
  it.each([
    "https://x.cloudfront.net/t.gif",
    "//evil.example/t.gif",
    "uploads/../../etc/passwd",
    "javascript:alert(1)",
  ])("rejects a donation photo key %s", async (key) => {
    expect((await post("/donations", FAMILY_PHONE, offer([key]))).status).toBe(400);
  });

  it("accepts keys from /uploads/sign, new and legacy shapes", async () => {
    const res = await post(
      "/donations",
      FAMILY_PHONE,
      offer(["uploads/donation/01HX.jpg", "uploads/donation/15555550100/01HX.png"]),
    );
    expect(res.status).toBe(201);
  });

  it("rejects a URL as the accepted item's photo override and on incidents", async () => {
    const created = await post("/donations", FAMILY_PHONE, offer([]));
    const { donation } = (await created.json()) as { donation: { id: string } };
    const decide = await post(`/admin/donations/${donation.id}/decide`, OWNER_PHONE, {
      decision: "accept",
      item_overrides: { primary_photo_key: "https://x.cloudfront.net/t.gif" },
    });
    expect(decide.status).toBe(400);

    const incident = await post("/incidents", OWNER_PHONE, {
      item_id: "i",
      loan_id: "l",
      type: "damage",
      description: "dent",
      photo_keys: ["https://x.cloudfront.net/t.gif"],
    });
    expect(incident.status).toBe(400);
  });

  it("rejects a URL as an owner-created item's photo key", async () => {
    const item = {
      name: "Drill",
      description: "Cordless",
      category: "power",
      primary_photo_key: "https://x.cloudfront.net/t.gif",
    };
    expect((await post("/items", OWNER_PHONE, item)).status).toBe(400);
    const ok = await post("/items", OWNER_PHONE, {
      ...item,
      primary_photo_key: "uploads/tool_photo/01HX.jpg",
    });
    expect(ok.status).toBe(201);
  });
});
