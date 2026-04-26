import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { listAll } from "./_setup.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

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
});
