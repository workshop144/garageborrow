// 2026-11-10 sweep of the 2026-11-07 review: F8 (bulk import coerced
// "false" to true and "0x10" to 16) and F12 (the owner's SMS number was a
// build variable in the public web bundle; the API now sends it only with a
// family-only item to a member who may borrow it).

import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { ownerContactHref } from "../routes/items.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
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
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
  seedUser(FRIEND_PHONE);
  seedMembership(FRIEND_PHONE, "friend");
});

async function bulk(rows: Record<string, unknown>[]) {
  const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/items/bulk`, {
    method: "POST",
    headers: {
      ...authHeader(OWNER_PHONE),
      "content-type": "application/json",
      "Idempotency-Key": `bulk-${Math.random()}`,
    },
    body: JSON.stringify({ rows }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    results: Array<{ status: "ok" | "error"; item?: Record<string, unknown> }>;
  };
}

describe("F8: bulk import accepts only exact booleans and whole-number days", () => {
  it.each([
    [false, false],
    [true, true],
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["true", true],
    ["1", true],
  ])("requires_approval %j is stored as %s", async (value, stored) => {
    const body = await bulk([{ name: "Drill", category: "tools", requires_approval: value }]);
    expect(body.results[0]?.status).toBe("ok");
    expect(body.results[0]?.item?.["requires_approval"]).toBe(stored);
  });

  it.each(["no", "yes", "", 1, 0, null])("requires_approval %j is refused", async (value) => {
    const body = await bulk([{ name: "Drill", category: "tools", requires_approval: value }]);
    expect(body.results[0]?.status).toBe("error");
  });

  it.each([
    [5, 5],
    ["5", 5],
    ["60", 60],
  ])("default_duration_days %j is stored as %s", async (value, stored) => {
    const body = await bulk([{ name: "Drill", category: "tools", default_duration_days: value }]);
    expect(body.results[0]?.status).toBe("ok");
    expect(body.results[0]?.item?.["default_duration_days"]).toBe(stored);
  });

  it.each(["0x10", "1e1", " 5", "5.5", "", "61", true, 2.5, 0, -1, null])(
    "default_duration_days %j is refused",
    async (value) => {
      const body = await bulk([{ name: "Drill", category: "tools", default_duration_days: value }]);
      expect(body.results[0]?.status).toBe("error");
    },
  );

  it("refuses a non-string quality_tier and never stores one", async () => {
    const bad = await bulk([{ name: "Drill", category: "tools", quality_tier: 3 }]);
    expect(bad.results[0]?.status).toBe("error");
    const ok = await bulk([{ name: "Drill", category: "tools", quality_tier: "A" }]);
    expect(ok.results[0]?.status).toBe("ok");
    const items = listAll().filter((r) => String(r["SK"]).startsWith("ITEM#"));
    expect(items.every((r) => !("quality_tier" in r))).toBe(true);
  });
});

describe("F12: the owner's number comes from the API, only with a family-only item", () => {
  it("a family member viewing a family-only item gets an sms: link to the garage owner", async () => {
    seedItemRecord({ id: "truck", min_tier: "family", auto_approve_tier: "family" });
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/items/truck`, {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner_contact_href: string | null };
    expect(body.owner_contact_href).toBe(`sms:${OWNER_PHONE}`);
  });

  it("any other item carries no number", async () => {
    seedItemRecord({ id: "drill", min_tier: "howdy" });
    for (const phone of [FAMILY_PHONE, FRIEND_PHONE]) {
      const res = await createApp().request(`/v1/g/${GARAGE_ID}/items/drill`, {
        headers: authHeader(phone),
      });
      const text = await res.text();
      expect(JSON.parse(text).owner_contact_href).toBeNull();
      expect(text).not.toContain(OWNER_PHONE);
    }
  });

  it("only for family-tier instant access and a well-formed number", () => {
    expect(ownerContactHref("+15555550000", "family", "instant")).toBe("sms:+15555550000");
    expect(ownerContactHref("+15555550000", "family", "request")).toBeNull();
    expect(ownerContactHref("+15555550000", "friend", "instant")).toBeNull();
    expect(ownerContactHref("555;body=x", "family", "instant")).toBeNull();
    expect(ownerContactHref(undefined, "family", "instant")).toBeNull();
  });
});
