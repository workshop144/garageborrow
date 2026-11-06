import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCronSweep } from "../notifier.js";
import { setSmsDriver } from "../lib/channels.js";
import {
  FAMILY_PHONE,
  FRIEND_PHONE,
  GARAGE_ID,
  seedGarage,
  seedLoanRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import { failNextPut, installDdbMock, resetDdbStore } from "./_setup.js";

const NOW = new Date("2026-04-26T13:00:00Z");

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  seedGarage();
  for (const phone of [FAMILY_PHONE, FRIEND_PHONE]) {
    seedUser(phone);
    seedMembership(phone, "family");
    seedLoanRecord({
      id: `loan-${phone}`,
      item_id: "item-1",
      borrower_phone: phone,
      borrowed_at: "2026-04-23T12:00:00Z",
      expected_return_at: "2026-04-26T18:00:00Z",
      status: "active",
    });
  }
});

afterEach(() => setSmsDriver(undefined));

describe("notifier cron isolation", () => {
  it("one failed send does not stop the rest; a rerun retries it without repeating the others", async () => {
    const to: string[] = [];
    setSmsDriver(
      vi.fn((phone: string) => {
        to.push(phone);
        return Promise.resolve();
      }),
    );
    // The first member's inbox write is throttled, before any SMS goes out.
    failNextPut((it) => it.PK === `USER#${FAMILY_PHONE}` && it.SK.startsWith("NOTIF"));

    const first = await runCronSweep({ now: NOW, garage_ids: [GARAGE_ID] });
    expect(first.failures).toBe(1);
    expect(to).toEqual([FRIEND_PHONE]);

    // EventBridge-style retry of the whole sweep.
    await runCronSweep({ now: NOW, garage_ids: [GARAGE_ID] });
    expect(to.sort()).toEqual([FAMILY_PHONE, FRIEND_PHONE].sort());
  });
});
