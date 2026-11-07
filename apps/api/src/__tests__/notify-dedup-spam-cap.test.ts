// Notifier guards against the in-memory DynamoDB: the dedup slot (no double
// SMS on retry) and the per-day notification cap (no spamming a member).

import { tenantUserKey } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
  claimDispatch,
  markDispatched,
  payloadHash,
  releaseDispatch,
  shouldSkipDuplicate,
} from "../lib/notify-dedup.js";
import {
  BORROW_REQUEST_COUNTER,
  BORROW_REQUEST_NOTIFICATION_CAP,
  DAILY_COUNTER,
  DAILY_NOTIFICATION_CAP,
  releaseSlot,
  reserveSlot,
} from "../lib/spam-cap.js";
import { GARAGE_ID, FRIEND_PHONE, seedUser } from "./_fixtures.js";
import { installDdbMock, listAll, resetDdbStore } from "./_setup.js";

const NOW = 1_800_000_000;

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
});

function userRow(): Record<string, unknown> | undefined {
  const k = tenantUserKey(GARAGE_ID, FRIEND_PHONE);
  return listAll().find((r) => r.PK === k.pk && r.SK === k.sk);
}

describe("payloadHash", () => {
  it("is stable across key order and differs for different payloads", () => {
    expect(payloadHash({ a: 1, b: "x" })).toBe(payloadHash({ b: "x", a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
    expect(payloadHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("dispatch dedup slot", () => {
  const payload = { loan_id: "loan-1" };

  it("lets exactly one claim win within the window", async () => {
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW)).toBe(true);
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW + 10)).toBe(false);
  });

  it("does not collide across types, payloads or users", async () => {
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW)).toBe(true);
    expect(await claimDispatch(FRIEND_PHONE, "overdue", payload, NOW)).toBe(true);
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", { loan_id: "loan-2" }, NOW)).toBe(true);
    expect(await claimDispatch("+15555550999", "due_soon", payload, NOW)).toBe(true);
  });

  it("can be claimed again once the hour has passed", async () => {
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW)).toBe(true);
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW + 3600)).toBe(true);
  });

  it("can be claimed again after a release (nothing went out)", async () => {
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW)).toBe(true);
    await releaseDispatch(FRIEND_PHONE, "due_soon", payload);
    expect(await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW + 1)).toBe(true);
  });

  it("writes a marker with a TTL and no phone outside the user partition", async () => {
    await claimDispatch(FRIEND_PHONE, "due_soon", payload, NOW);
    const rows = listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ PK: `USER#${FRIEND_PHONE}`, expires_at: NOW + 3600 });
    expect(rows[0]?.SK).toMatch(/^DEDUP#due_soon#[0-9a-f]{16}$/);
  });

  it("shouldSkipDuplicate reflects markDispatched until expiry", async () => {
    expect(await shouldSkipDuplicate(FRIEND_PHONE, "t", payload, NOW)).toBe(false);
    await markDispatched(FRIEND_PHONE, "t", payload, NOW);
    expect(await shouldSkipDuplicate(FRIEND_PHONE, "t", payload, NOW + 1)).toBe(true);
    expect(await shouldSkipDuplicate(FRIEND_PHONE, "t", payload, NOW + 3600)).toBe(false);
  });
});

describe("daily notification cap", () => {
  it("allows up to the cap, then refuses", async () => {
    seedUser(FRIEND_PHONE);
    const results = [];
    for (let i = 0; i < DAILY_NOTIFICATION_CAP + 1; i++) {
      results.push(await reserveSlot(GARAGE_ID, FRIEND_PHONE, "due_soon"));
    }
    expect(results.slice(0, DAILY_NOTIFICATION_CAP).every((r) => r.allowed)).toBe(true);
    expect(results.at(-1)).toEqual({
      allowed: false,
      count_after: DAILY_NOTIFICATION_CAP + 1,
    });
    expect(userRow()?.[DAILY_COUNTER]).toBe(DAILY_NOTIFICATION_CAP + 1);
  });

  it("counts borrow-request pings in their own, larger bucket", async () => {
    seedUser(FRIEND_PHONE);
    for (let i = 0; i < DAILY_NOTIFICATION_CAP; i++) {
      await reserveSlot(GARAGE_ID, FRIEND_PHONE, "due_soon");
    }
    const r = await reserveSlot(GARAGE_ID, FRIEND_PHONE, "borrow_request_pending");
    expect(r).toEqual({ allowed: true, count_after: 1 });
    expect(userRow()?.[BORROW_REQUEST_COUNTER]).toBe(1);
    expect(BORROW_REQUEST_NOTIFICATION_CAP).toBeGreaterThan(DAILY_NOTIFICATION_CAP);
  });

  it("releaseSlot gives the slot back to the right bucket", async () => {
    seedUser(FRIEND_PHONE);
    await reserveSlot(GARAGE_ID, FRIEND_PHONE, "due_soon");
    await reserveSlot(GARAGE_ID, FRIEND_PHONE, "borrow_request_pending");
    await releaseSlot(GARAGE_ID, FRIEND_PHONE, "due_soon");
    expect(userRow()?.[DAILY_COUNTER]).toBe(0);
    expect(userRow()?.[BORROW_REQUEST_COUNTER]).toBe(1);
  });

  it("reports a missing user as gone and does not create a row", async () => {
    const r = await reserveSlot(GARAGE_ID, FRIEND_PHONE);
    expect(r).toEqual({ allowed: false, count_after: 0, gone: true });
    expect(listAll()).toHaveLength(0);
  });

  it("reports a soft-deleted user as gone without bumping the counter", async () => {
    seedUser(FRIEND_PHONE, { deleted_at: "2026-04-02T00:00:00Z" });
    const r = await reserveSlot(GARAGE_ID, FRIEND_PHONE);
    expect(r.gone).toBe(true);
    expect(userRow()?.[DAILY_COUNTER]).toBeUndefined();
  });

  it("releaseSlot on a deleted row is a quiet no-op (does not recreate it)", async () => {
    await expect(releaseSlot(GARAGE_ID, FRIEND_PHONE)).resolves.toBeUndefined();
    expect(listAll()).toHaveLength(0);
  });
});
