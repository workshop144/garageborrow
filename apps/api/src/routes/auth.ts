import { Hono } from "hono";
import type { Context } from "hono";
import { PhoneE164 } from "@garageborrow/shared";
import { z } from "zod";

import { ensureCognitoUser } from "../lib/cognito.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import {
  bumpWindowCounter,
  getRateLimit,
  listInvitesForPhone,
  listUserProfiles,
  putRateLimit,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";

export const authRoutes = new Hono<AppEnv>();

// ─────────────────────────── /v1/auth/start ────────────────────
//
// Public: the PWA calls this before (and on every resend of) the CUSTOM_AUTH
// SMS sign-in. Self-service SignUp is closed, so this is where a new number gets
// its Cognito account, and only when an owner invited it (or it already has a
// profile, e.g. the seeded owner). The response is the same whether or not the
// number is known, so it can't be used to probe who is a member; an unknown
// number simply never receives a code (the create-auth trigger sends none).
//
// Rate limits, before any Cognito call: one start per phone per 60 s, 5 per
// phone per hour, 20 per client IP per hour. The SMS itself is also capped in
// the create-auth trigger, since Cognito's InitiateAuth is callable directly.

const PHONE_COOLDOWN_BUCKET = "auth-start";
const PHONE_COOLDOWN_SECONDS = 60;
export const PHONE_HOURLY_MAX = 5;
export const IP_HOURLY_MAX = 20;

const StartBodySchema = z.object({ phone: PhoneE164 }).strict();

function clientIp(c: Context<AppEnv>): string {
  // API Gateway HTTP API (payload 2.0) puts the caller address in the request context.
  const env = (c as unknown as { env?: { requestContext?: { http?: { sourceIp?: string } } } }).env;
  return env?.requestContext?.http?.sourceIp ?? "unknown";
}

authRoutes.post("/v1/auth/start", async (c) => {
  const body = StartBodySchema.parse(await c.req.json());
  const now = Math.floor(Date.now() / 1000);
  const hour = new Date(now * 1000).toISOString().slice(0, 13);
  const expires = now + 2 * 3600;

  const ipCount = await bumpWindowCounter(
    "auth-start-ip",
    clientIp(c).replaceAll("#", "_"),
    hour,
    expires,
  );
  if (ipCount > IP_HOURLY_MAX) {
    throw new ApiError("rate_limited", "Too many sign-in attempts", {
      retry_after_seconds: 3600 - (now % 3600),
    });
  }
  const cooldown = await getRateLimit(PHONE_COOLDOWN_BUCKET, body.phone, now);
  if (cooldown) {
    throw new ApiError("rate_limited", "Sign-in code rate-limited", {
      retry_after_seconds: cooldown.retry_after_seconds,
    });
  }
  const phoneCount = await bumpWindowCounter("auth-start-phone", body.phone, hour, expires);
  if (phoneCount > PHONE_HOURLY_MAX) {
    throw new ApiError("rate_limited", "Too many sign-in attempts", {
      retry_after_seconds: 3600 - (now % 3600),
    });
  }
  await putRateLimit(PHONE_COOLDOWN_BUCKET, body.phone, PHONE_COOLDOWN_SECONDS, now);

  const profiles = await listUserProfiles(body.phone);
  const deleted = profiles.some((p) => p.deleted_at);
  const eligible =
    !deleted && (profiles.length > 0 || (await listInvitesForPhone(body.phone, now)).length > 0);
  if (eligible) {
    const created = await ensureCognitoUser(body.phone);
    if (created) logger.info({ event: "account_created" }, "cognito user created from invite");
  }
  return c.json({ status: "ok", retry_after_seconds: PHONE_COOLDOWN_SECONDS });
});
