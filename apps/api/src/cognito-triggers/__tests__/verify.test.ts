import type { VerifyAuthChallengeResponseTriggerEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { handler } from "../verify-auth-challenge.js";

function makeEvent(opts: {
  code: string;
  expiresAt: string;
  answer: string;
}): VerifyAuthChallengeResponseTriggerEvent {
  return {
    version: "1",
    region: "us-east-2",
    userPoolId: "us-east-2_TEST",
    triggerSource: "VerifyAuthChallengeResponse_Authentication",
    userName: "test",
    callerContext: { awsSdkVersion: "1", clientId: "test" },
    request: {
      userAttributes: { phone_number: "+15555550100" },
      privateChallengeParameters: {
        code: opts.code,
        expires_at: opts.expiresAt,
      },
      challengeAnswer: opts.answer,
    },
    response: { answerCorrect: false },
  };
}

async function invoke(
  event: VerifyAuthChallengeResponseTriggerEvent,
): Promise<VerifyAuthChallengeResponseTriggerEvent> {
  const result = await handler(event, {} as never, () => undefined);
  return result as VerifyAuthChallengeResponseTriggerEvent;
}

describe("verify-auth-challenge", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 1_000).toISOString();

  it("returns answerCorrect=true when the code matches and is not expired", async () => {
    const result = await invoke(makeEvent({ code: "123456", expiresAt: future, answer: "123456" }));
    expect(result.response.answerCorrect).toBe(true);
  });

  it("returns answerCorrect=false when the code is wrong", async () => {
    const result = await invoke(makeEvent({ code: "123456", expiresAt: future, answer: "654321" }));
    expect(result.response.answerCorrect).toBe(false);
  });

  it("returns answerCorrect=false when the challenge is expired", async () => {
    const result = await invoke(makeEvent({ code: "123456", expiresAt: past, answer: "123456" }));
    expect(result.response.answerCorrect).toBe(false);
  });
});
