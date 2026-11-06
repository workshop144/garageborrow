import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { getReservation } from "../lib/repo.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  OWNER_PHONE,
  seedGarage,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { clearNotifierSpy, spyNotifier } from "./_notifier-spy.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

let sent: ReturnType<typeof spyNotifier>;

function post(path: string, phone: string, body: unknown) {
  return createApp().request(`/v1/g/${GARAGE_ID}${path}`, {
    method: "POST",
    headers: { ...authHeader(phone), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  // howdy resolves to "request" on this item.
  seedItemRecord({ id: "saw", min_tier: "howdy", auto_approve_tier: "family" });
});

afterEach(() => clearNotifierSpy());

async function requestBorrow(): Promise<string> {
  const res = await post("/loans", HOWDY_PHONE, { item_id: "saw", liability_acknowledged: true });
  expect(res.status).toBe(202);
  return ((await res.json()) as { reservation: { id: string } }).reservation.id;
}

describe("approval-required requests", () => {
  it("a borrow request notifies the owner, not the requester", async () => {
    await requestBorrow();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "borrow_request_pending", user_phone: OWNER_PHONE });
  });

  it("a reservation request notifies the owner, and no 'decided' goes to the requester", async () => {
    const res = await post("/reservations", HOWDY_PHONE, {
      item_id: "saw",
      start_at: "2099-02-01T12:00:00Z",
      end_at: "2099-02-03T12:00:00Z",
    });
    expect(res.status).toBe(201);
    expect(sent.map((e) => [e.type, e.user_phone])).toEqual([
      ["borrow_request_pending", OWNER_PHONE],
    ]);
  });

  it("the owner approves; the unit is then held and the member is told", async () => {
    const id = await requestBorrow();
    sent.length = 0;
    const res = await post(`/admin/reservations/${id}/decide`, OWNER_PHONE, {
      decision: "approve",
    });
    expect(res.status).toBe(200);
    expect((await getReservation(GARAGE_ID, id))?.status).toBe("approved");
    expect(sent.find((e) => e.type === "borrow_request_decided")).toMatchObject({
      user_phone: HOWDY_PHONE,
      payload: { status: "approved" },
    });
    // Another member can't take the saw over the approved window.
    const other = await post("/loans", FAMILY_PHONE, {
      item_id: "saw",
      liability_acknowledged: true,
    });
    expect(other.status).toBe(409);
    // Deciding twice is refused.
    const again = await post(`/admin/reservations/${id}/decide`, OWNER_PHONE, {
      decision: "decline",
    });
    expect(again.status).toBe(409);
  });

  it("the owner declines; members cannot decide", async () => {
    const id = await requestBorrow();
    const member = await post(`/admin/reservations/${id}/decide`, HOWDY_PHONE, {
      decision: "approve",
    });
    expect(member.status).toBe(403);
    const res = await post(`/admin/reservations/${id}/decide`, OWNER_PHONE, {
      decision: "decline",
      decline_reason: "Needs a blade first",
    });
    expect(res.status).toBe(200);
    expect((await getReservation(GARAGE_ID, id))?.status).toBe("declined");
  });

  it("lists pending requests for the owner", async () => {
    const id = await requestBorrow();
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/reservations`, {
      headers: authHeader(OWNER_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reservations: { id: string }[] };
    expect(body.reservations.map((r) => r.id)).toEqual([id]);
  });
});
