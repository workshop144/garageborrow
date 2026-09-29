// Borrow, reserve and waitlist honour owner-set item state, existing loans and
// reservations, and the item's tier gate; the notifier never writes rows for a
// deleted member.

import { reservationKey, tenantUserKey } from "@garageborrow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../index.js";
import { setPushDriver, setSmsDriver } from "../lib/channels.js";
import { dispatch, handleDirectInvoke } from "../notifier.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  seedGarage,
  seedInstanceRecord,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import {
  authHeader,
  deleteItem,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
  seedUser(FRIEND_PHONE);
  seedMembership(FRIEND_PHONE, "friend");
  seedUser(HOWDY_PHONE);
  seedMembership(HOWDY_PHONE, "howdy");
});

let n = 0;
async function post(path: string, phone: string, body: Record<string, unknown>) {
  const app = createApp();
  return app.request(`/v1/g/${GARAGE_ID}${path}`, {
    method: "POST",
    headers: {
      ...authHeader(phone),
      "content-type": "application/json",
      "Idempotency-Key": `k-${++n}`,
    },
    body: JSON.stringify(body),
  });
}

const borrow = (item_id: string, extra: Record<string, unknown> = {}, phone = FAMILY_PHONE) =>
  post("/loans", phone, { item_id, liability_acknowledged: true, ...extra });

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

describe("POST /loans availability", () => {
  it.each(["retired", "broken", "maintenance", "lost", "all_loaned"] as const)(
    "refuses an instant loan on a %s item",
    async (status) => {
      seedItemRecord({ id: "drill", status });
      const res = await borrow("drill");
      expect(res.status).toBe(409);
      expect(listAll().filter((r) => String(r.SK).startsWith("LOAN#"))).toHaveLength(0);
    },
  );

  it("refuses a second active loan on a single-unit item", async () => {
    seedItemRecord({ id: "drill" });
    seedLoanRecord({
      item_id: "drill",
      borrower_phone: FRIEND_PHONE,
      status: "active",
      borrowed_at: new Date().toISOString(),
      expected_return_at: futureIso(3),
    });
    const res = await borrow("drill");
    expect(res.status).toBe(409);
  });

  it("lends again once the earlier loan is returned", async () => {
    seedItemRecord({ id: "drill" });
    seedLoanRecord({ item_id: "drill", borrower_phone: FRIEND_PHONE, status: "returned" });
    expect((await borrow("drill")).status).toBe(201);
  });

  it("refuses an instance that does not belong to the item or is out of service", async () => {
    seedItemRecord({ id: "drill" });
    seedItemRecord({ id: "saw" });
    seedInstanceRecord("saw", { id: "saw-1" });
    seedInstanceRecord("drill", { id: "drill-1", status: "broken" });
    seedInstanceRecord("drill", { id: "drill-2" });
    seedMembership(FRIEND_PHONE, "family");
    expect((await borrow("drill", { instance_id: "saw-1" })).status).toBe(404);
    expect((await borrow("drill", { instance_id: "drill-1" })).status).toBe(409);
    const ok = await borrow("drill", { instance_id: "drill-2" });
    expect(ok.status).toBe(201);
    // drill-2 is now out; the only other unit is broken.
    expect((await borrow("drill", {}, FRIEND_PHONE)).status).toBe(409);
  });

  it("assigns a free unit when none is named, and stops when all are out", async () => {
    seedItemRecord({ id: "clamp", status: "partial_loaned" });
    seedInstanceRecord("clamp", { id: "c1" });
    seedInstanceRecord("clamp", { id: "c2" });
    seedMembership(FRIEND_PHONE, "family");
    const a = await borrow("clamp");
    const b = await borrow("clamp", {}, FRIEND_PHONE);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const ids = [
      ((await a.json()) as { loan: { instance_id: string } }).loan.instance_id,
      ((await b.json()) as { loan: { instance_id: string } }).loan.instance_id,
    ];
    expect(new Set(ids)).toEqual(new Set(["c1", "c2"]));
    expect((await borrow("clamp", {}, FRIEND_PHONE)).status).toBe(409);
  });

  it("answers a tier-hidden item exactly like a missing one", async () => {
    seedItemRecord({ id: "fancy", min_tier: "family" });
    const hidden = await borrow("fancy", {}, HOWDY_PHONE);
    const missing = await borrow("nope", {}, HOWDY_PHONE);
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
  });
});

describe("POST /reservations availability", () => {
  it("refuses an auto-approved reservation on a retired item or with end before start", async () => {
    seedItemRecord({ id: "old", status: "retired" });
    seedItemRecord({ id: "drill" });
    const retired = await post("/reservations", FAMILY_PHONE, {
      item_id: "old",
      start_at: futureIso(1),
      end_at: futureIso(2),
    });
    expect(retired.status).toBe(409);
    const backwards = await post("/reservations", FAMILY_PHONE, {
      item_id: "drill",
      start_at: futureIso(2),
      end_at: futureIso(1),
    });
    expect(backwards.status).toBe(400);
  });

  it("refuses an overlapping approved reservation but allows a later window", async () => {
    seedItemRecord({ id: "drill" });
    const start = futureIso(1);
    const end = futureIso(3);
    const k = reservationKey(GARAGE_ID, start.slice(0, 10), "r-other");
    seedItem({
      PK: k.pk,
      SK: k.sk,
      id: "r-other",
      garage_id: GARAGE_ID,
      item_id: "drill",
      borrower_phone: FRIEND_PHONE,
      start_at: start,
      end_at: end,
      status: "approved",
      approval_required: false,
    });
    const clash = await post("/reservations", FAMILY_PHONE, {
      item_id: "drill",
      start_at: futureIso(2),
      end_at: futureIso(4),
    });
    expect(clash.status).toBe(409);
    const later = await post("/reservations", FAMILY_PHONE, {
      item_id: "drill",
      start_at: futureIso(5),
      end_at: futureIso(6),
    });
    expect(later.status).toBe(201);
    // Borrowing now overlaps the other member's approved window.
    expect((await borrow("drill")).status).toBe(409);
  });
});

describe("POST /items/:id/waitlist", () => {
  it("hides tier-hidden items and keeps one place per member", async () => {
    seedItemRecord({ id: "fancy", min_tier: "family" });
    seedItemRecord({ id: "drill", status: "all_loaned" });
    expect((await post("/items/fancy/waitlist", HOWDY_PHONE, {})).status).toBe(404);
    expect((await post("/items/drill/waitlist", HOWDY_PHONE, {})).status).toBe(201);
    expect((await post("/items/drill/waitlist", HOWDY_PHONE, {})).status).toBe(409);
  });

  it("notifies the first waiter who can still see the item", async () => {
    seedItemRecord({ id: "drill", min_tier: "friend" });
    const wait = (phone: string, at: string) =>
      seedItem({
        PK: `TENANT#${GARAGE_ID}`,
        SK: `WAIT#drill#${at}#${phone}`,
        id: `w-${phone}`,
        garage_id: GARAGE_ID,
        item_id: "drill",
        borrower_phone: phone,
        joined_at: at,
        position: 1,
        notify_when_available: true,
      });
    // HOWDY joined first (before the item's tier was raised).
    wait(HOWDY_PHONE, "2026-04-25T10:00:00Z");
    wait(FRIEND_PHONE, "2026-04-25T11:00:00Z");
    const sms = vi.fn((_to: string) => Promise.resolve());
    setSmsDriver(sms as never);
    setPushDriver(vi.fn(() => Promise.resolve(0)) as never);
    await handleDirectInvoke(
      { type: "waitlist_unblocked", garage_id: GARAGE_ID, payload: { item_id: "drill" } },
      new Date("2026-04-26T15:00:00Z"),
    );
    const inbox = listAll().filter((r) => String(r.SK).startsWith("NOTIFICATION#"));
    expect(inbox.map((r) => r.PK)).toEqual([`USER#${FRIEND_PHONE}`]);
    setSmsDriver(undefined);
    setPushDriver(undefined);
  });
});

describe("notifier and deleted members", () => {
  it("sends nothing to a soft-deleted member and writes no rows for them", async () => {
    const user = seedUser(HOWDY_PHONE, { deleted_at: "2026-03-01T00:00:00Z" });
    const before = listAll().length;
    await dispatch({
      user,
      garage_id: GARAGE_ID,
      prefs: user.notification_prefs,
      type: "loan_extended",
      title: "t",
      body: "b",
      payload: {},
      urgent: true,
      now: new Date("2026-04-26T15:00:00Z"),
    });
    expect(listAll().length).toBe(before);
  });

  it("does not recreate a user row the cleaner deleted after the liveness read", async () => {
    const user = seedUser(HOWDY_PHONE);
    const k = tenantUserKey(GARAGE_ID, HOWDY_PHONE);
    deleteItem(k.pk, k.sk); // hard delete lands between getUser and dispatch
    await dispatch({
      user,
      garage_id: GARAGE_ID,
      prefs: { ...user.notification_prefs, sms_enabled: false, push_enabled: false },
      type: "loan_extended",
      title: "t",
      body: "b",
      payload: {},
      urgent: true,
      now: new Date("2026-04-26T15:00:00Z"),
    });
    const leftovers = listAll().filter(
      (r) => r.PK === `USER#${HOWDY_PHONE}` || (r.PK === k.pk && r.SK === k.sk),
    );
    expect(leftovers).toEqual([]);
  });
});
