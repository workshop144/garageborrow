// Writes that touch one attribute of a shared row must not rewrite the rest of
// it: PATCH /v1/me and friends used to put a snapshot of one garage's profile
// row over every garage's row (resetting that row's notification counter).

import { tenantUserKey } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { FAMILY_PHONE, GARAGE_ID, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

const OTHER_GARAGE = "other-garage";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

function seedTwoGarageMember(): void {
  seedGarage();
  seedGarage({ id: OTHER_GARAGE });
  const u = seedUser(FAMILY_PHONE, { garages_member_of: [GARAGE_ID, OTHER_GARAGE] });
  seedMembership(FAMILY_PHONE, "family");
  const k = tenantUserKey(OTHER_GARAGE, FAMILY_PHONE);
  seedItem({
    ...u,
    display_name: "Other-garage name",
    notifications_sent_today: 5,
    PK: k.pk,
    SK: k.sk,
    GSI1PK: `USER#${FAMILY_PHONE}`,
    GSI1SK: `USER#${OTHER_GARAGE}`,
  });
}

function otherRow(): Record<string, unknown> | undefined {
  const k = tenantUserKey(OTHER_GARAGE, FAMILY_PHONE);
  return listAll().find((r) => r.PK === k.pk && r.SK === k.sk);
}

describe("profile writes are attribute-scoped", () => {
  it("PATCH /v1/me keeps each garage row's notification counter", async () => {
    seedTwoGarageMember();
    const res = await createApp().request("/v1/me", {
      method: "PATCH",
      headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ visibility: "hidden", notification_prefs: { reminders: false } }),
    });
    expect(res.status).toBe(200);
    const row = otherRow();
    expect(row?.["notifications_sent_today"]).toBe(5);
    expect(row?.["display_name"]).toBe("Other-garage name");
    expect(row?.["visibility"]).toBe("hidden");
    expect((row?.["notification_prefs"] as { reminders: boolean }).reminders).toBe(false);
  });

  it("delete-request marks every row without rewriting it", async () => {
    seedTwoGarageMember();
    const res = await createApp().request("/v1/me/delete-request", {
      method: "POST",
      headers: { ...authHeader(FAMILY_PHONE), "Idempotency-Key": "del-1" },
    });
    expect(res.status).toBe(200);
    const row = otherRow();
    expect(row?.["deleted_at"]).toBeDefined();
    expect(row?.["notifications_sent_today"]).toBe(5);
  });
});
