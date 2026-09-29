import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";
import {
  donationKey,
  loanKey,
  reservationKey,
  tenantUserKey,
  waitlistKey,
} from "@garageborrow/shared";

import {
  getPendingScrub,
  mentionsPhone,
  runCleanup,
  scrubPhone,
  setCognitoClient,
} from "../account-cleaner.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import {
  deleteItem as resetOne,
  installDdbMock,
  listAll,
  onNextScan,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

const PSEUDONYM = /^deleted-user-[0-9a-f]{12}$/;
const PSEUDONYM_ANYWHERE = /deleted-user-[0-9a-f]{12}/;
let cognitoDeletes: string[] = [];

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  cognitoDeletes = [];
  // Cognito calls fail closed in tests — silence them by injecting a stub.
  setCognitoClient({
    send: (cmd: { input: { Username: string } }) => {
      cognitoDeletes.push(cmd.input.Username);
      return Promise.resolve({});
    },
  } as never);
});

describe("account-cleaner", () => {
  it("hard-deletes users past 30-day soft-delete and anonymizes their loans/reservations/donations/waitlist", async () => {
    seedGarage();
    const longAgo = "2026-03-01T12:00:00Z"; // > 30 days before 2026-04-26
    seedUser(FAMILY_PHONE, { deleted_at: longAgo });
    seedMembership(FAMILY_PHONE, "family");

    const loanRow = {
      id: "loan-old",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      borrowed_at: "2026-03-02T12:00:00Z",
      expected_return_at: "2026-03-05T12:00:00Z",
      status: "returned" as const,
      extension_count: 0,
      liability_acknowledged_at: "2026-03-02T12:00:00Z",
      liability_copy_version: "v1",
    };
    const lk = loanKey(GARAGE_ID, "2026-03-02", loanRow.id);
    seedItem({ ...loanRow, PK: lk.pk, SK: lk.sk });

    const resRow = {
      id: "res-old",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      start_at: "2026-03-02T12:00:00Z",
      end_at: "2026-03-04T12:00:00Z",
      status: "approved" as const,
      approval_required: false,
    };
    const rk = reservationKey(GARAGE_ID, "2026-03-02", resRow.id);
    seedItem({ ...resRow, PK: rk.pk, SK: rk.sk });

    const donRow = {
      id: "don-old",
      garage_id: GARAGE_ID,
      donor_phone: FAMILY_PHONE,
      item_name: "wrench",
      description: "",
      photo_keys: [],
      condition: "good" as const,
      status: "pending" as const,
      created_at: "2026-03-02T12:00:00Z",
    };
    const dk = donationKey(GARAGE_ID, "2026-03-02", donRow.id);
    seedItem({ ...donRow, PK: dk.pk, SK: dk.sk });

    const waitRow = {
      id: "wait-old",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      joined_at: "2026-03-02T12:00:00Z",
      position: 1,
      notify_when_available: true,
    };
    const wk = waitlistKey(GARAGE_ID, "item-1", "2026-03-02T12:00:00Z", FAMILY_PHONE);
    seedItem({ ...waitRow, PK: wk.pk, SK: wk.sk });

    const counts = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(counts.hard_deleted_users).toBe(1);
    expect(counts.records_anonymized).toBeGreaterThanOrEqual(4);

    const all = listAll();
    const loan = all.find((r) => r.SK?.startsWith?.("LOAN#"));
    const replacement = loan?.["borrower_phone"];
    expect(replacement).toMatch(PSEUDONYM);
    for (const row of all) {
      if (row["borrower_phone"] === FAMILY_PHONE) {
        throw new Error(`borrower_phone not anonymized on ${row.SK}`);
      }
      if (row["donor_phone"] === FAMILY_PHONE) {
        throw new Error(`donor_phone not anonymized on ${row.SK}`);
      }
      // Verify swap actually wrote the pseudonym.
      if (row.SK?.startsWith?.("LOAN#")) {
        expect(row["borrower_phone"]).toBe(replacement);
      }
    }
    // The user record itself should be gone.
    const userKey = tenantUserKey(GARAGE_ID, FAMILY_PHONE);
    const userRow = all.find((r) => r.PK === userKey.pk && r.SK === userKey.sk);
    expect(userRow).toBeUndefined();
  });

  it("does not delete users whose deleted_at is within the 30-day window", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-04-20T12:00:00Z" });
    const counts = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(counts.hard_deleted_users).toBe(0);
    const userKey = tenantUserKey(GARAGE_ID, FAMILY_PHONE);
    const userRow = listAll().find((r) => r.PK === userKey.pk && r.SK === userKey.sk);
    expect(userRow).toBeDefined();
  });

  it("resets notifications_sent_today on every user record", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    // Seed the counter directly on the existing record. The user fixture
    // doesn't expose the field in its overrides type, so we mutate the
    // store entry in place.
    const userKey = tenantUserKey(GARAGE_ID, FAMILY_PHONE);
    const all = listAll();
    const row = all.find((r) => r.PK === userKey.pk && r.SK === userKey.sk);
    if (!row) throw new Error("seeded user not found");
    (row as Record<string, unknown>)["notifications_sent_today"] = 4;
    const counts = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(counts.counters_reset).toBe(1);
    const updated = listAll().find((r) => r.PK === userKey.pk && r.SK === userKey.sk);
    expect(
      (updated as { notifications_sent_today?: number } | undefined)?.notifications_sent_today,
    ).toBe(0);
  });

  it("scrubs the phone from derived copies: donated items, audit snapshots, keyed rows", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const pk = `TENANT#${GARAGE_ID}`;
    seedItem({ PK: pk, SK: "ITEM#donated-1", id: "donated-1", donated_by_phone: FAMILY_PHONE });
    seedItem({
      PK: pk,
      SK: "AUDIT#2026-03-02#a1",
      id: "a1",
      actor_phone: OWNER_PHONE,
      before_snapshot: { donor_phone: FAMILY_PHONE, tags: ["x", FAMILY_PHONE] },
      after_snapshot: { item: { donated_by_phone: FAMILY_PHONE } },
    });
    const wk = waitlistKey(GARAGE_ID, "item-1", "2026-03-02T12:00:00Z", FAMILY_PHONE);
    seedItem({ PK: wk.pk, SK: wk.sk, item_id: "item-1", borrower_phone: FAMILY_PHONE });

    await runCleanup(new Date("2026-04-26T03:00:00Z"));

    const all = listAll();
    expect(JSON.stringify(all)).not.toContain(FAMILY_PHONE);
    const audit = all.find((r) => r.SK === "AUDIT#2026-03-02#a1");
    expect(audit?.["actor_phone"]).toBe(OWNER_PHONE);
    expect(JSON.stringify(audit)).toMatch(PSEUDONYM_ANYWHERE);
  });

  it("resets the counter without rewriting the rest of a profile changed mid-sweep", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE);
    const userKey = tenantUserKey(GARAGE_ID, FAMILY_PHONE);
    const row = listAll().find((r) => r.PK === userKey.pk && r.SK === userKey.sk);
    if (!row) throw new Error("seeded user not found");
    row["notifications_sent_today"] = 4;
    // The sweep's Scan of users (the second Scan) returns the old snapshot; the
    // member renames themselves before the reset write lands.
    onNextScan(() => onNextScan(() => seedItem({ ...row, display_name: "Renamed mid-sweep" })));
    await runCleanup(new Date("2026-04-26T03:00:00Z"));
    const updated = listAll().find((r) => r.PK === userKey.pk && r.SK === userKey.sk);
    expect(updated?.["display_name"]).toBe("Renamed mid-sweep");
    expect(updated?.["notifications_sent_today"]).toBe(0);
  });

  // The scrub reads the whole table with one Scan and writes later; runCleanup's
  // fourth Scan (deleted users, their partition, votes, whole table) is that one.
  function afterWholeTableScan(fn: () => void): void {
    onNextScan(() => onNextScan(() => onNextScan(() => onNextScan(fn))));
  }

  it("keeps an edit made to a row between the scrub's Scan and its write", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const pk = `TENANT#${GARAGE_ID}`;
    const row = { PK: pk, SK: "ITEM#donated-1", id: "donated-1", name: "Drill" };
    seedItem({ ...row, donated_by_phone: FAMILY_PHONE });
    afterWholeTableScan(() =>
      seedItem({ ...row, donated_by_phone: FAMILY_PHONE, name: "Cordless drill" }),
    );

    await runCleanup(new Date("2026-04-26T03:00:00Z"));

    const item = listAll().find((r) => r.SK === "ITEM#donated-1");
    expect(item?.["name"]).toBe("Cordless drill");
    expect(item?.["donated_by_phone"]).toMatch(PSEUDONYM);
  });

  it("re-reads a re-keyed row edited mid-sweep instead of writing the stale copy", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const wk = waitlistKey(GARAGE_ID, "item-1", "2026-03-02T12:00:00Z", FAMILY_PHONE);
    const row = { PK: wk.pk, SK: wk.sk, item_id: "item-1", borrower_phone: FAMILY_PHONE };
    seedItem({ ...row, notify_when_available: true });
    afterWholeTableScan(() => seedItem({ ...row, notify_when_available: false }));

    await runCleanup(new Date("2026-04-26T03:00:00Z"));

    const all = listAll();
    expect(JSON.stringify(all)).not.toContain(FAMILY_PHONE);
    const moved = all.filter((r) => r["item_id"] === "item-1" && "notify_when_available" in r);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.["notify_when_available"]).toBe(false);
  });

  it("does not recreate a row deleted between the Scan and the write", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const dk = donationKey(GARAGE_ID, "2026-03-02", "don-gone");
    seedItem({ PK: dk.pk, SK: dk.sk, id: "don-gone", donor_phone: FAMILY_PHONE });
    afterWholeTableScan(() => {
      resetOne(dk.pk, dk.sk);
    });

    await runCleanup(new Date("2026-04-26T03:00:00Z"));

    expect(listAll().find((r) => r["id"] === "don-gone")).toBeUndefined();
  });

  it("scrubs whole numbers only, not a prefix of a longer one", () => {
    expect(scrubPhone(["+15555550100", "+155555501009"], "+15555550100", "X")).toEqual([
      "X",
      "+155555501009",
    ]);
  });

  it("uses a pseudonym that cannot be recomputed from the phone, one per user", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const pk = `TENANT#${GARAGE_ID}`;
    seedItem({ PK: pk, SK: "ITEM#donated-1", id: "donated-1", donated_by_phone: FAMILY_PHONE });
    seedItem({ PK: pk, SK: "DONATION#2026-03-02#d1", id: "d1", donor_phone: FAMILY_PHONE });

    await runCleanup(new Date("2026-04-26T03:00:00Z"));

    const all = listAll();
    const a = all.find((r) => r.SK === "ITEM#donated-1")?.["donated_by_phone"];
    const b = all.find((r) => r.SK === "DONATION#2026-03-02#d1")?.["donor_phone"];
    expect(a).toMatch(PSEUDONYM);
    expect(b).toBe(a);
    const unkeyed = createHash("sha256").update(FAMILY_PHONE).digest("hex").slice(0, 12);
    expect(a).not.toBe(`deleted-user-${unkeyed}`);
    // The work row that held the phone is gone once the scrub completed.
    expect(await getPendingScrub(FAMILY_PHONE)).toBeUndefined();
  });

  it("resumes an interrupted hard delete on the next run", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const dk = donationKey(GARAGE_ID, "2026-03-02", "don-1");
    seedItem({ PK: dk.pk, SK: dk.sk, id: "don-1", donor_phone: FAMILY_PHONE });
    // The whole-table scrub Scan fails (throttling, timeout) after the user
    // rows were already deleted.
    afterWholeTableScan(() => {
      const err = new Error("Rate exceeded");
      err.name = "ProvisionedThroughputExceededException";
      throw err;
    });

    const first = await runCleanup(new Date("2026-04-26T03:00:00Z"));
    expect(first.hard_deleted_users).toBe(0);
    const userKey = tenantUserKey(GARAGE_ID, FAMILY_PHONE);
    expect(listAll().find((r) => r.PK === userKey.pk && r.SK === userKey.sk)).toBeUndefined();
    expect(cognitoDeletes).toEqual([]);
    const pending = await getPendingScrub(FAMILY_PHONE);
    expect(pending?.pseudonym).toMatch(PSEUDONYM);

    const second = await runCleanup(new Date("2026-04-27T03:00:00Z"));
    expect(second.hard_deleted_users).toBe(1);
    const all = listAll();
    expect(JSON.stringify(all)).not.toContain(FAMILY_PHONE.slice(1));
    expect(all.find((r) => r["id"] === "don-1")?.["donor_phone"]).toBe(pending?.pseudonym);
    expect(cognitoDeletes).toEqual([FAMILY_PHONE]);
    expect(await getPendingScrub(FAMILY_PHONE)).toBeUndefined();
  });

  it("scrubs the percent-encoded phone an audit entry kept in its request path", async () => {
    seedGarage();
    seedUser(FAMILY_PHONE, { deleted_at: "2026-03-01T12:00:00Z" });
    seedMembership(FAMILY_PHONE, "family");
    const pk = `TENANT#${GARAGE_ID}`;
    const encoded = encodeURIComponent(FAMILY_PHONE);
    seedItem({
      PK: pk,
      SK: "AUDIT#2026-03-02#a2",
      id: "a2",
      actor_phone: OWNER_PHONE,
      entity_id: FAMILY_PHONE,
      path: `/v1/g/${GARAGE_ID}/admin/members/${encoded}`,
    });
    // Only the encoded form: still found and scrubbed.
    seedItem({
      PK: pk,
      SK: "AUDIT#2026-03-02#a3",
      id: "a3",
      actor_phone: OWNER_PHONE,
      entity_id: GARAGE_ID,
      path: `/v1/g/${GARAGE_ID}/admin/invites/${encoded.toLowerCase()}`,
    });

    await runCleanup(new Date("2026-04-26T03:00:00Z"));

    const all = listAll();
    expect(JSON.stringify(all)).not.toContain(FAMILY_PHONE.slice(1));
    expect(all.find((r) => r["id"] === "a2")?.["path"]).toMatch(
      /\/admin\/members\/deleted-user-[0-9a-f]{12}$/,
    );
  });

  it("recognises the encoded phone but not a longer number", () => {
    expect(mentionsPhone({ path: "/m/%2B15555550100" }, "+15555550100")).toBe(true);
    expect(mentionsPhone({ path: "/m/%2B155555501009" }, "+15555550100")).toBe(false);
  });
});
