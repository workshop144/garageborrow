import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { listAll } from "./_setup.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  resetDdbStore,
  setQueryPageSize,
} from "./_setup.js";
import { MAX_DONATIONS_PER_DAY } from "../routes/donations.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

async function submitDonation(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request(`/v1/g/${GARAGE_ID}/donations`, {
    method: "POST",
    headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
    body: JSON.stringify({
      item_name: "Old Saw",
      description: "Works fine.",
      condition: "good",
      photo_keys: ["uploads/test/saw.jpg"],
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { donation: { id: string } };
  return body.donation.id;
}

describe("Donation accept/decline", () => {
  it("creates an Item record on accept", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedUser(OWNER_PHONE, { display_name: "Owner" });

    const app = createApp();
    const donationId = await submitDonation(app);

    const decideRes = await app.request(`/v1/g/${GARAGE_ID}/admin/donations/${donationId}/decide`, {
      method: "POST",
      headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept", item_overrides: { category: "tools" } }),
    });
    expect(decideRes.status).toBe(200);
    const body = (await decideRes.json()) as {
      donation: { status: string; resulting_item_id?: string };
      item: { id: string; donated_by_phone: string; status: string };
    };
    expect(body.donation.status).toBe("accepted");
    expect(body.donation.resulting_item_id).toBe(body.item.id);
    expect(body.item.donated_by_phone).toBe(FAMILY_PHONE);
    expect(body.item.status).toBe("available");
    // The new Item should be persisted to the in-memory DDB.
    const itemRecords = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("ITEM#"),
    );
    expect(itemRecords).toHaveLength(1);
  });

  it("does not create an Item on decline", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");

    const app = createApp();
    const donationId = await submitDonation(app);

    const decideRes = await app.request(`/v1/g/${GARAGE_ID}/admin/donations/${donationId}/decide`, {
      method: "POST",
      headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ decision: "decline", decline_reason: "duplicate" }),
    });
    expect(decideRes.status).toBe(200);
    const body = (await decideRes.json()) as { donation: { status: string } };
    expect(body.donation.status).toBe("declined");
    const itemRecords = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("ITEM#"),
    );
    expect(itemRecords).toHaveLength(0);
  });

  it("never shows the donor's phone (or table keys) to other members", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedUser(OWNER_PHONE, { display_name: "Owner" });
    seedUser(FRIEND_PHONE);
    seedMembership(FRIEND_PHONE, "friend");

    const app = createApp();
    const donationId = await submitDonation(app);
    const decideRes = await app.request(`/v1/g/${GARAGE_ID}/admin/donations/${donationId}/decide`, {
      method: "POST",
      headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept", item_overrides: { category: "tools" } }),
    });
    const { item } = (await decideRes.json()) as { item: { id: string } };

    for (const path of [`/v1/g/${GARAGE_ID}/items`, `/v1/g/${GARAGE_ID}/items/${item.id}`]) {
      const res = await app.request(path, { headers: authHeader(FRIEND_PHONE) });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(FAMILY_PHONE);
      expect(text).not.toContain("donated_by_phone");
      expect(text).not.toMatch(/"(PK|SK)"/);
    }
  });
});

describe("Donation limits and listing", () => {
  function post(app: ReturnType<typeof createApp>, body: Record<string, unknown>) {
    return app.request(`/v1/g/${GARAGE_ID}/donations`, {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const offer = { item_name: "Old Saw", description: "Works.", condition: "good", photo_keys: [] };

  it("bounds member-supplied field sizes", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    const res = await post(createApp(), { ...offer, description: "x".repeat(20_000) });
    expect(res.status).toBe(400);
    const keys = await post(createApp(), { ...offer, photo_keys: Array(50).fill("uploads/a.jpg") });
    expect(keys.status).toBe(400);
  });

  it("caps how many offers one member can submit per day", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    const app = createApp();
    for (let i = 0; i < MAX_DONATIONS_PER_DAY; i++) {
      expect((await post(app, offer)).status).toBe(201);
    }
    expect((await post(app, offer)).status).toBe(429);
  });

  it("owner list returns every offer across table pages", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "family");
    seedUser(OWNER_PHONE, { display_name: "Owner" });
    const app = createApp();
    for (let i = 0; i < 3; i++) await submitDonation(app);
    setQueryPageSize(2);
    const res = await app.request(`/v1/g/${GARAGE_ID}/admin/donations`, {
      headers: authHeader(OWNER_PHONE),
    });
    const body = (await res.json()) as { donations: unknown[] };
    expect(body.donations).toHaveLength(3);
  });
});
