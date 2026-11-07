// 2026-11-07 review, write races: F3 (the account cleaner hard-deleted a phone
// queued by an earlier run although the member had cancelled), F4 (whole-row
// membership puts undid atomic counter bumps), F5 (wishlist cancel/decide were
// unconditional whole-row puts) and F14 (reservation timestamps kept the
// caller's UTC offset).

import { reservationKey, tenantMemberKey, tenantUserKey, wishlistKey } from "@garageborrow/shared";
import type { WishlistRequest } from "@garageborrow/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPendingScrub, runCleanup, setCognitoClient } from "../account-cleaner.js";
import { createApp } from "../index.js";
import { closeWishlistRequest } from "../lib/repo.js";
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
import { clearNotifierSpy, spyNotifier } from "./_notifier-spy.js";
import {
  authHeader,
  deleteItem,
  installDdbMock,
  installFakeAuth,
  listAll,
  onNextGet,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

let cognitoDeletes: string[] = [];

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  cognitoDeletes = [];
  setCognitoClient({
    send: (cmd: { input: { Username: string } }) => {
      cognitoDeletes.push(cmd.input.Username);
      return Promise.resolve({});
    },
  } as never);
  seedGarage();
  seedUser(OWNER_PHONE);
  seedMembership(OWNER_PHONE, "family");
});

afterEach(() => {
  clearNotifierSpy();
});

const row = (pk: string, sk: string) => listAll().find((r) => r.PK === pk && r.SK === sk);
const json = (phone: string, key?: string) => ({
  ...authHeader(phone),
  "content-type": "application/json",
  ...(key ? { "Idempotency-Key": key } : {}),
});

describe("F3: a cancelled deletion is never carried out by a queued scrub", () => {
  const userKey = tenantUserKey(GARAGE_ID, FAMILY_PHONE);

  // An earlier run queued the phone and then timed out (on another phone's
  // full-table Scan) before reaching it: only the queue row is left.
  function queueWithoutProcessing(): void {
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    seedItem({
      PK: "CLEANER#PENDING",
      SK: `PHONE#${FAMILY_PHONE}`,
      phone: FAMILY_PHONE,
      pseudonym: "deleted-user-000000000000",
      created_at: "2026-04-25T03:00:00Z",
    });
  }

  it("the cleaner re-checks the profiles and drops the queue entry", async () => {
    queueWithoutProcessing();
    // The member cancels the next day: deleted_at is gone from the profile
    // (written straight to the store, as an older API without the F3 queue
    // drop would have left it).
    const profile = row(userKey.pk, userKey.sk) as Record<string, unknown>;
    delete profile["deleted_at"];

    const out = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(out.hard_deleted_users).toBe(0);
    expect(row(userKey.pk, userKey.sk)).toBeDefined();
    const mk = tenantMemberKey(GARAGE_ID, FAMILY_PHONE);
    expect(row(mk.pk, mk.sk)).toBeDefined();
    expect(cognitoDeletes).toEqual([]);
    expect(await getPendingScrub(FAMILY_PHONE)).toBeUndefined();
    expect(JSON.stringify(listAll())).not.toContain("deleted-user-");
  });

  it("POST /v1/me/delete-request/cancel drops a queued scrub too", async () => {
    queueWithoutProcessing();
    expect(await getPendingScrub(FAMILY_PHONE)).toBeDefined();
    const res = await createApp().request("/v1/me/delete-request/cancel", {
      method: "POST",
      headers: json(FAMILY_PHONE, "cancel-f3"),
    });
    expect(res.status).toBe(200);
    expect(await getPendingScrub(FAMILY_PHONE)).toBeUndefined();
    await runCleanup(new Date("2026-04-27T03:00:00Z"));
    expect(row(userKey.pk, userKey.sk)).toBeDefined();
    expect(cognitoDeletes).toEqual([]);
  });

  it("still finishes a queued phone whose profile rows are already gone", async () => {
    seedItem({
      PK: "CLEANER#PENDING",
      SK: `PHONE#${FAMILY_PHONE}`,
      phone: FAMILY_PHONE,
      pseudonym: "deleted-user-111111111111",
      created_at: "2026-04-25T03:00:00Z",
    });
    seedItem({ PK: `TENANT#${GARAGE_ID}`, SK: "DON#x", id: "d", donor_phone: FAMILY_PHONE });
    const out = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(out.hard_deleted_users).toBe(1);
    expect(row(`TENANT#${GARAGE_ID}`, "DON#x")?.["donor_phone"]).toBe("deleted-user-111111111111");
    expect(cognitoDeletes).toEqual([FAMILY_PHONE]);
  });

  it("still deletes a queued phone whose deleted_at is past the cutoff", async () => {
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const out = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(out.hard_deleted_users).toBe(1);
    expect(row(userKey.pk, userKey.sk)).toBeUndefined();
  });
});

describe("F4: membership writes keep concurrent counter bumps", () => {
  const mk = tenantMemberKey(GARAGE_ID, FAMILY_PHONE);
  // What a borrow does to the counters while the route holds its snapshot.
  const bumpCounters = () => {
    const m = row(mk.pk, mk.sk) as Record<string, number>;
    m["borrows_total"] = (m["borrows_total"] ?? 0) + 1;
    m["borrows_active"] = (m["borrows_active"] ?? 0) + 1;
  };

  beforeEach(() => {
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "friend", { borrows_total: 4, borrows_active: 0 });
  });

  it("PATCH /admin/members/:phone writes only the changed fields", async () => {
    onNextGet(mk.sk, bumpCounters);
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: json(OWNER_PHONE, "f4-patch"),
      body: JSON.stringify({ tier: "family", notes: "reliable" }),
    });
    expect(res.status).toBe(200);
    const stored = row(mk.pk, mk.sk);
    expect(stored).toMatchObject({
      tier: "family",
      notes: "reliable",
      celebration_pending: true,
      borrows_total: 5,
      borrows_active: 1,
    });
    const body = (await res.json()) as { membership: Record<string, unknown> };
    expect(body.membership["borrows_total"]).toBe(5);
  });

  it("PATCH on a member removed meanwhile is a 404 and recreates nothing", async () => {
    // The member leaves between the route's read and its write.
    onNextGet(mk.sk, () => deleteItem(mk.pk, mk.sk));
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: json(OWNER_PHONE, "f4-gone"),
      body: JSON.stringify({ notes: "n" }),
    });
    expect(res.status).toBe(404);
    expect(row(mk.pk, mk.sk)).toBeUndefined();
  });

  it("GET /v1/me clears the celebration without touching the counters", async () => {
    const m = row(mk.pk, mk.sk) as Record<string, unknown>;
    m["celebration_pending"] = true;
    onNextGet(mk.sk, bumpCounters);
    const res = await createApp().request("/v1/me", { headers: authHeader(FAMILY_PHONE) });
    expect(res.status).toBe(200);
    expect(row(mk.pk, mk.sk)).toMatchObject({
      celebration_pending: false,
      borrows_total: 5,
      borrows_active: 1,
    });
    expect(row(mk.pk, mk.sk)?.["celebration_seen_at"]).toBeTypeOf("string");
  });
});

describe("F5: wishlist cancel and decide are conditional", () => {
  const created = "2026-11-01T10:00:00.000Z";
  function seedWish(id: string, over: Partial<WishlistRequest> = {}): WishlistRequest {
    const req: WishlistRequest = {
      id,
      garage_id: GARAGE_ID,
      requester_phone: FAMILY_PHONE,
      item_name: `Wish ${id}`,
      status: "open",
      vote_count: 1,
      created_at: created,
      updated_at: created,
      ...over,
    } as WishlistRequest;
    const k = wishlistKey(GARAGE_ID, created.slice(0, 10), id);
    seedItem({ ...req, PK: k.pk, SK: k.sk, GSI3PK: "g3", GSI3SK: "s3" });
    return req;
  }
  const stored = (id: string) => {
    const k = wishlistKey(GARAGE_ID, created.slice(0, 10), id);
    return row(k.pk, k.sk);
  };

  beforeEach(() => {
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedUser(FRIEND_PHONE);
    seedMembership(FRIEND_PHONE, "friend");
  });

  it("closing keeps a vote_count bumped after the request was read", async () => {
    const snapshot = seedWish("w1");
    (stored("w1") as Record<string, unknown>)["vote_count"] = 5;
    const closed = await closeWishlistRequest(snapshot, {
      status: "cancelled",
      decided_at: created,
      decided_by_phone: FAMILY_PHONE,
      updated_at: created,
    });
    expect(closed?.status).toBe("cancelled");
    expect(stored("w1")).toMatchObject({ status: "cancelled", vote_count: 5 });
    expect(stored("w1")?.["GSI3PK"]).toBeUndefined();
    expect(closed).not.toHaveProperty("PK");
  });

  it("a decision racing a cancel loses with 409 and notifies no one", async () => {
    seedWish("w2");
    seedItemRecord({ id: "bought" });
    const sent = spyNotifier();
    // The member cancels between the owner's read and the owner's write.
    onNextGet("ITEM#", () => {
      (stored("w2") as Record<string, unknown>)["status"] = "cancelled";
    });
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/wishlist/w2/decide`, {
      method: "POST",
      headers: json(OWNER_PHONE, "f5-race"),
      body: JSON.stringify({ decision: "acquired", acquired_item_id: "bought" }),
    });
    expect(res.status).toBe(409);
    expect(stored("w2")?.["status"]).toBe("cancelled");
    expect(sent).toHaveLength(0);
  });

  it("acquired_item_id must be an item of this garage", async () => {
    seedWish("w3");
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/wishlist/w3/decide`, {
      method: "POST",
      headers: json(OWNER_PHONE, "f5-item"),
      body: JSON.stringify({ decision: "acquired", acquired_item_id: "no-such-item" }),
    });
    expect(res.status).toBe(400);
    expect(stored("w3")?.["status"]).toBe("open");
  });

  it("a duplicate must point at a request that is still open", async () => {
    seedWish("w4");
    seedWish("w5", { status: "declined" } as Partial<WishlistRequest>);
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/wishlist/w4/decide`, {
      method: "POST",
      headers: json(OWNER_PHONE, "f5-dup"),
      body: JSON.stringify({ decision: "duplicate", duplicate_of_id: "w5" }),
    });
    expect(res.status).toBe(409);
    expect(stored("w4")?.["status"]).toBe("open");
  });

  it("cancelling twice: the second is a 409", async () => {
    seedWish("w6");
    const del = (key: string) =>
      createApp().request(`/v1/g/${GARAGE_ID}/wishlist/w6`, {
        method: "DELETE",
        headers: json(FAMILY_PHONE, key),
      });
    expect((await del("c1")).status).toBe(200);
    expect((await del("c2")).status).toBe(409);
  });
});

describe("F14: reservation timestamps are stored in UTC", () => {
  beforeEach(() => {
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedItemRecord({ id: "tent" });
  });

  it("normalises a caller offset to Z before keying and storing the row", async () => {
    // 2 days ahead at 01:00 in UTC+09:00 is the previous day 16:00 UTC.
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const start = `${day}T01:00:00+09:00`;
    const end = `${day}T23:00:00+09:00`;
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/reservations`, {
      method: "POST",
      headers: json(FAMILY_PHONE, "f14"),
      body: JSON.stringify({ item_id: "tent", start_at: start, end_at: end }),
    });
    expect(res.status).toBe(201);
    const { reservation } = (await res.json()) as {
      reservation: { id: string; start_at: string; end_at: string };
    };
    expect(reservation.start_at).toBe(new Date(start).toISOString());
    expect(reservation.end_at).toBe(new Date(end).toISOString());
    expect(reservation.start_at.endsWith("Z")).toBe(true);
    const utcDay = reservation.start_at.slice(0, 10);
    expect(utcDay).not.toBe(day);
    const k = reservationKey(GARAGE_ID, utcDay, reservation.id);
    expect(row(k.pk, k.sk)?.["start_at"]).toBe(reservation.start_at);
  });
});
