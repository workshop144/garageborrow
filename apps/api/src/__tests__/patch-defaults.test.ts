// Zod 4 applies `.default()` even inside `.optional()` / `.partial()`. A PATCH
// schema built that way fills every omitted field with its default, and the
// merge then overwrites what the user or owner had stored. These cover each
// PATCH whose body schema wraps fields that carry defaults.

import { itemKey, tenantMetaKey } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

function row(pk: string, sk: string): Record<string, unknown> | undefined {
  return listAll().find((r) => r.PK === pk && r.SK === sk);
}

describe("PATCH bodies leave omitted fields alone", () => {
  it("PATCH /v1/me keeps notification prefs the body does not mention", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, {
      notification_prefs: {
        sms_enabled: false,
        push_enabled: true,
        reminders: true,
        waitlist_updates: false,
        new_tools: true,
        promotion_celebrations: true,
        ai_ready_notify: true,
        quiet_hours_start: "22:30",
        quiet_hours_end: "07:15",
      },
    });
    seedMembership(FAMILY_PHONE, "family");

    const res = await createApp().request("/v1/me", {
      method: "PATCH",
      headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ notification_prefs: { reminders: false } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { notification_prefs: Record<string, unknown> } };
    expect(body.user.notification_prefs).toMatchObject({
      reminders: false,
      sms_enabled: false,
      waitlist_updates: false,
      ai_ready_notify: true,
      quiet_hours_start: "22:30",
      quiet_hours_end: "07:15",
    });
  });

  it("PATCH item keeps approval and tier settings the body does not mention", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    seedItemRecord({
      requires_approval: true,
      min_tier: "friend",
      auto_approve_tier: "howdy",
      default_duration_days: 7,
      tags: ["cordless"],
    });

    const res = await createApp().request(`/v1/g/${GARAGE_ID}/items/item-1`, {
      method: "PATCH",
      headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ name: "Impact Driver" }),
    });
    expect(res.status).toBe(200);
    const k = itemKey(GARAGE_ID, "item-1");
    expect(row(k.pk, k.sk)).toMatchObject({
      name: "Impact Driver",
      requires_approval: true,
      min_tier: "friend",
      auto_approve_tier: "howdy",
      default_duration_days: 7,
      tags: ["cordless"],
    });
  });

  it("PATCH admin settings keeps custom tier labels when the body omits them", async () => {
    const labels = { howdy: "Neighbor", friend: "Regular", family: "Crew" };
    seedGarage({ tier_labels: labels });
    seedUser(OWNER_PHONE);

    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/settings`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "settings-labels-1",
      },
      body: JSON.stringify({ name: "Renamed Garage" }),
    });
    expect(res.status).toBe(200);
    const k = tenantMetaKey(GARAGE_ID);
    expect(row(k.pk, k.sk)).toMatchObject({ name: "Renamed Garage", tier_labels: labels });
  });
});
