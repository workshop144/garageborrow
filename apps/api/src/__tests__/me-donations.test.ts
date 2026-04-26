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

async function submit(app: ReturnType<typeof createApp>, name: string): Promise<void> {
  const res = await app.request(`/v1/g/${GARAGE_ID}/donations`, {
    method: "POST",
    headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
    body: JSON.stringify({
      item_name: name,
      description: "x",
      condition: "good",
      photo_keys: [],
    }),
  });
  expect(res.status).toBe(201);
}

describe("GET /v1/me/donations", () => {
  it("returns donations the caller has offered, sorted desc", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedUser(OWNER_PHONE, { display_name: "Owner" });
    seedMembership(FAMILY_PHONE, "family");

    const app = createApp();
    await submit(app, "Saw");
    await submit(app, "Drill");

    const res = await app.request("/v1/me/donations", {
      method: "GET",
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      donations: Array<{ item_name: string; donor_phone: string }>;
    };
    expect(body.donations).toHaveLength(2);
    expect(body.donations[0]?.donor_phone).toBe(FAMILY_PHONE);
  });

  it("does not include other users' donations", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedUser(OWNER_PHONE, { display_name: "Owner" });
    seedMembership(FAMILY_PHONE, "family");

    const app = createApp();
    await submit(app, "Mine");

    const res = await app.request("/v1/me/donations", {
      method: "GET",
      headers: authHeader(OWNER_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { donations: unknown[] };
    expect(body.donations).toHaveLength(0);
  });
});
