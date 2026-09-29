// Cognito VerifyAuthChallengeResponse trigger.
//
// Compares the user-submitted OTP against the code stashed in
// privateChallengeParameters by CreateAuthChallenge, honoring the 5-minute
// expiry.

import { timingSafeEqual } from "node:crypto";

import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";

const OTP_FORMAT = /^\d{6}$/;

// Constant-time for equal-length inputs; anything not shaped like a code is
// wrong without comparing.
function codesMatch(submitted: unknown, expected: string): boolean {
  if (typeof submitted !== "string" || !OTP_FORMAT.test(submitted)) return false;
  if (!OTP_FORMAT.test(expected)) return false;
  return timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
}

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const params = event.request.privateChallengeParameters ?? {};
  const expected = params["code"];
  const expiresAt = params["expires_at"];
  const submitted = event.request.challengeAnswer;

  if (!expected || !expiresAt) {
    event.response.answerCorrect = false;
    return event;
  }

  if (Date.now() > Date.parse(expiresAt)) {
    event.response.answerCorrect = false;
    return event;
  }

  event.response.answerCorrect = codesMatch(submitted, expected);
  return event;
};
