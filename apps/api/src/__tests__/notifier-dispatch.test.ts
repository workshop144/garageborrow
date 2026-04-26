import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleDirectInvoke, dispatch } from "../notifier.js";
import { setPushDriver, setSmsDriver } from "../lib/channels.js";
import { FAMILY_PHONE, GARAGE_ID, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import { installDdbMock, listAll, resetDdbStore, seedItem } from "./_setup.js";
import type { Notification, PushSubscription } from "@garageborrow/shared";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  seedGarage();
  seedUser(FAMILY_PHONE, {
    notification_prefs: {
      sms_enabled: true,
      push_enabled: true,
      reminders: true,
      waitlist_updates: true,
      new_tools: true,
      promotion_celebrations: true,
      ai_ready_notify: false,
      // Pick a quiet window we can dodge by passing now=10:00 ET.
      quiet_hours_start: "21:00",
      quiet_hours_end: "08:00",
    },
  });
  seedMembership(FAMILY_PHONE, "family");
});

function seedPushSub(phone: string, endpoint = "https://fcm.example/abc"): PushSubscription {
  const sub: PushSubscription = {
    user_phone: phone,
    endpoint,
    keys: { p256dh: "p256", auth: "auth" },
    created_at: "2026-04-25T12:00:00Z",
  };
  seedItem({
    ...sub,
    PK: `USER#${phone}`,
    SK: `PUSH#${endpoint.slice(-8)}`,
  });
  return sub;
}

function findNotifications(): Notification[] {
  return listAll().filter(
    (it) => typeof it.SK === "string" && (it.SK as string).startsWith("NOTIFICATION#"),
  ) as unknown as Notification[];
}

describe("notifier direct invoke", () => {
  it("delivers via push + sms + writes inapp", async () => {
    seedPushSub(FAMILY_PHONE);
    const pushSpy = vi.fn(() => Promise.resolve());
    const smsSpy = vi.fn(() => Promise.resolve());
    setPushDriver(pushSpy);
    setSmsDriver(smsSpy);
    await handleDirectInvoke(
      {
        type: "donation_accepted",
        garage_id: GARAGE_ID,
        user_phone: FAMILY_PHONE,
        payload: { donation_id: "d1", resulting_item_id: "i1" },
      },
      new Date("2026-04-26T14:00:00Z"), // 10:00 ET — outside quiet
    );
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(findNotifications()).toHaveLength(1);
    setPushDriver(undefined);
    setSmsDriver(undefined);
  });

  it("respects sms-only preference", async () => {
    seedUser(FAMILY_PHONE, {
      notification_prefs: {
        sms_enabled: true,
        push_enabled: false,
        reminders: true,
        waitlist_updates: true,
        new_tools: true,
        promotion_celebrations: true,
        ai_ready_notify: false,
        quiet_hours_start: "21:00",
        quiet_hours_end: "08:00",
      },
    });
    const pushSpy = vi.fn(() => Promise.resolve());
    const smsSpy = vi.fn(() => Promise.resolve());
    setPushDriver(pushSpy);
    setSmsDriver(smsSpy);
    await handleDirectInvoke(
      {
        type: "loan_extended",
        garage_id: GARAGE_ID,
        user_phone: FAMILY_PHONE,
        payload: { loan_id: "l1" },
      },
      new Date("2026-04-26T14:00:00Z"),
    );
    expect(pushSpy).not.toHaveBeenCalled();
    expect(smsSpy).toHaveBeenCalledTimes(1);
    setPushDriver(undefined);
    setSmsDriver(undefined);
  });

  it("defers non-urgent notifications during quiet hours to inapp-only", async () => {
    const pushSpy = vi.fn(() => Promise.resolve());
    const smsSpy = vi.fn(() => Promise.resolve());
    setPushDriver(pushSpy);
    setSmsDriver(smsSpy);
    await handleDirectInvoke(
      {
        type: "loan_extended",
        garage_id: GARAGE_ID,
        user_phone: FAMILY_PHONE,
        payload: { loan_id: "l-quiet" },
      },
      new Date("2026-04-26T03:00:00Z"), // 23:00 ET — inside quiet
    );
    expect(pushSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
    const notes = findNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.deliver_after).toBeTypeOf("string");
    setPushDriver(undefined);
    setSmsDriver(undefined);
  });

  it("delivers urgent waitlist_unblocked even during quiet hours", async () => {
    seedPushSub(FAMILY_PHONE);
    const pushSpy = vi.fn(() => Promise.resolve());
    const smsSpy = vi.fn(() => Promise.resolve());
    setPushDriver(pushSpy);
    setSmsDriver(smsSpy);
    seedItem({
      PK: `TENANT#${GARAGE_ID}`,
      SK: `WAIT#item-1#2026-04-25T12:00:00Z#${FAMILY_PHONE}`,
      id: "w1",
      garage_id: GARAGE_ID,
      item_id: "item-1",
      borrower_phone: FAMILY_PHONE,
      joined_at: "2026-04-25T12:00:00Z",
      position: 1,
      notify_when_available: true,
    });
    await handleDirectInvoke(
      {
        type: "waitlist_unblocked",
        garage_id: GARAGE_ID,
        payload: { item_id: "item-1" },
      },
      new Date("2026-04-26T03:00:00Z"),
    );
    expect(pushSpy).toHaveBeenCalled();
    expect(smsSpy).toHaveBeenCalled();
    setPushDriver(undefined);
    setSmsDriver(undefined);
  });

  it("ignores invalid direct-invoke events without crashing", async () => {
    const pushSpy = vi.fn(() => Promise.resolve());
    setPushDriver(pushSpy);
    await expect(
      handleDirectInvoke(
        { type: "" as never, garage_id: "", payload: {} },
        new Date("2026-04-26T14:00:00Z"),
      ),
    ).resolves.toBeUndefined();
    expect(pushSpy).not.toHaveBeenCalled();
    setPushDriver(undefined);
  });
});

describe("dedup", () => {
  it("skips a second send within the dedup window", async () => {
    const pushSpy = vi.fn(() => Promise.resolve());
    const smsSpy = vi.fn(() => Promise.resolve());
    setPushDriver(pushSpy);
    setSmsDriver(smsSpy);
    const event = {
      type: "loan_extended" as const,
      garage_id: GARAGE_ID,
      user_phone: FAMILY_PHONE,
      payload: { loan_id: "loan-dedup", new_expected_return_at: "2026-04-30T12:00:00Z" },
    };
    const now = new Date("2026-04-26T14:00:00Z");
    await handleDirectInvoke(event, now);
    await handleDirectInvoke(event, new Date(now.getTime() + 30 * 60_000));
    expect(smsSpy).toHaveBeenCalledTimes(1);
    setPushDriver(undefined);
    setSmsDriver(undefined);
  });

  it("re-delivers after the dedup window expires", async () => {
    const smsSpy = vi.fn(() => Promise.resolve());
    setSmsDriver(smsSpy);
    const event = {
      type: "loan_extended" as const,
      garage_id: GARAGE_ID,
      user_phone: FAMILY_PHONE,
      payload: { loan_id: "loan-after" },
    };
    const t0 = new Date("2026-04-26T14:00:00Z");
    await handleDirectInvoke(event, t0);
    // 1h + 1s later — past the 3600s window.
    await handleDirectInvoke(event, new Date(t0.getTime() + 3601_000));
    expect(smsSpy).toHaveBeenCalledTimes(2);
    setSmsDriver(undefined);
  });
});

describe("spam cap", () => {
  it("drops external delivery after the daily ceiling", async () => {
    const smsSpy = vi.fn(() => Promise.resolve());
    setSmsDriver(smsSpy);
    const baseTs = new Date("2026-04-26T14:00:00Z");
    for (let i = 0; i < 6; i++) {
      await dispatch({
        user: {
          phone: FAMILY_PHONE,
          display_name: "F",
          visibility: "visible",
          garages_member_of: [GARAGE_ID],
          notification_prefs: {
            sms_enabled: true,
            push_enabled: false,
            reminders: true,
            waitlist_updates: true,
            new_tools: true,
            promotion_celebrations: true,
            ai_ready_notify: false,
            quiet_hours_start: "21:00",
            quiet_hours_end: "08:00",
          },
          created_at: "2026-04-01T00:00:00Z",
          last_seen_at: "2026-04-01T00:00:00Z",
        },
        garage_id: GARAGE_ID,
        prefs: {
          sms_enabled: true,
          push_enabled: false,
          reminders: true,
          waitlist_updates: true,
          new_tools: true,
          promotion_celebrations: true,
          ai_ready_notify: false,
          quiet_hours_start: "21:00",
          quiet_hours_end: "08:00",
        },
        type: "loan_extended",
        title: "t",
        body: "b",
        // Distinct payloads so dedup doesn't swallow them.
        payload: { i },
        urgent: false,
        now: new Date(baseTs.getTime() + i * 60_000),
      });
    }
    expect(smsSpy).toHaveBeenCalledTimes(5);
    setSmsDriver(undefined);
  });
});
