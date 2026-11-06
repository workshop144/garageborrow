import { reservationKey, gsi1ReservationByUser } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  putDonation,
  putNotification,
  putPushSubscription,
  putWaitlist,
  putWishlistRequest,
  putWishlistVote,
} from "../lib/repo.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
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

function seedMember(): void {
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "friend", { vouched_by_phone: OWNER_PHONE });
}

function seedReservation(status: "approved" | "pending" | "cancelled"): void {
  const start = "2099-01-05T12:00:00Z";
  const r = {
    id: `res-${status}`,
    garage_id: GARAGE_ID,
    item_id: "item-1",
    borrower_phone: FAMILY_PHONE,
    start_at: start,
    end_at: "2099-01-08T12:00:00Z",
    status,
    approval_required: true,
  };
  const k = reservationKey(GARAGE_ID, start.slice(0, 10), r.id);
  seedItem({ ...r, PK: k.pk, SK: k.sk, ...gsi1ReservationByUser(FAMILY_PHONE, start) });
}

async function requestDelete(key: string): Promise<Response> {
  return createApp().request("/v1/me/delete-request", {
    method: "POST",
    headers: { ...authHeader(FAMILY_PHONE), "Idempotency-Key": key },
  });
}

describe("GET /v1/me membership projection", () => {
  it("never returns the owner's private notes, the tier or vouching details", async () => {
    seedMember();
    const app = createApp();
    const patch = await app.request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "notes-1",
      },
      body: JSON.stringify({
        notes: "unreliable, don't lend the trailer",
        ai_budget_override_tokens: 42,
      }),
    });
    expect(patch.status).toBe(200);

    const res = await app.request("/v1/me", { headers: authHeader(FAMILY_PHONE) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("unreliable");
    expect(text).not.toContain(OWNER_PHONE);
    const body = JSON.parse(text) as {
      tier?: unknown;
      memberships: Record<string, unknown>[];
    };
    expect(body.tier).toBeUndefined();
    expect(Object.keys(body.memberships[0] ?? {}).sort()).toEqual([
      "borrows_active",
      "borrows_total",
      "celebration_pending",
      "garage_id",
      "joined_at",
      "returns_late",
      "returns_on_time",
    ]);
  });
});

describe("accounts scheduled for deletion", () => {
  it("are refused garage actions after delete-request", async () => {
    seedMember();
    seedItemRecord();
    expect((await requestDelete("del-ctx")).status).toBe(200);

    const app = createApp();
    const garage = await app.request(`/v1/g/${GARAGE_ID}`, { headers: authHeader(FAMILY_PHONE) });
    expect(garage.status).toBe(403);
    const borrow = await app.request(`/v1/g/${GARAGE_ID}/loans`, {
      method: "POST",
      headers: {
        ...authHeader(FAMILY_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "borrow-after-delete",
      },
      body: JSON.stringify({ item_id: "item-1", duration_days: 2, liability_acknowledged: true }),
    });
    expect(borrow.status).toBe(403);
  });

  it("delete-request is a 409 while a loan is still out", async () => {
    seedMember();
    seedLoanRecord({ item_id: "item-1", status: "active" });
    const res = await requestDelete("del-loan");
    expect(res.status).toBe(409);
    const garage = await createApp().request(`/v1/g/${GARAGE_ID}`, {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(garage.status).toBe(200);
  });

  it("delete-request is a 409 while a loan is overdue", async () => {
    seedMember();
    seedLoanRecord({ item_id: "item-1", status: "overdue" });
    expect((await requestDelete("del-overdue")).status).toBe(409);
  });

  it("delete-request is a 409 while an approved reservation stands", async () => {
    seedMember();
    seedReservation("approved");
    expect((await requestDelete("del-res")).status).toBe(409);
  });

  it("returned loans and cancelled reservations do not block deletion", async () => {
    seedMember();
    seedLoanRecord({ item_id: "item-1", status: "returned" });
    seedReservation("cancelled");
    expect((await requestDelete("del-ok")).status).toBe(200);
  });
});

describe("GET /v1/me/data-export", () => {
  it("contains one record of every kind keyed by the caller's phone", async () => {
    seedMember();
    seedLoanRecord({ item_id: "item-1", status: "returned" });
    seedReservation("pending");
    await putWaitlist({
      id: "wait-1",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      joined_at: "2026-04-02T12:00:00Z",
      position: 0,
      notify_when_available: true,
    });
    await putDonation({
      id: "don-1",
      garage_id: GARAGE_ID,
      donor_phone: FAMILY_PHONE,
      item_name: "Ladder",
      description: "Six foot",
      photo_keys: [],
      condition: "good",
      status: "accepted",
      decided_by_phone: OWNER_PHONE,
      created_at: "2026-04-02T12:00:00Z",
    });
    await putWishlistRequest({
      id: "wish-1",
      garage_id: GARAGE_ID,
      requester_phone: FAMILY_PHONE,
      item_name: "Tile saw",
      status: "open",
      vote_count: 1,
      created_at: "2026-04-02T12:00:00Z",
      updated_at: "2026-04-02T12:00:00Z",
    });
    await putWishlistVote(GARAGE_ID, {
      request_id: "wish-1",
      voter_phone: FAMILY_PHONE,
      voted_at: "2026-04-02T12:00:00Z",
    });
    await putNotification({
      id: "n-1",
      user_phone: FAMILY_PHONE,
      type: "loan_reminder",
      payload: {},
      channel: "inapp",
      sent_at: "2026-04-02T12:00:00Z",
    });
    await putPushSubscription(
      {
        user_phone: FAMILY_PHONE,
        endpoint: "https://push.example/sub-1",
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
        created_at: "2026-04-02T12:00:00Z",
      },
      "hash1",
    );
    // Someone else's records stay out.
    await putWaitlist({
      id: "wait-other",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: OWNER_PHONE,
      joined_at: "2026-04-03T12:00:00Z",
      position: 1,
      notify_when_available: true,
    });

    const res = await createApp().request("/v1/me/data-export", {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, Record<string, unknown>[]>;

    for (const kind of [
      "profiles",
      "memberships",
      "loans",
      "reservations",
      "waitlist",
      "donations",
      "wishlist_requests",
      "wishlist_votes",
      "notifications",
      "push_subscriptions",
    ]) {
      expect(body[kind], kind).toHaveLength(1);
    }
    expect(body["waitlist"]?.[0]?.["id"]).toBe("wait-1");
    expect(body["push_subscriptions"]?.[0]).toEqual({
      endpoint: "https://push.example/sub-1",
      created_at: "2026-04-02T12:00:00Z",
    });
    // No storage keys, push secrets, owner notes or other people's phones.
    expect(text).not.toMatch(/"(PK|SK|GSI\d(PK|SK))"/);
    expect(text).not.toContain("secret-");
    expect(text).not.toContain(OWNER_PHONE);
    expect(body["memberships"]?.[0]?.["notes"]).toBeUndefined();
  });
});
