import { beforeEach, describe, expect, it } from "vitest";
import {
  donationKey,
  loanKey,
  reservationKey,
  tenantUserKey,
  waitlistKey,
} from "@garageborrow/shared";

import { pseudonymFor, runCleanup, setCognitoClient } from "../account-cleaner.js";
import { FAMILY_PHONE, GARAGE_ID, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import { installDdbMock, listAll, resetDdbStore, seedItem } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  // Cognito calls fail closed in tests — silence them by injecting a stub.
  setCognitoClient({
    send: () => Promise.resolve({}),
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

    const replacement = pseudonymFor(FAMILY_PHONE);
    const all = listAll();
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
});
