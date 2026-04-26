import type { DefineAuthChallengeTriggerEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { handler } from "../define-auth-challenge.js";

function makeEvent(
  session: DefineAuthChallengeTriggerEvent["request"]["session"],
): DefineAuthChallengeTriggerEvent {
  return {
    version: "1",
    region: "us-east-2",
    userPoolId: "us-east-2_TEST",
    triggerSource: "DefineAuthChallenge_Authentication",
    userName: "test",
    callerContext: { awsSdkVersion: "1", clientId: "test" },
    request: {
      userAttributes: { phone_number: "+15555550100" },
      session,
    },
    response: {
      challengeName: undefined,
      failAuthentication: false,
      issueTokens: false,
    },
  };
}

async function invoke(
  event: DefineAuthChallengeTriggerEvent,
): Promise<DefineAuthChallengeTriggerEvent> {
  const result = await handler(event, {} as never, () => undefined);
  return result as DefineAuthChallengeTriggerEvent;
}

describe("define-auth-challenge", () => {
  it("issues a CUSTOM_CHALLENGE on the first call", async () => {
    const result = await invoke(makeEvent([]));
    expect(result.response.challengeName).toBe("CUSTOM_CHALLENGE");
    expect(result.response.failAuthentication).toBe(false);
    expect(result.response.issueTokens).toBe(false);
  });

  it("issues tokens after a correct challenge response", async () => {
    const result = await invoke(
      makeEvent([{ challengeName: "CUSTOM_CHALLENGE", challengeResult: true }]),
    );
    expect(result.response.issueTokens).toBe(true);
    expect(result.response.failAuthentication).toBe(false);
  });

  it("fails authentication after 3 wrong codes", async () => {
    const result = await invoke(
      makeEvent([
        { challengeName: "CUSTOM_CHALLENGE", challengeResult: false },
        { challengeName: "CUSTOM_CHALLENGE", challengeResult: false },
        { challengeName: "CUSTOM_CHALLENGE", challengeResult: false },
      ]),
    );
    expect(result.response.failAuthentication).toBe(true);
    expect(result.response.issueTokens).toBe(false);
  });
});
