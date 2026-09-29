// Cognito CreateAuthChallenge trigger.
//
// Generates a 6-digit OTP, sends it via SNS to the user's phone, and stashes
// the code in privateChallengeParameters so VerifyAuthChallenge can compare
// without exposing it to the client.

import type {
  CreateAuthChallengeTriggerEvent,
  CreateAuthChallengeTriggerHandler,
} from "aws-lambda";

import { logger } from "../lib/logger.js";
import { generateOtp } from "../lib/otp.js";
import { bumpWindowCounter, listUserProfiles } from "../lib/repo.js";
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

// Hard caps on operator-paid texts. Cognito's InitiateAuth is a public API, so
// /v1/auth/start's limits can be skipped by calling Cognito directly; these can't.
//
// Budgets are per phone first. The shared daily cap bounds total spend, but a
// phone's first SMS_RESERVED_PER_PHONE_PER_DAY texts do not depend on it: one
// caller cycling a few known numbers can spend the shared budget, and that must
// not lock every member out of sign-in for the day. The reserve is only for
// current members (a live garage profile), so it is bounded by the member
// count: a Cognito user left over from a revoked or expired invite gets no
// texts beyond the shared cap.
export const SMS_PER_PHONE_PER_HOUR = 5;
export const SMS_PER_PHONE_PER_DAY = 10;
export const SMS_RESERVED_PER_PHONE_PER_DAY = 2;
const SMS_DAILY_CAP = Number(process.env["SMS_DAILY_CAP"] || "200");

async function smsAllowed(phone: string): Promise<boolean> {
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const expires = Math.floor(now.getTime() / 1000) + 2 * 86400;
  const perPhone = await bumpWindowCounter("sms-phone", phone, hour, expires);
  if (perPhone > SMS_PER_PHONE_PER_HOUR) {
    logger.warn({ event: "sms_capped", scope: "phone" }, "per-phone SMS cap reached");
    return false;
  }
  const perPhoneDay = await bumpWindowCounter("sms-phone-day", phone, day, expires);
  if (perPhoneDay > SMS_PER_PHONE_PER_DAY) {
    logger.warn({ event: "sms_capped", scope: "phone-day" }, "per-phone daily SMS cap reached");
    return false;
  }
  const total = await bumpWindowCounter("sms-total", "all", day, expires);
  if (total > SMS_DAILY_CAP) {
    if (perPhoneDay > SMS_RESERVED_PER_PHONE_PER_DAY || !(await isCurrentMember(phone))) {
      logger.warn({ event: "sms_capped", scope: "daily" }, "daily SMS cap reached");
      return false;
    }
  }
  return true;
}

async function isCurrentMember(phone: string): Promise<boolean> {
  try {
    const profiles = await listUserProfiles(phone);
    return profiles.some((p) => !p.deleted_at);
  } catch (err) {
    // Fail closed: over the shared cap, an unverifiable phone gets no text.
    logger.warn({ err }, "sms_member_lookup_failed");
    return false;
  }
}

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const phone = event.request.userAttributes["phone_number"];
  if (event.request.userNotFound || !phone) {
    // Unknown number: same challenge shape, no SMS, no valid answer.
    event.response.publicChallengeParameters = { phone_hint: (event.userName ?? "").slice(-4) };
    event.response.privateChallengeParameters = {};
    event.response.challengeMetadata = "NO_USER";
    return event;
  }

  let otp = previousCode(event.request.session);
  if (!otp) {
    otp = { code: generateOtp(), expiresAt: new Date(Date.now() + EXPIRY_MS).toISOString() };
    if (await smsAllowed(phone)) {
      await sendSms(phone, `Your ${TENANT_NAME} code: ${otp.code}. Expires in 5 minutes.`);
    } else {
      // Capped: no text goes out, and the unsent code must not be usable.
      otp = { code: "", expiresAt: otp.expiresAt };
    }
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
