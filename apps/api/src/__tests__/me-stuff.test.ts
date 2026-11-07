import { gsi1ReservationByUser, reservationKey } from "@garageborrow/shared";
import type { Reservation } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { putWaitlist } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  OWNER_PHONE,
  seedGarage,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore, seedItem } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

type StuffBody = {
  loans: Array<{ loan: Record<string, unknown>; item: Record<string, unknown> }>;
  reservations: Array<{ reservation: Record<string, unknown>; item: Record<string, unknown> }>;
  waitlist: Array<{ entry: Record<string, unknown>; item: Record<string, unknown> }>;
  stats: { borrows_total: number; returns_on_time: number; borrows_active: number };
};

async function getStuff(phone: string, garage: string | null = GARAGE_ID): Promise<Response> {
  const qs = garage === null ? "" : `?garage=${encodeURIComponent(garage)}`;
  return createApp().request(`/v1/me/stuff${qs}`, { headers: authHeader(phone) });
}

function seedReservation(
  id: string,
  status: Reservation["status"],
  opts: Partial<Reservation> = {},
): void {
  const r: Reservation = {
    id,
    garage_id: GARAGE_ID,
    item_id: "item-1",
    borrower_phone: FAMILY_PHONE,
    start_at: "2099-01-05T12:00:00Z",
    end_at: "2099-01-08T12:00:00Z",
    status,
    approval_required: true,
    ...opts,
  };
  const k = reservationKey(r.garage_id, r.start_at.slice(0, 10), r.id);
  seedItem({ ...r, PK: k.pk, SK: k.sk, ...gsi1ReservationByUser(r.borrower_phone, r.start_at) });
}

function seedMember(overrides: Parameters<typeof seedMembership>[2] = {}): void {
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "friend", { vouched_by_phone: OWNER_PHONE, ...overrides });
}

describe("GET /v1/me/stuff access", () => {
  it("requires sign-in", async () => {
    seedMember();
    const res = await createApp().request(`/v1/me/stuff?garage=${GARAGE_ID}`);
    expect(res.status).toBe(401);
  });

  it("is a 400 without ?garage", async () => {
    seedMember();
    expect((await getStuff(FAMILY_PHONE, null)).status).toBe(400);
  });

  it("is a 404 for an unknown garage", async () => {
    seedMember();
    expect((await getStuff(FAMILY_PHONE, "no-such-garage")).status).toBe(404);
  });

  it("is a 403 for a signed-in non-member", async () => {
    seedMember();
    seedUser(HOWDY_PHONE);
    expect((await getStuff(HOWDY_PHONE)).status).toBe(403);
  });

  it("is a 403 once the member asked for deletion", async () => {
    seedMember();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-11-01T00:00:00Z" });
    expect((await getStuff(FAMILY_PHONE)).status).toBe(403);
  });

  it("gives the owner without a membership row an empty My Stuff", async () => {
    seedMember();
    const res = await getStuff(OWNER_PHONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      loans: [],
      reservations: [],
      waitlist: [],
      stats: { borrows_total: 0, returns_on_time: 0, borrows_active: 0 },
    });
  });
});

describe("GET /v1/me/stuff contents", () => {
  it("returns only the caller's open rows in this garage, with member views", async () => {
    seedMember({ borrows_total: 7, returns_on_time: 5, borrows_active: 2, notes: "owner note" });
    seedUser(FRIEND_PHONE);
    seedMembership(FRIEND_PHONE, "friend");
    seedItemRecord({
      id: "item-1",
      name: "Cordless Drill",
      handling_notes: "owner-only handling",
      donated_by_phone: FRIEND_PHONE,
    });
    seedItemRecord({ id: "item-2", name: "Ladder", category: "ladders" });

    // Loans: two out (overdue one due first), one returned, one in another
    // garage, one belonging to someone else.
    seedLoanRecord({
      id: "loan-active",
      item_id: "item-1",
      borrowed_at: "2026-11-01T12:00:00Z",
      expected_return_at: "2026-11-09T12:00:00Z",
      status: "active",
      ...({
        rev: 3,
        return_claimed_at: "2026-11-05T12:00:00Z",
        return_claimed_by: FAMILY_PHONE,
      } as object),
    });
    seedLoanRecord({
      id: "loan-overdue",
      item_id: "item-2",
      borrowed_at: "2026-10-20T12:00:00Z",
      expected_return_at: "2026-10-23T12:00:00Z",
      status: "overdue",
      ...({ disputed_at: "2026-10-24T12:00:00Z", dispute_reason: "Still in the truck" } as object),
    });
    seedLoanRecord({ id: "loan-returned", item_id: "item-1", status: "returned" });
    seedLoanRecord({
      id: "loan-elsewhere",
      item_id: "item-1",
      garage_id: "other-garage",
      borrowed_at: "2026-11-02T12:00:00Z",
      status: "active",
    });
    seedLoanRecord({
      id: "loan-friend",
      item_id: "item-1",
      borrower_phone: FRIEND_PHONE,
      borrowed_at: "2026-11-03T12:00:00Z",
      status: "active",
    });

    // Reservations: pending and approved upcoming ones show; cancelled,
    // declined and ended ones do not; nor do other garages or people.
    seedReservation("res-approved", "approved", {
      item_id: "item-2",
      start_at: "2099-02-01T12:00:00Z",
      end_at: "2099-02-03T12:00:00Z",
      decided_by_phone: OWNER_PHONE,
      decided_at: "2026-11-01T12:00:00Z",
    });
    seedReservation("res-pending", "pending", { source: "borrow" });
    seedReservation("res-cancelled", "cancelled", {
      start_at: "2099-03-01T12:00:00Z",
      cancelled_by_phone: OWNER_PHONE,
    });
    seedReservation("res-declined", "declined", { start_at: "2099-03-02T12:00:00Z" });
    seedReservation("res-ended", "approved", {
      start_at: "2020-01-01T12:00:00Z",
      end_at: "2020-01-02T12:00:00Z",
    });
    seedReservation("res-elsewhere", "approved", {
      garage_id: "other-garage",
      start_at: "2099-04-01T12:00:00Z",
    });
    seedReservation("res-friend", "approved", {
      borrower_phone: FRIEND_PHONE,
      start_at: "2099-04-02T12:00:00Z",
    });

    // Waitlist: the friend joined first, so the caller is #2 for item-1 even
    // though the stored position says 1 (positions are not renumbered).
    await putWaitlist({
      id: "w-friend",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FRIEND_PHONE,
      joined_at: "2026-11-01T10:00:00Z",
      position: 1,
      notify_when_available: true,
    });
    await putWaitlist({
      id: "w-mine",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      joined_at: "2026-11-01T11:00:00Z",
      position: 1,
      notify_when_available: true,
    });
    await putWaitlist({
      id: "w-gone-item",
      garage_id: GARAGE_ID,
      item_id: "item-deleted",
      borrower_phone: FAMILY_PHONE,
      joined_at: "2026-11-02T11:00:00Z",
      position: 4,
      notify_when_available: false,
    });

    const res = await getStuff(FAMILY_PHONE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StuffBody;

    expect(body.loans.map((l) => l.loan["id"])).toEqual(["loan-overdue", "loan-active"]);
    expect(body.loans[1]?.loan).toMatchObject({
      status: "active",
      return_claimed_at: "2026-11-05T12:00:00Z",
    });
    expect(body.loans[0]?.loan).toMatchObject({ dispute_reason: "Still in the truck" });
    for (const { loan } of body.loans) {
      expect(loan).not.toHaveProperty("rev");
      expect(loan).not.toHaveProperty("return_claimed_by");
    }
    expect(body.loans[1]?.item).toEqual({
      id: "item-1",
      name: "Cordless Drill",
      primary_photo_key: "uploads/test/img.jpg",
      category: "power-tools",
    });

    expect(body.reservations.map((r) => r.reservation["id"])).toEqual([
      "res-pending",
      "res-approved",
    ]);
    expect(body.reservations[1]?.reservation).toMatchObject({
      status: "approved",
      decided_at: "2026-11-01T12:00:00Z",
    });
    expect(body.reservations[1]?.reservation).not.toHaveProperty("decided_by_phone");
    expect(body.reservations[1]?.item).toMatchObject({ id: "item-2", name: "Ladder" });

    expect(body.waitlist.map((w) => [w.entry["id"], w.entry["position"]])).toEqual([
      ["w-mine", 2],
      ["w-gone-item", 1],
    ]);
    expect(body.waitlist[1]?.item).toEqual({
      id: "item-deleted",
      name: "Removed item",
      primary_photo_key: "",
      category: "",
    });

    expect(body.stats).toEqual({ borrows_total: 7, returns_on_time: 5, borrows_active: 2 });

    // No storage keys, owner-private data or other people's phones anywhere.
    const text = JSON.stringify(body);
    for (const leak of [
      OWNER_PHONE,
      FRIEND_PHONE,
      "owner note",
      "owner-only handling",
      '"PK"',
      '"SK"',
      "GSI1",
      "vouched_by",
      '"tier"',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it("does not show another garage's rows when asked for that garage by a non-member", async () => {
    seedMember();
    seedLoanRecord({
      id: "loan-elsewhere",
      item_id: "item-1",
      garage_id: "other-garage",
      status: "active",
    });
    // The caller is not a member of other-garage (it does not even exist).
    expect((await getStuff(FAMILY_PHONE, "other-garage")).status).toBe(404);
  });
});
