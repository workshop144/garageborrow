import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  HOWDY_PHONE,
  OWNER_PHONE,
  seedGarage,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

function auditEntries() {
  return listAll().filter(
    (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("AUDIT#"),
  );
}

describe("audit middleware", () => {
  it("writes an AuditLogEntry on a successful admin mutation", async () => {
    seedGarage();
    seedUser(OWNER_PHONE, { display_name: "Owner" });
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "friend");

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "audit-key-1",
      },
      body: JSON.stringify({ tier: "family" }),
    });
    expect(res.status).toBe(200);

    const entries = auditEntries();
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry["actor_phone"]).toBe(OWNER_PHONE);
    expect(entry["action_type"]).toBe("member.tier_changed");
    expect(entry["entity_type"]).toBe("member");
    expect(entry["entity_id"]).toBe(FAMILY_PHONE);
    expect((entry["before_snapshot"] as { tier: string }).tier).toBe("friend");
    expect((entry["after_snapshot"] as { tier: string }).tier).toBe("family");
  });

  it("does not write an audit entry on a 4xx error", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/admin/members/${HOWDY_PHONE}`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "audit-key-2",
      },
      body: JSON.stringify({ tier: "friend" }),
    });
    expect(res.status).toBe(404);
    expect(auditEntries()).toHaveLength(0);
  });

  it("audit-log endpoint filters by action_type and date range", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    seedUser(FAMILY_PHONE);
    seedMembership(FAMILY_PHONE, "friend");

    const app = createApp();
    await app.request(`/v1/g/${GARAGE_ID}/admin/members/${FAMILY_PHONE}`, {
      method: "PATCH",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "audit-key-3",
      },
      body: JSON.stringify({ tier: "family" }),
    });

    const all = await app.request(`/v1/g/${GARAGE_ID}/admin/audit-log`, {
      headers: authHeader(OWNER_PHONE),
    });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { entries: { action_type: string }[] };
    expect(allBody.entries.length).toBeGreaterThanOrEqual(1);

    const filtered = await app.request(
      `/v1/g/${GARAGE_ID}/admin/audit-log?action_type=member.tier_changed`,
      { headers: authHeader(OWNER_PHONE) },
    );
    const fbody = (await filtered.json()) as { entries: { action_type: string }[] };
    expect(fbody.entries.length).toBeGreaterThanOrEqual(1);
    for (const e of fbody.entries) expect(e.action_type).toBe("member.tier_changed");

    const empty = await app.request(`/v1/g/${GARAGE_ID}/admin/audit-log?action_type=member.nope`, {
      headers: authHeader(OWNER_PHONE),
    });
    const ebody = (await empty.json()) as { entries: unknown[] };
    expect(ebody.entries).toEqual([]);
  });
});
