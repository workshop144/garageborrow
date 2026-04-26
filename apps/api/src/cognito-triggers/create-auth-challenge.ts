// Cognito CreateAuthChallenge trigger.
//
// Generates a 6-digit OTP, sends it via SNS to the user's phone, and stashes
// the code in privateChallengeParameters so VerifyAuthChallenge can compare
// without exposing it to the client.

import type { CreateAuthChallengeTriggerHandler } from "aws-lambda";

import { generateOtp } from "../lib/otp.js";
import { sendSms } from "../lib/sns.js";

const EXPIRY_MS = 5 * 60 * 1000;

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const phone = event.request.userAttributes["phone_number"];
  if (!phone) {
    throw new Error("phone_number missing from userAttributes");
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString();

  await sendSms(phone, `Your Demo Garage code: ${code}. Expires in 5 minutes.`);

  event.response.publicChallengeParameters = {
    phone_hint: phone.slice(-4),
  };
  event.response.privateChallengeParameters = {
    code,
    expires_at: expiresAt,
  };
  event.response.challengeMetadata = "OTP_SMS";
  return event;
};
