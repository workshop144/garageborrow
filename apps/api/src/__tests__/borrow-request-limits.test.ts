// Borrow requests and reservations are bounded: a daily per-member cap, one
// pending request per item, a window no longer than a loan and no further
// ahead than 90 days, at most two open reservations per member per item. The
// owner can release an approved reservation, and request pings to the owner
// have their own notification bucket (garageborrow-S3-1, S3-2).

import { tenantUserKey } from "@garageborrow/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  MAX_BORROW_REQUESTS_PER_DAY,
  MAX_OPEN_RESERVATIONS_PER_ITEM,
} from "../lib/borrow-limits.js";
import { getReservation } from "../lib/repo.js";
import { BORROW_REQUEST_NOTIFICATION_CAP, reserveSlot } from "../lib/spam-cap.js";
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
import { clearNotifierSpy, spyNotifier } from "./_notifier-spy.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

const DAY = 86_400_000;
let sent: ReturnType<typeof spyNotifier>;

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

function call(method: string, path: string, phone: string, body?: unknown) {
  return createApp().request(`/v1/g/${GARAGE_ID}${path}`, {
    method,
    headers: { ...authHeader(phone), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const post = (path: string, phone: string, body: unknown = {}) => call("POST", path, phone, body);

function reserve(phone: string, item_id: string, start: number, end: number) {
  return post("/reservations", phone, { item_id, start_at: inDays(start), end_at: inDays(end) });
}

async function idOf(res: Response): Promise<string> {
  return ((await res.json()) as { reservation: { id: string } }).reservation.id;
}

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  sent = spyNotifier();
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(HOWDY_PHONE);
  seedMembership(HOWDY_PHONE, "howdy");
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
  // howdy must ask for the saw; family is auto-approved on it.
  seedItemRecord({ id: "saw", min_tier: "howdy", auto_approve_tier: "family" });
  seedItemRecord({ id: "drill", min_tier: "howdy", auto_approve_tier: "family" });
});

afterEach(() => clearNotifierSpy());

describe("daily borrow request cap", () => {
  it("the request over the daily cap is a 429, even when each one was cancelled", async () => {
    for (let i = 0; i < MAX_BORROW_REQUESTS_PER_DAY; i++) {
      const res = await reserve(HOWDY_PHONE, "saw", 1, 2);
      expect(res.status).toBe(201);
      // Cancelling frees the one-pending-per-item slot but not the daily count.
      const del = await call("DELETE", `/reservations/${await idOf(res)}`, HOWDY_PHONE);
      expect(del.status).toBe(200);
    }
    const over = await reserve(HOWDY_PHONE, "saw", 1, 2);
    expect(over.status).toBe(429);
    // Borrow requests share the same daily count.
    const borrow = await post("/loans", HOWDY_PHONE, {
      item_id: "drill",
      liability_acknowledged: true,
    });
    expect(borrow.status).toBe(429);
    const pings = sent.filter((e) => e.type === "borrow_request_pending");
    expect(pings).toHaveLength(MAX_BORROW_REQUESTS_PER_DAY);
  });

  it("refused requests do not count against the cap", async () => {
    // A reversed window and an item that is out are refused before counting.
    seedItemRecord({ id: "gone", min_tier: "howdy", status: "all_loaned" });
    for (let i = 0; i < MAX_BORROW_REQUESTS_PER_DAY + 5; i++) {
      expect((await reserve(HOWDY_PHONE, "saw", 2, 1)).status).toBe(400);
      expect((await reserve(HOWDY_PHONE, "gone", 1, 2)).status).toBe(409);
      const borrow = await post("/loans", HOWDY_PHONE, {
        item_id: "gone",
        liability_acknowledged: true,
      });
      expect(borrow.status).toBe(409);
    }
    expect((await reserve(HOWDY_PHONE, "saw", 1, 2)).status).toBe(201);
  });

  it("the cap is per garage", async () => {
    const { bumpBorrowRequestCount } = await import("../lib/borrow-limits.js");
    for (let i = 0; i < MAX_BORROW_REQUESTS_PER_DAY; i++) {
      await bumpBorrowRequestCount("other-garage", HOWDY_PHONE);
    }
    await expect(bumpBorrowRequestCount("other-garage", HOWDY_PHONE)).rejects.toThrow();
    expect((await reserve(HOWDY_PHONE, "saw", 1, 2)).status).toBe(201);
  });
});

describe("one pending request per item", () => {
  it("a duplicate pending borrow request is a 409 and does not ping the owner again", async () => {
    const body = { item_id: "saw", liability_acknowledged: true };
    expect((await post("/loans", HOWDY_PHONE, body)).status).toBe(202);
    const dup = await post("/loans", HOWDY_PHONE, body);
    expect(dup.status).toBe(409);
    // A pending reservation for the same item blocks too.
    expect((await reserve(HOWDY_PHONE, "saw", 3, 4)).status).toBe(409);
    expect(sent.filter((e) => e.type === "borrow_request_pending")).toHaveLength(1);
    // A different item is fine.
    expect((await post("/loans", HOWDY_PHONE, { ...body, item_id: "drill" })).status).toBe(202);
  });

  it("a pending request whose window has ended no longer blocks", async () => {
    const id = await idOf(await reserve(HOWDY_PHONE, "saw", 1, 2));
    // The owner never decided it and its window has passed.
    const row = listAll().find((r) => r["id"] === id);
    expect(row).toBeTruthy();
    seedItem({ ...row!, start_at: inDays(-3), end_at: inDays(-2) });
    expect((await reserve(HOWDY_PHONE, "saw", 1, 2)).status).toBe(201);
  });

  it("a duplicate pending reservation request is a 409", async () => {
    expect((await reserve(HOWDY_PHONE, "saw", 1, 2)).status).toBe(201);
    expect((await reserve(HOWDY_PHONE, "saw", 5, 6)).status).toBe(409);
  });
});

describe("reservation window bounds", () => {
  it("a window longer than 60 days is a 400", async () => {
    const res = await reserve(FAMILY_PHONE, "saw", 1, 62);
    expect(res.status).toBe(400);
  });

  it("a start a year out is a 400", async () => {
    const res = await reserve(FAMILY_PHONE, "saw", 365, 366);
    expect(res.status).toBe(400);
  });

  it("an end at year 9999 is a 400", async () => {
    const res = await post("/reservations", FAMILY_PHONE, {
      item_id: "saw",
      start_at: inDays(1),
      end_at: "9999-12-31T00:00:00Z",
    });
    expect(res.status).toBe(400);
  });

  it("60 days, starting within 90 days, is accepted", async () => {
    const res = await reserve(FAMILY_PHONE, "saw", 29, 89);
    expect(res.status).toBe(201);
  });
});

describe("open reservations per member per item", () => {
  it("refuses a third open reservation on the same item", async () => {
    for (let i = 0; i < MAX_OPEN_RESERVATIONS_PER_ITEM; i++) {
      expect((await reserve(FAMILY_PHONE, "saw", 1 + i * 3, 2 + i * 3)).status).toBe(201);
    }
    expect((await reserve(FAMILY_PHONE, "saw", 20, 21)).status).toBe(409);
    // Another item is not affected.
    expect((await reserve(FAMILY_PHONE, "drill", 20, 21)).status).toBe(201);
  });
});

describe("owner cancels an approved reservation", () => {
  it("frees the unit, tells the member, and is idempotent", async () => {
    const made = await reserve(FAMILY_PHONE, "saw", 1, 30);
    expect(made.status).toBe(201);
    const id = await idOf(made);
    expect((await getReservation(GARAGE_ID, id))?.status).toBe("approved");
    // The unit is held against other auto-approved members.
    seedUser(FRIEND_PHONE);
    seedMembership(FRIEND_PHONE, "family");
    expect((await reserve(FRIEND_PHONE, "saw", 5, 6)).status).toBe(409);

    sent.length = 0;
    const res = await post(`/admin/reservations/${id}/cancel`, OWNER_PHONE);
    expect(res.status).toBe(200);
    const row = await getReservation(GARAGE_ID, id);
    expect(row).toMatchObject({ status: "cancelled", cancelled_by_phone: OWNER_PHONE });
    expect(row?.cancelled_at).toBeTruthy();
    expect(sent).toEqual([
      expect.objectContaining({
        type: "reservation_decided",
        user_phone: FAMILY_PHONE,
        payload: expect.objectContaining({ status: "cancelled" }),
      }),
    ]);
    // Another member can now reserve the same window right away.
    expect((await reserve(FRIEND_PHONE, "saw", 5, 6)).status).toBe(201);

    const again = await post(`/admin/reservations/${id}/cancel`, OWNER_PHONE);
    expect(again.status).toBe(200);
  });

  it("members cannot use it, and pending requests go through decide instead", async () => {
    const pending = await idOf(await reserve(HOWDY_PHONE, "saw", 1, 2));
    expect((await post(`/admin/reservations/${pending}/cancel`, HOWDY_PHONE)).status).toBe(403);
    expect((await post(`/admin/reservations/${pending}/cancel`, OWNER_PHONE)).status).toBe(409);
    expect((await post(`/admin/reservations/nope/cancel`, OWNER_PHONE)).status).toBe(404);
  });
});

describe("GET /admin/reservations", () => {
  it("paginates with a cursor", async () => {
    await reserve(HOWDY_PHONE, "saw", 1, 2);
    await reserve(HOWDY_PHONE, "drill", 3, 4);
    const first = await call("GET", "/admin/reservations?limit=1", OWNER_PHONE);
    expect(first.status).toBe(200);
    const a = (await first.json()) as { reservations: unknown[]; next_cursor?: string };
    expect(a.reservations).toHaveLength(1);
    expect(a.next_cursor).toBeTruthy();
    const second = await call(
      "GET",
      `/admin/reservations?limit=1&cursor=${a.next_cursor}`,
      OWNER_PHONE,
    );
    const b = (await second.json()) as { reservations: unknown[]; next_cursor?: string };
    expect(b.reservations).toHaveLength(1);
    expect(b.next_cursor).toBeUndefined();
  });

  it("does not skip pending requests when the owner decides rows from an earlier page", async () => {
    seedItemRecord({ id: "ladder", min_tier: "howdy", auto_approve_tier: "family" });
    const ids = [
      await idOf(await reserve(HOWDY_PHONE, "saw", 1, 2)),
      await idOf(await reserve(HOWDY_PHONE, "drill", 3, 4)),
      await idOf(await reserve(HOWDY_PHONE, "ladder", 5, 6)),
    ];
    const first = (await (
      await call("GET", "/admin/reservations?limit=1", OWNER_PHONE)
    ).json()) as { reservations: { id: string }[]; next_cursor?: string };
    expect(first.reservations.map((r) => r.id)).toEqual([ids[0]]);
    // The owner declines the row just seen; the queue shrinks by one.
    const decided = await post(`/admin/reservations/${ids[0]}/decide`, OWNER_PHONE, {
      decision: "decline",
    });
    expect(decided.status).toBe(200);
    const second = (await (
      await call("GET", `/admin/reservations?limit=1&cursor=${first.next_cursor}`, OWNER_PHONE)
    ).json()) as { reservations: { id: string }[] };
    expect(second.reservations.map((r) => r.id)).toEqual([ids[1]]);
  });

  it("rejects a malformed cursor", async () => {
    const res = await call("GET", "/admin/reservations?cursor=bm9wZQ", OWNER_PHONE);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status filter", async () => {
    const res = await call("GET", "/admin/reservations?status=bogus", OWNER_PHONE);
    expect(res.status).toBe(400);
  });
});

describe("owner notification buckets", () => {
  it("borrow request pings do not use up the owner's shared daily cap", async () => {
    for (let i = 0; i < BORROW_REQUEST_NOTIFICATION_CAP; i++) {
      expect((await reserveSlot(GARAGE_ID, OWNER_PHONE, "borrow_request_pending")).allowed).toBe(
        true,
      );
    }
    expect((await reserveSlot(GARAGE_ID, OWNER_PHONE, "borrow_request_pending")).allowed).toBe(
      false,
    );
    const other = await reserveSlot(GARAGE_ID, OWNER_PHONE, "wishlist_popular");
    expect(other).toEqual({ allowed: true, count_after: 1 });
    const k = tenantUserKey(GARAGE_ID, OWNER_PHONE);
    const row = listAll().find((r) => r.PK === k.pk && r.SK === k.sk);
    expect(row?.["notifications_sent_today"]).toBe(1);
    expect(row?.["borrow_requests_notified_today"]).toBe(BORROW_REQUEST_NOTIFICATION_CAP + 1);
  });
});
