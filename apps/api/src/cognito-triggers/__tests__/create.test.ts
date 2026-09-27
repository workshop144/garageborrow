import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import type { CreateAuthChallengeTriggerEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handler } from "../create-auth-challenge.js";

const sns = mockClient(SNSClient);

beforeEach(() => {
  sns.reset();
  sns.on(PublishCommand).resolves({ MessageId: "mid-1" });
});

afterEach(() => {
  sns.reset();
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
});
