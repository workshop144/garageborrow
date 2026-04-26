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
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
});

interface ListResp {
  items: Array<{ id: string; name: string; borrows_total: number; borrows_last_30d: number }>;
  next_cursor?: string;
}

describe("GET /v1/g/:garage/items search/filter/sort", () => {
  it("?q matches across name, description, tags case-insensitively", async () => {
    seedItemRecord({
      id: "drill",
      name: "Cordless Drill",
      description: "18V drill",
      tags: ["power"],
    });
    seedItemRecord({
      id: "saw",
      name: "Circular Saw",
      description: "Cuts plywood",
      tags: ["cutting"],
    });
    seedItemRecord({
      id: "hammer",
      name: "Claw Hammer",
      description: "Old reliable",
      tags: ["hand", "POWER"],
    });
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items?q=power`, {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const body = (await res.json()) as ListResp;
    const ids = body.items.map((i) => i.id).sort();
    expect(ids).toEqual(["drill", "hammer"]);
  });

  it("?category filters by exact slug", async () => {
    seedItemRecord({ id: "a", name: "A", category: "power-tools" });
    seedItemRecord({ id: "b", name: "B", category: "garden" });
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items?category=garden`, {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const body = (await res.json()) as ListResp;
    expect(body.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("?available_now filters out broken/maintenance/all_loaned/retired", async () => {
    seedItemRecord({ id: "a", name: "A", status: "available" });
    seedItemRecord({ id: "b", name: "B", status: "partial_loaned" });
    seedItemRecord({ id: "c", name: "C", status: "broken" });
    seedItemRecord({ id: "d", name: "D", status: "all_loaned" });
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items?available_now=true`, {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const body = (await res.json()) as ListResp;
    expect(body.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("combines search with sort=alphabetical (case-insensitive)", async () => {
    seedItemRecord({ id: "z", name: "zoom Cutter" });
    seedItemRecord({ id: "a", name: "Apple Cutter" });
    seedItemRecord({ id: "m", name: "Melon Cutter" });
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items?q=cutter&sort=alphabetical`, {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const body = (await res.json()) as ListResp;
    expect(body.items.map((i) => i.id)).toEqual(["a", "m", "z"]);
  });

  it("rejects invalid sort with 400", async () => {
    seedItemRecord({ id: "x", name: "X" });
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items?sort=invalid`, {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    expect(res.status).toBe(400);
  });
});
