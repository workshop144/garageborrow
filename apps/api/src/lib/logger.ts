import { pino } from "pino";

import { env } from "./env.js";

// Redact phone numbers (E.164 strings starting with +) anywhere they appear
// in the structured log object. We list the most common keys explicitly and
// rely on pino's path matching for nested objects.
export const logger = pino({
  level: process.env["LOG_LEVEL"]?.toLowerCase() ?? "info",
  base: { service: "garageborrow-api", stage: env.stage() },
  redact: {
    paths: [
      "phone",
      "user_phone",
      "owner_phone",
      "borrower_phone",
      "donor_phone",
      "reporter_phone",
      "vouched_by_phone",
      "decided_by_phone",
      "donated_by_phone",
      "*.phone",
      "*.user_phone",
      "*.owner_phone",
      "*.borrower_phone",
      "*.donor_phone",
      "*.reporter_phone",
      "*.vouched_by_phone",
      "*.decided_by_phone",
      "*.donated_by_phone",
    ],
    censor: "[REDACTED]",
    remove: false,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
