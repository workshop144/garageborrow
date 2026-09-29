import { beforeEach, describe, expect, it } from "vitest";
import type { Garage, WishlistRequest } from "@garageborrow/shared";

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
  setQueryPageSize,
} from "./_setup.js";
import { MAX_WISHLIST_CREATES_PER_DAY } from "../routes/wishlist.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

function seedAll(g: Partial<Garage> = {}): void {
  seedGarage(g);
  seedUser(OWNER_PHONE, { display_name: "Owner" });
  seedUser(FAMILY_PHONE, { display_name: "Fam" });
  seedUser(FRIEND_PHONE, { display_name: "Fri" });
  seedUser(HOWDY_PHONE, { display_name: "How" });
  seedMembership(OWNER_PHONE, "family");
  seedMembership(FAMILY_PHONE, "family");
  seedMembership(FRIEND_PHONE, "friend");
  seedMembership(HOWDY_PHONE, "howdy");
}

async function createReq(
  app: ReturnType<typeof createApp>,
  phone: string,
  body: Record<string, unknown> = { item_name: "Pressure washer" },
  key = "wish-create-1",
): Promise<{ id: string; vote_count: number }> {
  const res = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
    method: "POST",
    headers: {
      ...authHeader(phone),
      "content-type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as {
    request: WishlistRequest & { my_vote: boolean };
  };
  return { id: json.request.id, vote_count: json.request.vote_count };
}

describe("POST /wishlist — create + auto-vote", () => {
  it("creates the request, seeds vote_count=1, and writes a WishlistVote", async () => {
    seedAll();
    const app = createApp();
    const { id, vote_count } = await createReq(app, FAMILY_PHONE);
    expect(vote_count).toBe(1);

    const wishRows = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("WISH#"),
    );
    expect(wishRows).toHaveLength(1);
    const voteRows = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith(`WISHVOTE#${id}#`),
    );
    expect(voteRows).toHaveLength(1);
    expect(voteRows[0]!["voter_phone"]).toBe(FAMILY_PHONE);
  });

  it("writes a wishlist.created audit entry", async () => {
    seedAll();
    const app = createApp();
    await createReq(app, FAMILY_PHONE);
    const audit = listAll().filter(
      (it) =>
        typeof it["SK"] === "string" &&
        (it["SK"] as string).startsWith("AUDIT#") &&
        it["action_type"] === "wishlist.created",
    );
    expect(audit).toHaveLength(1);
  });

  it("rejects an oversized reference_url instead of storing a row every read loads", async () => {
    seedAll();
    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
      method: "POST",
      headers: {
        ...authHeader(HOWDY_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "wish-big-url",
      },
      body: JSON.stringify({
        item_name: "Ladder",
        reference_url: `https://a.example/${"x".repeat(390_000)}`,
      }),
    });
    expect(res.status).toBe(400);
    expect(listAll().filter((it) => String(it["SK"]).startsWith("WISH#"))).toHaveLength(0);
    // An ordinary product link still works.
    await createReq(
      app,
      HOWDY_PHONE,
      { item_name: "Ladder", reference_url: `https://a.example/${"x".repeat(500)}` },
      "wish-ok-url",
    );
  });
});

describe("POST/DELETE /wishlist/:id/vote — idempotent", () => {
  it("vote is idempotent on the composite key", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);

    // FRIEND votes once, then again — second is a no-op.
    const v1 = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "POST",
      headers: authHeader(FRIEND_PHONE),
    });
    expect(v1.status).toBe(200);
    const v1body = (await v1.json()) as { vote_count: number };
    expect(v1body.vote_count).toBe(2);

    const v2 = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "POST",
      headers: authHeader(FRIEND_PHONE),
    });
    expect(v2.status).toBe(200);
    const v2body = (await v2.json()) as { vote_count: number };
    expect(v2body.vote_count).toBe(2);

    // Unvote → count drops to 1.
    const u1 = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "DELETE",
      headers: authHeader(FRIEND_PHONE),
    });
    expect(u1.status).toBe(200);
    const u1body = (await u1.json()) as { vote_count: number };
    expect(u1body.vote_count).toBe(1);

    // Unvote again → still 1, no error.
    const u2 = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "DELETE",
      headers: authHeader(FRIEND_PHONE),
    });
    expect(u2.status).toBe(200);
    const u2body = (await u2.json()) as { vote_count: number };
    expect(u2body.vote_count).toBe(1);
  });

  it("vote_count denormalization stays correct across many voters", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    // Three more voters. Each one is independent; the ADD :delta path
    // ensures the running total is correct without the route reading the
    // value first.
    for (const p of [FRIEND_PHONE, HOWDY_PHONE, OWNER_PHONE]) {
      const r = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
        method: "POST",
        headers: authHeader(p),
      });
      expect(r.status).toBe(200);
    }
    const detail = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}`, {
      headers: authHeader(FAMILY_PHONE),
    });
    const body = (await detail.json()) as { request: { vote_count: number } };
    expect(body.request.vote_count).toBe(4);
  });
});

describe("Threshold crossing fires wishlist_popular once", () => {
  it("dispatches notifier exactly when the threshold is first reached", async () => {
    seedAll({ wishlist_popular_threshold: 3 });
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE); // count=1
    // Bring count to 3 with two more voters. The notifier dispatch is
    // observable as a `notification.dispatched.wishlist_popular` audit row.
    for (const p of [FRIEND_PHONE, HOWDY_PHONE]) {
      const r = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
        method: "POST",
        headers: authHeader(p),
      });
      expect(r.status).toBe(200);
    }
    const dispatchAudit = listAll().filter(
      (it) =>
        typeof it["SK"] === "string" &&
        (it["SK"] as string).startsWith("AUDIT#") &&
        it["action_type"] === "notification.dispatched.wishlist_popular",
    );
    expect(dispatchAudit).toHaveLength(1);

    // Push count to 4. Should NOT fire again.
    const r = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "POST",
      headers: authHeader(OWNER_PHONE),
    });
    expect(r.status).toBe(200);
    const dispatchAudit2 = listAll().filter(
      (it) =>
        typeof it["SK"] === "string" &&
        (it["SK"] as string).startsWith("AUDIT#") &&
        it["action_type"] === "notification.dispatched.wishlist_popular",
    );
    expect(dispatchAudit2).toHaveLength(1);
  });
});

describe("Owner decide — acquired", () => {
  it("links acquired_item_id and notifies all voters", async () => {
    seedAll();
    seedItemRecord({ id: "washer" });
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "POST",
      headers: authHeader(FRIEND_PHONE),
    });
    const decide = await app.request(`/v1/g/${GARAGE_ID}/admin/wishlist/${id}/decide`, {
      method: "POST",
      headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ decision: "acquired", acquired_item_id: "washer" }),
    });
    expect(decide.status).toBe(200);
    const body = (await decide.json()) as { request: WishlistRequest };
    expect(body.request.status).toBe("acquired");
    expect(body.request.acquired_item_id).toBe("washer");
    const acquiredDispatches = listAll().filter(
      (it) =>
        typeof it["SK"] === "string" &&
        (it["SK"] as string).startsWith("AUDIT#") &&
        it["action_type"] === "notification.dispatched.wishlist_acquired",
    );
    // Two voters → two dispatches (requester + the second voter).
    expect(acquiredDispatches).toHaveLength(2);
  });
});

describe("Owner decide — duplicate", () => {
  it("transfers votes to the canonical request", async () => {
    seedAll();
    const app = createApp();
    const { id: canonicalId } = await createReq(
      app,
      FAMILY_PHONE,
      { item_name: "Log splitter" },
      "wish-create-canon",
    );
    const { id: dupeId } = await createReq(
      app,
      FRIEND_PHONE,
      { item_name: "Splitter (log)" },
      "wish-create-dupe",
    );
    // HOWDY votes for the dupe.
    await app.request(`/v1/g/${GARAGE_ID}/wishlist/${dupeId}/vote`, {
      method: "POST",
      headers: authHeader(HOWDY_PHONE),
    });
    // Canonical starts at 1 (FAMILY auto-vote). Dupe has 2 (FRIEND + HOWDY).
    const decide = await app.request(`/v1/g/${GARAGE_ID}/admin/wishlist/${dupeId}/decide`, {
      method: "POST",
      headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ decision: "duplicate", duplicate_of_id: canonicalId }),
    });
    expect(decide.status).toBe(200);
    const body = (await decide.json()) as { transferred_votes: number };
    expect(body.transferred_votes).toBe(2);

    const canon = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${canonicalId}`, {
      headers: authHeader(OWNER_PHONE),
    });
    const canonBody = (await canon.json()) as { request: WishlistRequest };
    expect(canonBody.request.vote_count).toBe(3);
  });
});

describe("wishlist_enabled=false 404s every route", () => {
  it("read and write endpoints all 404", async () => {
    seedAll({ wishlist_enabled: false });
    const app = createApp();
    const list = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(list.status).toBe(404);

    const create = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ item_name: "x" }),
    });
    expect(create.status).toBe(404);
  });
});

describe("Cancel — only requester or owner", () => {
  it("rejects cancel from a third party", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    const res = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}`, {
      method: "DELETE",
      headers: authHeader(FRIEND_PHONE),
    });
    expect(res.status).toBe(403);
  });

  it("requester can cancel", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    const res = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}`, {
      method: "DELETE",
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request: WishlistRequest };
    expect(body.request.status).toBe("cancelled");
  });

  it("owner can cancel (treated as decline)", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    const res = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}`, {
      method: "DELETE",
      headers: authHeader(OWNER_PHONE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request: WishlistRequest };
    expect(body.request.status).toBe("cancelled");
    expect(body.request.decline_reason).toBe("owner cancelled");
  });
});

describe("List sorting + my_vote", () => {
  it("sorts by votes desc and decorates my_vote", async () => {
    seedAll();
    const app = createApp();
    const { id: a } = await createReq(app, FAMILY_PHONE, { item_name: "A" }, "wish-list-1");
    const { id: b } = await createReq(app, FRIEND_PHONE, { item_name: "B" }, "wish-list-2");
    // B gets one more vote → 2 vs 1.
    await app.request(`/v1/g/${GARAGE_ID}/wishlist/${b}/vote`, {
      method: "POST",
      headers: authHeader(FAMILY_PHONE),
    });
    const list = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: Array<WishlistRequest & { my_vote: boolean }>;
    };
    expect(body.items.map((r) => r.id)).toEqual([b, a]);
    // FAMILY voted on both A (auto-vote) and B (extra vote).
    expect(body.items.every((r) => r.my_vote)).toBe(true);
  });
});

describe("Wishlist phone privacy", () => {
  it("shows other members' phones as last 4 only; the owner sees full numbers", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    const vote = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "POST",
      headers: authHeader(FRIEND_PHONE),
    });
    expect(vote.status).toBe(200);

    for (const path of [`/v1/g/${GARAGE_ID}/wishlist/${id}`, `/v1/g/${GARAGE_ID}/wishlist`]) {
      const res = await app.request(path, { headers: authHeader(HOWDY_PHONE) });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(FAMILY_PHONE);
      expect(text).not.toContain(FRIEND_PHONE);
      expect(text).toContain(`***${FAMILY_PHONE.slice(-4)}`);
    }
    const howdyVote = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
      method: "POST",
      headers: authHeader(HOWDY_PHONE),
    });
    expect(await howdyVote.text()).not.toContain(FAMILY_PHONE);

    const owner = await app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}`, {
      headers: authHeader(OWNER_PHONE),
    });
    const ownerText = await owner.text();
    expect(ownerText).toContain(FAMILY_PHONE);
    expect(ownerText).toContain(FRIEND_PHONE);
  });
});

describe("wishlist votes under concurrency", () => {
  it("counts one vote per member when two vote requests race", async () => {
    seedAll();
    const app = createApp();
    const { id } = await createReq(app, FAMILY_PHONE);
    const vote = (method: string) =>
      app.request(`/v1/g/${GARAGE_ID}/wishlist/${id}/vote`, {
        method,
        headers: authHeader(FRIEND_PHONE),
      });
    const count = () =>
      listAll().find((r) => r.SK.startsWith("WISH#") && r["id"] === id)?.["vote_count"];
    const [a, b] = await Promise.all([vote("POST"), vote("POST")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(count()).toBe(2);
    const [c, d] = await Promise.all([vote("DELETE"), vote("DELETE")]);
    expect([c.status, d.status]).toEqual([200, 200]);
    expect(count()).toBe(1);
  });

  it("lists every request even when the table returns them over several pages", async () => {
    seedAll();
    const app = createApp();
    for (let i = 0; i < 3; i++)
      await createReq(app, FAMILY_PHONE, { item_name: `Tool ${i}` }, `w${i}`);
    setQueryPageSize(2);
    const res = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
      headers: authHeader(FRIEND_PHONE),
    });
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(3);
  });

  it("caps how many requests one member can open per day", async () => {
    seedAll();
    const app = createApp();
    for (let i = 0; i < MAX_WISHLIST_CREATES_PER_DAY; i++) {
      await createReq(app, FAMILY_PHONE, { item_name: `Tool ${i}` }, `cap${i}`);
    }
    const over = await app.request(`/v1/g/${GARAGE_ID}/wishlist`, {
      method: "POST",
      headers: {
        ...authHeader(FAMILY_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "cap-over",
      },
      body: JSON.stringify({ item_name: "One too many" }),
    });
    expect(over.status).toBe(429);
  });

  it("bounds the photo reference size", async () => {
    seedAll();
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/wishlist`, {
      method: "POST",
      headers: {
        ...authHeader(FAMILY_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "big",
      },
      body: JSON.stringify({ item_name: "Saw", photo_url: "x".repeat(5000) }),
    });
    expect(res.status).toBe(400);
  });
});
