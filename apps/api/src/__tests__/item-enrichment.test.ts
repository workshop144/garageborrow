import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  seedGarage,
  seedInstanceRecord,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

interface EnrichedItem {
  id: string;
  name: string;
  created_at: string;
  access: string;
  available_count: number;
  total_count: number;
  borrows_total: number;
  borrows_last_30d: number;
}

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
});

async function fetchItems(query = ""): Promise<EnrichedItem[]> {
  const app = createApp();
  const url = `/v1/g/${GARAGE_ID}/items${query}`;
  const res = await app.request(url, { headers: authHeader(FAMILY_PHONE) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: EnrichedItem[] };
  return body.items;
}

async function fetchDetail(id: string): Promise<EnrichedItem> {
  const app = createApp();
  const res = await app.request(`/v1/g/${GARAGE_ID}/items/${id}`, {
    headers: authHeader(FAMILY_PHONE),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { item: EnrichedItem };
  return body.item;
}

describe("item enrichment — counts", () => {
  it("single-unit item with no instances and no loans: available_count=1, total_count=1", async () => {
    seedItemRecord({ id: "single-free", name: "Single Free" });

    const items = await fetchItems();
    const it = items.find((i) => i.id === "single-free");
    expect(it).toBeDefined();
    expect(it?.total_count).toBe(1);
    expect(it?.available_count).toBe(1);
    expect(it?.borrows_total).toBe(0);
    expect(it?.borrows_last_30d).toBe(0);
  });

  it("single-unit item with an active loan: available_count flips to 0", async () => {
    seedItemRecord({ id: "single-loaned", name: "Single Loaned" });
    seedLoanRecord({
      item_id: "single-loaned",
      id: "loan-active",
      status: "active",
      borrowed_at: "2026-04-20T12:00:00Z",
    });

    const items = await fetchItems();
    const it = items.find((i) => i.id === "single-loaned");
    expect(it?.total_count).toBe(1);
    expect(it?.available_count).toBe(0);
  });

  it("single-unit item whose only loan is returned: available_count back to 1", async () => {
    seedItemRecord({ id: "single-back", name: "Single Back" });
    seedLoanRecord({
      item_id: "single-back",
      id: "loan-returned",
      status: "returned",
      borrowed_at: "2026-04-10T12:00:00Z",
    });

    const items = await fetchItems();
    const it = items.find((i) => i.id === "single-back");
    expect(it?.total_count).toBe(1);
    expect(it?.available_count).toBe(1);
  });

  it("multi-instance item counts available vs total (excluding retired)", async () => {
    seedItemRecord({ id: "multi", name: "Multi" });
    seedInstanceRecord("multi", { id: "i-a", status: "available" });
    seedInstanceRecord("multi", { id: "i-b", status: "available" });
    seedInstanceRecord("multi", { id: "i-c", status: "loaned" });
    seedInstanceRecord("multi", { id: "i-d", status: "broken" });
    seedInstanceRecord("multi", { id: "i-e", status: "retired" });

    const items = await fetchItems();
    const it = items.find((i) => i.id === "multi");
    // 5 instances total, 1 retired → total_count = 4
    expect(it?.total_count).toBe(4);
    // 2 available
    expect(it?.available_count).toBe(2);
  });

  it("borrows_total counts every loan; borrows_last_30d counts only recent ones", async () => {
    seedItemRecord({ id: "popular", name: "Popular" });
    // Today is 2026-04-26; cutoff is roughly 2026-03-27.
    seedLoanRecord({
      item_id: "popular",
      id: "old-1",
      status: "returned",
      borrowed_at: "2025-12-01T12:00:00Z",
    });
    seedLoanRecord({
      item_id: "popular",
      id: "old-2",
      status: "returned",
      borrowed_at: "2026-01-15T12:00:00Z",
    });
    seedLoanRecord({
      item_id: "popular",
      id: "recent-1",
      status: "returned",
      borrowed_at: "2026-04-10T12:00:00Z",
    });
    seedLoanRecord({
      item_id: "popular",
      id: "recent-2",
      status: "active",
      borrowed_at: "2026-04-20T12:00:00Z",
    });

    const items = await fetchItems();
    const it = items.find((i) => i.id === "popular");
    expect(it?.borrows_total).toBe(4);
    expect(it?.borrows_last_30d).toBe(2);
  });

  it("loans for other items don't leak into this item's counts", async () => {
    seedItemRecord({ id: "a", name: "A" });
    seedItemRecord({ id: "b", name: "B" });
    seedLoanRecord({
      item_id: "b",
      id: "loan-b",
      status: "active",
      borrowed_at: "2026-04-20T12:00:00Z",
    });

    const items = await fetchItems();
    const a = items.find((i) => i.id === "a");
    const b = items.find((i) => i.id === "b");
    expect(a?.borrows_total).toBe(0);
    expect(a?.available_count).toBe(1);
    expect(b?.borrows_total).toBe(1);
    expect(b?.available_count).toBe(0);
  });

  it("detail endpoint returns the same enrichment fields", async () => {
    seedItemRecord({ id: "detail", name: "Detail" });
    seedInstanceRecord("detail", { id: "d1", status: "available" });
    seedInstanceRecord("detail", { id: "d2", status: "loaned" });
    seedInstanceRecord("detail", { id: "d3", status: "retired" });
    seedLoanRecord({
      item_id: "detail",
      id: "d-loan",
      status: "active",
      borrowed_at: "2026-04-15T12:00:00Z",
    });

    const it = await fetchDetail("detail");
    expect(it.total_count).toBe(2);
    expect(it.available_count).toBe(1);
    expect(it.borrows_total).toBe(1);
    expect(it.borrows_last_30d).toBe(1);
  });
});

describe("GET /v1/g/:garage/items — sort", () => {
  it("sort=recent returns items by created_at desc", async () => {
    seedItemRecord({ id: "old", name: "Old", created_at: "2025-01-01T00:00:00Z" });
    seedItemRecord({ id: "mid", name: "Mid", created_at: "2025-06-01T00:00:00Z" });
    seedItemRecord({ id: "new", name: "New", created_at: "2026-04-01T00:00:00Z" });

    const items = await fetchItems("?sort=recent");
    expect(items.map((i) => i.id)).toEqual(["new", "mid", "old"]);
  });

  it("sort=popular returns items by borrows_total desc", async () => {
    seedItemRecord({ id: "quiet", name: "Quiet" });
    seedItemRecord({ id: "loud", name: "Loud" });
    seedItemRecord({ id: "medium", name: "Medium" });

    seedLoanRecord({
      item_id: "loud",
      id: "l1",
      status: "returned",
      borrowed_at: "2026-04-01T00:00:00Z",
    });
    seedLoanRecord({
      item_id: "loud",
      id: "l2",
      status: "returned",
      borrowed_at: "2026-04-02T00:00:00Z",
    });
    seedLoanRecord({
      item_id: "loud",
      id: "l3",
      status: "returned",
      borrowed_at: "2026-04-03T00:00:00Z",
    });
    seedLoanRecord({
      item_id: "medium",
      id: "m1",
      status: "returned",
      borrowed_at: "2026-04-01T00:00:00Z",
    });

    const items = await fetchItems("?sort=popular");
    expect(items.map((i) => i.id)).toEqual(["loud", "medium", "quiet"]);
  });

  it("sort=alphabetical returns items by name asc", async () => {
    seedItemRecord({ id: "x", name: "Zebra" });
    seedItemRecord({ id: "y", name: "Apple" });
    seedItemRecord({ id: "z", name: "Mango" });

    const items = await fetchItems("?sort=alphabetical");
    expect(items.map((i) => i.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("rejects unknown sort values with 400", async () => {
    seedItemRecord({ id: "any", name: "Any" });

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/items?sort=bogus`, {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(400);
  });

  it("default sort behaves like recent", async () => {
    seedItemRecord({ id: "old", name: "Old", created_at: "2025-01-01T00:00:00Z" });
    seedItemRecord({ id: "new", name: "New", created_at: "2026-04-01T00:00:00Z" });

    const items = await fetchItems();
    expect(items.map((i) => i.id)).toEqual(["new", "old"]);
  });
});
