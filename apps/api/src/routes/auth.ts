import { Hono } from "hono";
import { PhoneE164 } from "@garageborrow/shared";
import { z } from "zod";

import { triggerOtpResend } from "../lib/cognito.js";
import { ApiError } from "../lib/errors.js";
import { getRateLimit, putRateLimit } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";

export const authRoutes = new Hono<AppEnv>();

// ─────────────────────────── /v1/auth/resend-otp ───────────────
//
// Public route — no JWT required, since the user isn't authenticated until
// they submit the code. We rate-limit per phone (1/60s) in DDB before
// touching Cognito so accidental double-taps and bot retries don't burn
// SMS budget. On 429 we return retry_after_seconds so the client can show
// a real countdown rather than a generic "try again later".

const RESEND_BUCKET = "otp-resend";
const RESEND_TTL_SECONDS = 60;

const ResendBodySchema = z.object({
  phone: PhoneE164,
});

authRoutes.post("/v1/auth/resend-otp", async (c) => {
  const body = ResendBodySchema.parse(await c.req.json());
  const nowEpochSec = Math.floor(Date.now() / 1000);
  const limit = await getRateLimit(RESEND_BUCKET, body.phone, nowEpochSec);
  if (limit) {
    throw new ApiError("rate_limited", "OTP resend rate-limited", {
      retry_after_seconds: limit.retry_after_seconds,
    });
  }
  // Reserve the slot before triggering Cognito so concurrent requests can't
  // both win. If the trigger fails we leave the lock in place — the caller
  // can retry after the window expires; this protects SMS budget.
  await putRateLimit(RESEND_BUCKET, body.phone, RESEND_TTL_SECONDS, nowEpochSec);
  await triggerOtpResend(body.phone);
  return c.json({ status: "sent", retry_after_seconds: RESEND_TTL_SECONDS });
});
