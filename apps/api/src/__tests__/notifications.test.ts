import { beforeEach, describe, expect, it } from "vitest";
import { notificationKey } from "@garageborrow/shared";
import type { Notification } from "@garageborrow/shared";

import { createApp } from "../index.js";
import { FAMILY_PHONE, GARAGE_ID, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore, seedItem } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
});

function seedNotification(
  n: Partial<Notification> & { sent_at: string; id: string },
): Notification {
  const note: Notification = {
    user_phone: FAMILY_PHONE,
    garage_id: GARAGE_ID,
    type: "loan_returned",
    payload: {},
    channel: "inapp",
    ...n,
  };
  const k = notificationKey(note.user_phone, note.sent_at, note.id);
  seedItem({ ...(note as unknown as Record<string, unknown>), PK: k.pk, SK: k.sk });
  return note;
}

describe("GET /v1/me/notifications", () => {
  it("returns last 30 days, sorted desc by sent_at", async () => {
    const now = Date.now();
    const iso = (offsetDays: number) => new Date(now - offsetDays * 86400_000).toISOString();
    seedNotification({ id: "n1", sent_at: iso(1) });
    seedNotification({ id: "n2", sent_at: iso(5) });
    seedNotification({ id: "n3", sent_at: iso(40) }); // outside 30d window
    const app = createApp();
    const res = await app.request("/v1/me/notifications", {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Notification[] };
    expect(body.items.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("filters by ?unread=true|false", async () => {
    const iso = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400_000).toISOString();
    seedNotification({ id: "u1", sent_at: iso(1) });
    seedNotification({ id: "r1", sent_at: iso(2), read_at: iso(0) });
    const app = createApp();
    const unread = await app.request("/v1/me/notifications?unread=true", {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const unreadBody = (await unread.json()) as { items: Notification[] };
    expect(unreadBody.items.map((n) => n.id)).toEqual(["u1"]);
    const read = await app.request("/v1/me/notifications?unread=false", {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const readBody = (await read.json()) as { items: Notification[] };
    expect(readBody.items.map((n) => n.id)).toEqual(["r1"]);
  });

  it("paginates with cursor", async () => {
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      seedNotification({ id: `n${i}`, sent_at: new Date(base - i * 1000).toISOString() });
    }
    const app = createApp();
    const first = await app.request("/v1/me/notifications?limit=2", {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const firstBody = (await first.json()) as { items: Notification[]; next_cursor?: string };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.next_cursor).toBeTypeOf("string");
    const second = await app.request(
      `/v1/me/notifications?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor!)}`,
      { headers: { ...authHeader(FAMILY_PHONE) } },
    );
    const secondBody = (await second.json()) as { items: Notification[] };
    expect(secondBody.items).toHaveLength(2);
    expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
  });
});

describe("POST /v1/me/notifications/:id/read", () => {
  it("stamps read_at on the matching notification", async () => {
    seedNotification({ id: "n1", sent_at: new Date().toISOString() });
    const app = createApp();
    const res = await app.request("/v1/me/notifications/n1/read", {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notification: Notification };
    expect(body.notification.read_at).toBeTypeOf("string");
  });

  it("404s for unknown id", async () => {
    const app = createApp();
    const res = await app.request("/v1/me/notifications/nope/read", {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/me/notifications/read-all", () => {
  it("marks every unread notification read and returns the count", async () => {
    const iso = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400_000).toISOString();
    seedNotification({ id: "n1", sent_at: iso(1) });
    seedNotification({ id: "n2", sent_at: iso(2) });
    seedNotification({ id: "n3", sent_at: iso(3), read_at: iso(0) });
    const app = createApp();
    const res = await app.request("/v1/me/notifications/read-all", {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { marked_read: number };
    expect(body.marked_read).toBe(2);
    // Subsequent unread query should return zero.
    const list = await app.request("/v1/me/notifications?unread=true", {
      headers: { ...authHeader(FAMILY_PHONE) },
    });
    const listBody = (await list.json()) as { items: Notification[] };
    expect(listBody.items).toHaveLength(0);
  });
});
