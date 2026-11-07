// GET /v1/g/:garage, GET /v1/g/:garage/members and DELETE waitlist entries.

import { waitlistKey } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  OWNER_PHONE,
  seedGarage,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

const OUTSIDER = "+15555550900";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(OWNER_PHONE, { display_name: "Owner" });
  seedUser(FAMILY_PHONE, { display_name: "Fam" });
  seedUser(FRIEND_PHONE, { display_name: "Fri" });
  seedUser(HOWDY_PHONE, { display_name: "How" });
  seedMembership(OWNER_PHONE, "family");
  seedMembership(FAMILY_PHONE, "family", { borrows_total: 4, borrows_active: 1 });
  seedMembership(FRIEND_PHONE, "friend");
  seedMembership(HOWDY_PHONE, "howdy");
});

function get(path: string, phone: string): Promise<Response> {
  return Promise.resolve(createApp().request(path, { headers: authHeader(phone) }));
}

describe("GET /v1/g/:garage", () => {
  it("returns the garage and the caller's own counters, never their tier", async () => {
    const res = await get(`/v1/g/${GARAGE_ID}`, FAMILY_PHONE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      garage: Record<string, unknown>;
      member: Record<string, unknown>;
    };
    expect(body.garage).toMatchObject({ id: GARAGE_ID, name: "Test Garage", status: "open" });
    expect(body.member).toEqual({
      joined_at: "2026-04-01T12:00:00Z",
      borrows_total: 4,
      borrows_active: 1,
    });
    const raw = JSON.stringify(body);
    expect(body.member).not.toHaveProperty("tier");
    expect(raw).not.toContain(OWNER_PHONE);
    expect(body.garage).not.toHaveProperty("owner_phone");
    expect(body.garage).not.toHaveProperty("ai_total_monthly_cap_cents");
  });

  it("is 401 without a token and 403 for a non-member", async () => {
    expect((await createApp().request(`/v1/g/${GARAGE_ID}`)).status).toBe(401);
    expect((await get(`/v1/g/${GARAGE_ID}`, OUTSIDER)).status).toBe(403);
  });
});

describe("GET /v1/g/:garage/members", () => {
  it("lists visible members by last 4 digits only, sorted and without the hidden or leaving", async () => {
    seedUser(FRIEND_PHONE, { display_name: "Fri", visibility: "hidden" });
    seedUser(HOWDY_PHONE, { display_name: "How", deleted_at: "2026-04-05T00:00:00Z" });
    const res = await get(`/v1/g/${GARAGE_ID}/members`, FAMILY_PHONE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: Array<Record<string, string>>;
      next_cursor?: string;
    };
    expect(body.members).toEqual([
      {
        phone_last4: OWNER_PHONE.slice(-4),
        display_name: "Owner",
        joined_at: "2026-04-01T12:00:00Z",
      },
      {
        phone_last4: FAMILY_PHONE.slice(-4),
        display_name: "Fam",
        joined_at: "2026-04-01T12:00:00Z",
      },
    ]);
    expect(body.next_cursor).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\+1555/);
  });

  it("skips a membership whose profile row is missing", async () => {
    seedMembership("+15555550950", "howdy");
    const res = await get(`/v1/g/${GARAGE_ID}/members`, FAMILY_PHONE);
    const body = (await res.json()) as { members: unknown[] };
    expect(body.members).toHaveLength(4);
  });

  it("pages with a cursor", async () => {
    const first = await get(`/v1/g/${GARAGE_ID}/members?limit=3`, FAMILY_PHONE);
    const p1 = (await first.json()) as {
      members: Array<{ phone_last4: string }>;
      next_cursor?: string;
    };
    expect(p1.members).toHaveLength(3);
    expect(p1.next_cursor).toBeTruthy();
    const second = await get(
      `/v1/g/${GARAGE_ID}/members?limit=3&cursor=${encodeURIComponent(p1.next_cursor ?? "")}`,
      FAMILY_PHONE,
    );
    const p2 = (await second.json()) as {
      members: Array<{ phone_last4: string }>;
      next_cursor?: string;
    };
    expect(p2.members).toHaveLength(1);
    expect(p2.next_cursor).toBeUndefined();
    const all = [...p1.members, ...p2.members].map((m) => m.phone_last4);
    expect(new Set(all).size).toBe(4);
  });

  it("is 403 for a non-member", async () => {
    expect((await get(`/v1/g/${GARAGE_ID}/members`, OUTSIDER)).status).toBe(403);
  });
});

describe("DELETE /v1/g/:garage/waitlist/:id", () => {
  function seedWait(id: string, phone: string, joined_at: string, item_id = "item-1"): void {
    const k = waitlistKey(GARAGE_ID, item_id, joined_at, phone);
    seedItem({
      PK: k.pk,
      SK: k.sk,
      id,
      garage_id: GARAGE_ID,
      item_id,
      borrower_phone: phone,
      joined_at,
      position: 1,
      notify_when_available: true,
    });
  }

  function del(id: string, phone: string): Promise<Response> {
    return Promise.resolve(
      createApp().request(`/v1/g/${GARAGE_ID}/waitlist/${id}`, {
        method: "DELETE",
        headers: authHeader(phone),
      }),
    );
  }

  const waitRows = (): Array<Record<string, unknown>> =>
    listAll().filter((r) => String(r.SK).startsWith("WAIT#"));

  it("removes the caller's own entry and leaves others in line", async () => {
    seedItemRecord();
    seedWait("w-1", FRIEND_PHONE, "2026-04-02T00:00:00Z");
    seedWait("w-2", HOWDY_PHONE, "2026-04-03T00:00:00Z");
    const res = await del("w-1", FRIEND_PHONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, item_id: "item-1" });
    expect(waitRows().map((r) => r.id)).toEqual(["w-2"]);
  });

  it("will not remove another member's entry (404, entry untouched)", async () => {
    seedWait("w-1", FRIEND_PHONE, "2026-04-02T00:00:00Z");
    const res = await del("w-1", HOWDY_PHONE);
    expect(res.status).toBe(404);
    expect(waitRows()).toHaveLength(1);
  });

  it("is 404 for an unknown id and 403 for a non-member", async () => {
    expect((await del("nope", FRIEND_PHONE)).status).toBe(404);
    seedWait("w-1", OUTSIDER, "2026-04-02T00:00:00Z");
    expect((await del("w-1", OUTSIDER)).status).toBe(403);
    expect(waitRows()).toHaveLength(1);
  });
});
