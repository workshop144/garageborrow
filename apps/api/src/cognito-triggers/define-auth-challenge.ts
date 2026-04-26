// Cognito DefineAuthChallenge trigger.
//
// Orchestrates the CUSTOM_CHALLENGE sequence for phone-OTP-as-password sign-in:
//   - First call (empty session): issue a CUSTOM_CHALLENGE so CreateAuth runs.
//   - Last challenge succeeded: issue tokens.
//   - 3 wrong codes: fail authentication.
//   - Otherwise: issue another CUSTOM_CHALLENGE (user can retry).

import type { DefineAuthChallengeTriggerHandler } from "aws-lambda";

const MAX_ATTEMPTS = 3;

export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session ?? [];

  if (session.length === 0) {
    event.response.challengeName = "CUSTOM_CHALLENGE";
    event.response.failAuthentication = false;
    event.response.issueTokens = false;
    return event;
  }

  const last = session[session.length - 1];

  if (last && last.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult === true) {
    event.response.failAuthentication = false;
    event.response.issueTokens = true;
    return event;
  }

  if (session.length >= MAX_ATTEMPTS) {
    event.response.failAuthentication = true;
    event.response.issueTokens = false;
    return event;
  }

  event.response.challengeName = "CUSTOM_CHALLENGE";
  event.response.failAuthentication = false;
  event.response.issueTokens = false;
  return event;
};
