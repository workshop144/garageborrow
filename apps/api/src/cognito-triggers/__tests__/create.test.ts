import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import type { CreateAuthChallengeTriggerEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installDdbMock, resetDdbStore, seedItem } from "../../__tests__/_setup.js";
import { logger } from "../../lib/logger.js";
import { handler, SMS_PER_PHONE_PER_DAY } from "../create-auth-challenge.js";

const sns = mockClient(SNSClient);

beforeEach(() => {
  // The SMS caps count sends in the table.
  resetDdbStore();
  installDdbMock();
  sns.reset();
  sns.on(PublishCommand).resolves({ MessageId: "mid-1" });
});

afterEach(() => {
  sns.reset();
  vi.restoreAllMocks();
});

function makeEvent(phone = "+15555550123"): CreateAuthChallengeTriggerEvent {
  return {
    version: "1",
    region: "us-east-2",
    userPoolId: "us-east-2_TEST",
    triggerSource: "CreateAuthChallenge_Authentication",
    userName: phone,
    callerContext: { awsSdkVersion: "1", clientId: "test" },
    request: {
      userAttributes: { phone_number: phone },
      challengeName: "CUSTOM_CHALLENGE",
      session: [],
    },
    response: {
      publicChallengeParameters: {},
      privateChallengeParameters: {},
      challengeMetadata: "",
    },
  };
}

function seedProfile(phone: string, extra: Record<string, unknown> = {}): void {
  seedItem({
    PK: "TENANT#g1",
    SK: `USER#${phone}`,
    GSI1PK: `USER#${phone}`,
    GSI1SK: "USER#g1",
    phone,
    ...extra,
  });
}

async function invoke(
  event: CreateAuthChallengeTriggerEvent,
): Promise<CreateAuthChallengeTriggerEvent> {
  const result = await handler(event, {} as never, () => undefined);
  return result as CreateAuthChallengeTriggerEvent;
}

describe("create-auth-challenge", () => {
  it("generates a 6-digit code, calls SNS Publish, and returns last-4 hint", async () => {
    const result = await invoke(makeEvent("+15555550199"));

    const code = result.response.privateChallengeParameters["code"];
    expect(code).toMatch(/^\d{6}$/);

    expect(result.response.publicChallengeParameters["phone_hint"]).toBe("0199");
    expect(result.response.privateChallengeParameters["expires_at"]).toBeDefined();

    const calls = sns.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input.PhoneNumber).toBe("+15555550199");
    expect(calls[0]?.args[0].input.Message).toContain(code as string);
    expect(calls[0]?.args[0].input.Message).toContain("Garage Borrow");
  });

  it("sets expires_at roughly 5 minutes in the future", async () => {
    const before = Date.now();
    const result = await invoke(makeEvent());
    const after = Date.now();

    const expires = Date.parse(result.response.privateChallengeParameters["expires_at"] as string);
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);
  });

  it("reuses the first code on a retry in the same sign-in (one SMS, not one per guess)", async () => {
    const first = await invoke(makeEvent());
    const code = first.response.privateChallengeParameters["code"] as string;

    const retry = makeEvent();
    retry.request.session = [
      {
        challengeName: "CUSTOM_CHALLENGE",
        challengeResult: false,
        challengeMetadata: first.response.challengeMetadata,
      },
    ];
    const second = await invoke(retry);

    expect(second.response.privateChallengeParameters["code"]).toBe(code);
    expect(second.response.privateChallengeParameters["expires_at"]).toBe(
      first.response.privateChallengeParameters["expires_at"],
    );
    expect(sns.commandCalls(PublishCommand)).toHaveLength(1);
  });

  it("sends a fresh code once the previous one has expired", async () => {
    const retry = makeEvent();
    retry.request.session = [
      {
        challengeName: "CUSTOM_CHALLENGE",
        challengeResult: false,
        challengeMetadata: `OTP_SMS|123456|${new Date(Date.now() - 1000).toISOString()}`,
      },
    ];
    const result = await invoke(retry);
    expect(sns.commandCalls(PublishCommand)).toHaveLength(1);
    expect(result.response.challengeMetadata.startsWith("OTP_SMS|")).toBe(true);
  });

  it("ignores malformed session metadata and sends a new code", async () => {
    const retry = makeEvent();
    retry.request.session = [
      { challengeName: "CUSTOM_CHALLENGE", challengeResult: false, challengeMetadata: "OTP_SMS" },
    ];
    await invoke(retry);
    expect(sns.commandCalls(PublishCommand)).toHaveLength(1);
  });

  it("texts no unknown number and leaves no valid answer", async () => {
    const e = makeEvent();
    e.request.userAttributes = {};
    e.request.userNotFound = true;
    const result = await invoke(e);
    expect(sns.commandCalls(PublishCommand)).toHaveLength(0);
    expect(result.response.privateChallengeParameters["code"]).toBeUndefined();
    expect(result.response.publicChallengeParameters["phone_hint"]).toBe("0123");
  });

  it("stops texting a phone after 5 codes in an hour; the unsent code is unusable", async () => {
    let last: CreateAuthChallengeTriggerEvent | undefined;
    for (let i = 0; i < 6; i++) last = await invoke(makeEvent());
    expect(sns.commandCalls(PublishCommand)).toHaveLength(5);
    expect(last?.response.privateChallengeParameters["code"]).toBe("");
  });

  it("still texts a member's first codes of the day after the shared daily budget is spent", async () => {
    const day = new Date().toISOString().slice(0, 10);
    seedItem({ PK: "RATELIMIT#sms-total", SK: `all#${day}`, count: 1_000_000 });
    seedProfile("+15555550177");
    const result = await invoke(makeEvent("+15555550177"));
    expect(sns.commandCalls(PublishCommand)).toHaveLength(1);
    expect(result.response.privateChallengeParameters["code"]).toMatch(/^\d{6}$/);
  });

  it("gives no reserve past the shared cap to a Cognito user who is not a member", async () => {
    // e.g. left over from a revoked or expired invite, or a deleted member
    const day = new Date().toISOString().slice(0, 10);
    seedItem({ PK: "RATELIMIT#sms-total", SK: `all#${day}`, count: 1_000_000 });
    seedProfile("+15555550178", { deleted_at: "2026-01-01T00:00:00Z" });
    const stale = await invoke(makeEvent("+15555550179"));
    const deleted = await invoke(makeEvent("+15555550178"));
    expect(sns.commandCalls(PublishCommand)).toHaveLength(0);
    expect(stale.response.privateChallengeParameters["code"]).toBe("");
    expect(deleted.response.privateChallengeParameters["code"]).toBe("");
  });

  it("caps each phone per day, so cycling a few numbers cannot drain the shared budget", async () => {
    const day = new Date().toISOString().slice(0, 10);
    seedItem({
      PK: "RATELIMIT#sms-phone-day",
      SK: `+15555550188#${day}`,
      count: SMS_PER_PHONE_PER_DAY,
    });
    const result = await invoke(makeEvent("+15555550188"));
    expect(sns.commandCalls(PublishCommand)).toHaveLength(0);
    expect(result.response.privateChallengeParameters["code"]).toBe("");
  });

  // GB-R1-3 (accepted risk, STATE.md): an outsider can spend a member's
  // per-phone budget by calling InitiateAuth. Each refusal is logged with the
  // last 4 digits, and the first refusal of the day once as a lockout event,
  // so the operator can see it happening (saved query "sms-capped").
  describe("lockout visibility", () => {
    const PHONE = "+15555550166";
    function seedDayCount(count: number): void {
      const day = new Date().toISOString().slice(0, 10);
      seedItem({ PK: "RATELIMIT#sms-phone-day", SK: `${PHONE}#${day}`, count });
    }
    function logged(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
      return spy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    }

    it("logs the first refusal of the day once as sms_phone_day_lockout", async () => {
      seedDayCount(SMS_PER_PHONE_PER_DAY);
      const warn = vi.spyOn(logger, "warn");
      const error = vi.spyOn(logger, "error");
      await invoke(makeEvent(PHONE));
      await invoke(makeEvent(PHONE));
      expect(sns.commandCalls(PublishCommand)).toHaveLength(0);
      const lockouts = logged(error).filter((o) => o["event"] === "sms_phone_day_lockout");
      expect(lockouts).toHaveLength(1);
      expect(lockouts[0]).toMatchObject({ phone_last4: "0166" });
      const capped = logged(warn).filter((o) => o["event"] === "sms_capped");
      expect(capped).toEqual([
        expect.objectContaining({ scope: "phone-day", phone_last4: "0166", count: 11 }),
        expect.objectContaining({ scope: "phone-day", phone_last4: "0166", count: 12 }),
      ]);
    });

    it("never logs the full number", async () => {
      const warn = vi.spyOn(logger, "warn");
      const error = vi.spyOn(logger, "error");
      for (let i = 0; i < 6; i++) await invoke(makeEvent(PHONE));
      seedDayCount(SMS_PER_PHONE_PER_DAY + 5);
      await invoke(makeEvent(PHONE));
      const all = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(all).toContain("sms_capped");
      expect(all).not.toContain("5555550166");
    });

    it("logs the hourly refusal with the phone scope", async () => {
      const warn = vi.spyOn(logger, "warn");
      for (let i = 0; i < 6; i++) await invoke(makeEvent(PHONE));
      expect(logged(warn)).toContainEqual(
        expect.objectContaining({ event: "sms_capped", scope: "phone", phone_last4: "0166" }),
      );
    });
  });
});
