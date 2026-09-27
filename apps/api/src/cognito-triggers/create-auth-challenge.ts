// Cognito CreateAuthChallenge trigger.
//
// Generates a 6-digit OTP, sends it via SNS to the user's phone, and stashes
// the code in privateChallengeParameters so VerifyAuthChallenge can compare
// without exposing it to the client.

import type {
  CreateAuthChallengeTriggerEvent,
  CreateAuthChallengeTriggerHandler,
} from "aws-lambda";

import { generateOtp } from "../lib/otp.js";
import { sendSms } from "../lib/sns.js";

const EXPIRY_MS = 5 * 60 * 1000;
const TENANT_NAME = process.env["TENANT_NAME"] || "Garage Borrow";

// Retries within one sign-in reuse the first code instead of texting a new one:
// otherwise every wrong guess (up to MAX_ATTEMPTS in define-auth-challenge)
// costs another operator-paid SMS. challengeMetadata rides in the Cognito
// session that only the triggers see, never the client.
const METADATA_PREFIX = "OTP_SMS";

function previousCode(
  session: CreateAuthChallengeTriggerEvent["request"]["session"],
): { code: string; expiresAt: string } | undefined {
  const last = session?.[session.length - 1];
  const parts = last?.challengeMetadata?.split("|") ?? [];
  if (parts.length !== 3 || parts[0] !== METADATA_PREFIX) return undefined;
  const [, code, expiresAt] = parts as [string, string, string];
  if (!/^\d{6}$/.test(code) || !(Date.parse(expiresAt) > Date.now())) return undefined;
  return { code, expiresAt };
}

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const phone = event.request.userAttributes["phone_number"];
  if (!phone) {
    throw new Error("phone_number missing from userAttributes");
  }

  let otp = previousCode(event.request.session);
  if (!otp) {
    otp = { code: generateOtp(), expiresAt: new Date(Date.now() + EXPIRY_MS).toISOString() };
    await sendSms(phone, `Your ${TENANT_NAME} code: ${otp.code}. Expires in 5 minutes.`);
  }

  event.response.publicChallengeParameters = {
    phone_hint: phone.slice(-4),
  };
  event.response.privateChallengeParameters = {
    code: otp.code,
    expires_at: otp.expiresAt,
  };
  event.response.challengeMetadata = `${METADATA_PREFIX}|${otp.code}|${otp.expiresAt}`;
  return event;
};
