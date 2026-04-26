// Cognito VerifyAuthChallengeResponse trigger.
//
// Compares the user-submitted OTP against the code stashed in
// privateChallengeParameters by CreateAuthChallenge, honoring the 5-minute
// expiry.

import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";

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

  event.response.answerCorrect = submitted === expected;
  return event;
};
