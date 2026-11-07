// Owner admin routes that had no direct tests: members, settings, incidents,
// active loans, reminders, plus owner item/instance management and member
// incident reports. Notifier calls are captured by the spy, never sent.

import { incidentKey, tenantMemberKey, tenantMetaKey } from "@garageborrow/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  OWNER_PHONE,
  seedGarage,
  seedInstanceRecord,
  seedItemRecord,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { clearNotifierSpy, spyNotifier } from "./_notifier-spy.js";
import type { NotifierEvent } from "../lib/notify.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

let sent: NotifierEvent[];
let keyN = 0;

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  sent = spyNotifier();
  seedGarage();
  seedUser(OWNER_PHONE, { display_name: "Owner" });
  seedUser(FAMILY_PHONE, { display_name: "Fam" });
  seedUser(FRIEND_PHONE, { display_name: "Fri" });
  seedUser(HOWDY_PHONE, { display_name: "How" });
  seedMembership(OWNER_PHONE, "family");
  seedMembership(FAMILY_PHONE, "family");
  seedMembership(FRIEND_PHONE, "friend");
  seedMembership(HOWDY_PHONE, "howdy", { returns_on_time: 3 });
});

afterEach(() => {
  clearNotifierSpy();
});

function call(method: string, path: string, phone: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    createApp().request(`/v1/g/${GARAGE_ID}${path}`, {
      method,
      headers: {
        ...authHeader(phone),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        "Idempotency-Key": `k-${++keyN}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

const auditRows = (): Array<Record<string, unknown>> =>
  listAll().filter((r) => String(r.SK).startsWith("AUDIT#"));

describe("admin routes are owner-only", () => {
  it.each([
    ["GET", "/admin/members"],
    ["GET", "/admin/settings"],
    ["GET", "/admin/incidents"],
    ["GET", "/admin/active-loans"],
    ["GET", "/admin/promotion-suggestions"],
  ])("%s %s is 403 for a member", async (method, path) => {
    expect((await call(method, path, FAMILY_PHONE)).status).toBe(403);
  });

  it("refuses a member's settings change and writes nothing", async () => {
    const res = await call("PATCH", "/admin/settings", FAMILY_PHONE, { name: "Mine now" });
    expect(res.status).toBe(403);
    expect(auditRows()).toHaveLength(0);
  });
});

describe("members", () => {
  it("lists memberships sorted by phone with a cursor", async () => {
    const r1 = await call("GET", "/admin/members?limit=2", OWNER_PHONE);
    const p1 = (await r1.json()) as {
      members: Array<{ user_phone: string }>;
      next_cursor?: string;
    };
    expect(p1.members.map((m) => m.user_phone)).toEqual([OWNER_PHONE, FAMILY_PHONE]);
    const r2 = await call(
      "GET",
      `/admin/members?limit=2&cursor=${encodeURIComponent(p1.next_cursor ?? "")}`,
      OWNER_PHONE,
    );
    const p2 = (await r2.json()) as {
      members: Array<{ user_phone: string }>;
      next_cursor?: string;
    };
    expect(p2.members.map((m) => m.user_phone)).toEqual([FRIEND_PHONE, HOWDY_PHONE]);
    expect(p2.next_cursor).toBeUndefined();
  });

  it("promoting to family sets the celebration flag, notifies and audits", async () => {
    const res = await call(
      "PATCH",
      `/admin/members/${encodeURIComponent(FRIEND_PHONE)}`,
      OWNER_PHONE,
      {
        tier: "family",
        notes: "Helped at the swap",
      },
    );
    expect(res.status).toBe(200);
    const { membership } = (await res.json()) as { membership: Record<string, unknown> };
    expect(membership).toMatchObject({
      tier: "family",
      celebration_pending: true,
      notes: "Helped at the swap",
    });
    expect(sent).toEqual([
      {
        type: "tier_promoted",
        garage_id: GARAGE_ID,
        user_phone: FRIEND_PHONE,
        payload: { new_tier: "family", promoted_to_family: true },
      },
    ]);
    const audit = auditRows().filter((a) => String(a.action_type).startsWith("member."));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action_type: "member.tier_changed", entity_id: FRIEND_PHONE });
  });

  it("a notes-only edit is not a promotion: no flag, no notification", async () => {
    const res = await call(
      "PATCH",
      `/admin/members/${encodeURIComponent(HOWDY_PHONE)}`,
      OWNER_PHONE,
      {
        notes: "new neighbor",
        tier: "howdy",
      },
    );
    const { membership } = (await res.json()) as { membership: Record<string, unknown> };
    expect(membership.celebration_pending).toBe(false);
    expect(sent).toEqual([]);
    expect(auditRows()[0]).toMatchObject({ action_type: "member.updated" });
  });

  it("a demotion notifies without the family celebration", async () => {
    await call("PATCH", `/admin/members/${encodeURIComponent(FAMILY_PHONE)}`, OWNER_PHONE, {
      tier: "friend",
    });
    expect(sent[0]?.payload).toEqual({ new_tier: "friend", promoted_to_family: false });
    const k = tenantMemberKey(GARAGE_ID, FAMILY_PHONE);
    const row = listAll().find((r) => r.PK === k.pk && r.SK === k.sk);
    expect(row).toMatchObject({ tier: "friend", celebration_pending: false });
  });

  it("is 404 for an unknown member and 400 for unknown fields", async () => {
    expect(
      (await call("PATCH", "/admin/members/%2B15555550999", OWNER_PHONE, { tier: "friend" }))
        .status,
    ).toBe(404);
    expect(
      (
        await call("PATCH", `/admin/members/${encodeURIComponent(FRIEND_PHONE)}`, OWNER_PHONE, {
          tier: "friend",
          is_owner: true,
        })
      ).status,
    ).toBe(400);
  });

  it("suggests promoting howdy members with enough on-time returns", async () => {
    const res = await call("GET", "/admin/promotion-suggestions", OWNER_PHONE);
    expect(await res.json()).toEqual({
      threshold: 3,
      suggestions: [
        {
          user_phone: HOWDY_PHONE,
          current_tier: "howdy",
          suggested_tier: "friend",
          returns_on_time: 3,
        },
      ],
    });
  });
});

describe("settings", () => {
  it("returns the full garage to the owner", async () => {
    const res = await call("GET", "/admin/settings", OWNER_PHONE);
    const { garage } = (await res.json()) as { garage: Record<string, unknown> };
    expect(garage).toMatchObject({ id: GARAGE_ID, owner_phone: OWNER_PHONE });
  });

  it("applies only the given fields and audits before/after", async () => {
    const res = await call("PATCH", "/admin/settings", OWNER_PHONE, {
      status: "closed_until",
      closed_until_date: "2026-05-01",
      ai_enabled: true,
      wishlist_popular_threshold: 9,
    });
    expect(res.status).toBe(200);
    const k = tenantMetaKey(GARAGE_ID);
    const row = listAll().find((r) => r.PK === k.pk && r.SK === k.sk);
    expect(row).toMatchObject({
      name: "Test Garage",
      status: "closed_until",
      closed_until_date: "2026-05-01",
      ai_enabled: true,
      wishlist_popular_threshold: 9,
      owner_phone: OWNER_PHONE,
    });
    const audit = auditRows()[0];
    expect(audit).toMatchObject({ action_type: "garage.settings_updated", entity_type: "garage" });
    expect((audit?.before_snapshot as Record<string, unknown>).status).toBe("open");
  });

  it("cannot change the owner or other unlisted fields", async () => {
    const res = await call("PATCH", "/admin/settings", OWNER_PHONE, { owner_phone: FRIEND_PHONE });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed closed_until_date", async () => {
    const res = await call("PATCH", "/admin/settings", OWNER_PHONE, { closed_until_date: "May 1" });
    expect(res.status).toBe(400);
  });
});

describe("incidents", () => {
  function seedIncident(
    id: string,
    created_at: string,
    status = "open",
    extra: Record<string, unknown> = {},
  ): void {
    const k = incidentKey(GARAGE_ID, created_at.slice(0, 10), id);
    seedItem({
      PK: k.pk,
      SK: k.sk,
      id,
      garage_id: GARAGE_ID,
      item_id: "item-1",
      loan_id: "loan-1",
      reporter_phone: FRIEND_PHONE,
      type: "damage",
      description: "Chuck wobbles",
      photo_keys: [],
      status,
      created_at,
      ...extra,
    });
  }

  it("lists newest first and filters by status", async () => {
    seedIncident("inc-a", "2026-04-02T00:00:00Z");
    seedIncident("inc-b", "2026-04-05T00:00:00Z", "resolved");
    seedIncident("inc-c", "2026-04-04T00:00:00Z");
    const all = (await (await call("GET", "/admin/incidents", OWNER_PHONE)).json()) as {
      incidents: Array<{ id: string }>;
    };
    expect(all.incidents.map((i) => i.id)).toEqual(["inc-b", "inc-c", "inc-a"]);
    const open = (await (
      await call("GET", "/admin/incidents?status=open", OWNER_PHONE)
    ).json()) as {
      incidents: Array<{ id: string }>;
    };
    expect(open.incidents.map((i) => i.id)).toEqual(["inc-c", "inc-a"]);
  });

  it("rejects an unknown status filter", async () => {
    expect((await call("GET", "/admin/incidents?status=bogus", OWNER_PHONE)).status).toBe(400);
  });

  it("resolving sets resolved_at once and keeps the reporter's suggestion", async () => {
    seedIncident("inc-a", "2026-04-02T00:00:00Z", "open", {
      suggested_action: "Replace the chuck",
    });
    const r1 = await call("PATCH", "/admin/incidents/inc-a", OWNER_PHONE, {
      status: "resolved",
      resolution_notes: "Tightened it",
    });
    expect(r1.status).toBe(200);
    const { incident } = (await r1.json()) as { incident: Record<string, unknown> };
    // Bug fix (tests/coverage-2026-11-06c): notes used to overwrite suggested_action.
    expect(incident).toMatchObject({
      status: "resolved",
      suggested_action: "Replace the chuck",
      resolution_notes: "Tightened it",
    });
    expect(typeof incident.resolved_at).toBe("string");

    const r2 = await call("PATCH", "/admin/incidents/inc-a", OWNER_PHONE, { status: "closed" });
    const second = ((await r2.json()) as { incident: Record<string, unknown> }).incident;
    expect(second.resolved_at).toBe(incident.resolved_at);
    expect(auditRows().map((a) => a.action_type)).toEqual(["incident.updated", "incident.updated"]);
  });

  it("rejects resolution notes over 1000 characters and leaves the incident open", async () => {
    seedIncident("inc-a", "2026-04-02T00:00:00Z");
    const res = await call("PATCH", "/admin/incidents/inc-a", OWNER_PHONE, {
      status: "resolved",
      resolution_notes: "x".repeat(1001),
    });
    expect(res.status).toBe(400);
    const k = incidentKey(GARAGE_ID, "2026-04-02", "inc-a");
    expect(listAll().find((r) => r.PK === k.pk && r.SK === k.sk)).toMatchObject({
      status: "open",
    });
    expect(auditRows()).toHaveLength(0);
  });

  it("is 404 for an unknown incident", async () => {
    expect(
      (await call("PATCH", "/admin/incidents/nope", OWNER_PHONE, { status: "closed" })).status,
    ).toBe(404);
  });
});

describe("active loans and reminders", () => {
  it("lists only active loans, soonest due first, with the borrower's name", async () => {
    seedItemRecord();
    seedLoanRecord({
      item_id: "item-1",
      id: "loan-late",
      status: "active",
      borrower_phone: FRIEND_PHONE,
      borrowed_at: "2026-04-03T00:00:00Z",
      expected_return_at: "2026-04-10T00:00:00Z",
    });
    seedLoanRecord({
      item_id: "item-1",
      id: "loan-soon",
      status: "active",
      borrower_phone: "+15555550955", // no profile row: falls back to last 4
      borrowed_at: "2026-04-02T00:00:00Z",
      expected_return_at: "2026-04-05T00:00:00Z",
    });
    seedLoanRecord({ item_id: "item-1", id: "loan-done", status: "returned" });
    const res = await call("GET", "/admin/active-loans", OWNER_PHONE);
    const { loans } = (await res.json()) as {
      loans: Array<{ id: string; borrower_display_name: string }>;
    };
    expect(loans.map((l) => [l.id, l.borrower_display_name])).toEqual([
      ["loan-soon", "0955"],
      ["loan-late", "Fri"],
    ]);
  });

  it("queues a reminder to the borrower and audits it", async () => {
    seedLoanRecord({
      item_id: "item-1",
      id: "loan-1",
      status: "active",
      borrower_phone: FRIEND_PHONE,
    });
    const res = await call("POST", "/admin/loans/loan-1/remind", OWNER_PHONE);
    expect(await res.json()).toEqual({ status: "queued" });
    expect(sent).toEqual([
      {
        type: "loan_reminder",
        garage_id: GARAGE_ID,
        user_phone: FRIEND_PHONE,
        payload: { loan_id: "loan-1", expected_return_at: "2026-04-04T12:00:00Z" },
      },
    ]);
    expect(auditRows().map((a) => a.action_type)).toContain("loan.reminder_sent");
  });

  it("will not remind for an unknown loan", async () => {
    expect((await call("POST", "/admin/loans/nope/remind", OWNER_PHONE)).status).toBe(404);
    expect(sent).toEqual([]);
  });

  it("a member cannot send reminders", async () => {
    seedLoanRecord({
      item_id: "item-1",
      id: "loan-1",
      status: "active",
      borrower_phone: FRIEND_PHONE,
    });
    expect((await call("POST", "/admin/loans/loan-1/remind", HOWDY_PHONE)).status).toBe(403);
    expect(sent).toEqual([]);
  });
});

describe("owner item management", () => {
  it("returning an item to service tells the waitlist; other edits do not", async () => {
    seedItemRecord({ status: "maintenance" });
    const r1 = await call("PATCH", "/items/item-1", OWNER_PHONE, { description: "Fixed chuck" });
    expect(r1.status).toBe(200);
    expect(sent).toEqual([]);
    const r2 = await call("PATCH", "/items/item-1", OWNER_PHONE, { status: "available" });
    const { item } = (await r2.json()) as { item: Record<string, unknown> };
    expect(item).toMatchObject({ status: "available", description: "Fixed chuck" });
    expect(sent).toEqual([
      { type: "waitlist_unblocked", garage_id: GARAGE_ID, payload: { item_id: "item-1" } },
    ]);
  });

  it("PATCH on an unknown item is 404 and members cannot edit", async () => {
    expect((await call("PATCH", "/items/nope", OWNER_PHONE, { name: "x" })).status).toBe(404);
    seedItemRecord();
    expect((await call("PATCH", "/items/item-1", FAMILY_PHONE, { name: "x" })).status).toBe(403);
  });

  it("adds and edits instances", async () => {
    seedItemRecord();
    const created = await call("POST", "/items/item-1/instances", OWNER_PHONE, {
      label: "B",
      quality_tier: "A",
      notes: "new battery",
    });
    expect(created.status).toBe(201);
    const { instance } = (await created.json()) as { instance: { id: string } };
    const patched = await call("PATCH", `/items/item-1/instances/${instance.id}`, OWNER_PHONE, {
      status: "broken",
    });
    expect(patched.status).toBe(200);
    expect(
      ((await patched.json()) as { instance: Record<string, unknown> }).instance,
    ).toMatchObject({
      label: "B",
      notes: "new battery",
      status: "broken",
    });
  });

  it("instance routes 404 for unknown items or instances and reject bad input", async () => {
    expect(
      (await call("POST", "/items/nope/instances", OWNER_PHONE, { label: "A", quality_tier: "A" }))
        .status,
    ).toBe(404);
    seedItemRecord();
    seedInstanceRecord("item-1");
    expect(
      (await call("PATCH", "/items/item-1/instances/nope", OWNER_PHONE, { label: "Z" })).status,
    ).toBe(404);
    expect(
      (
        await call("PATCH", "/items/item-1/instances/inst-item-1-1", OWNER_PHONE, {
          status: "stolen",
        })
      ).status,
    ).toBe(400);
    expect((await call("POST", "/items/item-1/instances", OWNER_PHONE, { label: "" })).status).toBe(
      400,
    );
  });

  it("retires an item", async () => {
    seedItemRecord();
    const res = await call("POST", "/items/item-1/retire", OWNER_PHONE);
    expect(res.status).toBe(200);
    expect((await call("POST", "/items/nope/retire", OWNER_PHONE)).status).toBe(404);
  });
});

describe("item detail", () => {
  it("shows status pills and the caller's place in line", async () => {
    seedItemRecord({ status: "all_loaned" });
    seedInstanceRecord("item-1");
    for (const [phone, at, id] of [
      [HOWDY_PHONE, "2026-04-03T00:00:00Z", "w-2"],
      [FRIEND_PHONE, "2026-04-02T00:00:00Z", "w-1"],
    ] as const) {
      seedItem({
        PK: `TENANT#${GARAGE_ID}`,
        SK: `WAIT#item-1#${at}#${phone}`,
        id,
        garage_id: GARAGE_ID,
        item_id: "item-1",
        borrower_phone: phone,
        joined_at: at,
        position: 1,
        notify_when_available: true,
      });
    }
    const res = await call("GET", "/items/item-1", HOWDY_PHONE);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status_pills: ["All loaned out"],
      waitlist_size: 2,
      my_waitlist_entry: { id: "w-2", position: 2 },
    });
  });

  it("answers 404 for a tier-hidden item, same as a missing one", async () => {
    seedItemRecord({ min_tier: "family" });
    expect((await call("GET", "/items/item-1", HOWDY_PHONE)).status).toBe(404);
    expect((await call("GET", "/items/nope", HOWDY_PHONE)).status).toBe(404);
  });
});

describe("POST /incidents", () => {
  const report = {
    item_id: "item-1",
    loan_id: "loan-1",
    type: "damage",
    description: "Cracked case",
    suggested_action: "Glue",
  };

  it("lets the owner file a report", async () => {
    const res = await call("POST", "/incidents", OWNER_PHONE, report);
    expect(res.status).toBe(201);
    const { incident } = (await res.json()) as { incident: Record<string, unknown> };
    expect(incident).toMatchObject({
      reporter_phone: OWNER_PHONE,
      status: "open",
      suggested_action: "Glue",
    });
  });

  it("is owner-only and rejects a bad type", async () => {
    expect((await call("POST", "/incidents", FRIEND_PHONE, report)).status).toBe(403);
    expect(
      (await call("POST", "/incidents", OWNER_PHONE, { ...report, type: "theft" })).status,
    ).toBe(400);
    expect(listAll().filter((r) => String(r.SK).startsWith("INCIDENT#"))).toHaveLength(0);
  });
});
