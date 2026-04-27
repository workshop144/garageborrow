// Lambda Sentry wiring. Each Lambda entrypoint calls `initSentry()` once at
// module load. If SENTRY_DSN is unset (e.g., a fresh deploy that hasn't been
// configured), init is a no-op and a single warning lands in the log; the
// rest of `captureError` becomes a no-op too.

import * as Sentry from "@sentry/aws-serverless";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN unset — error tracking disabled");
    initialized = true;
    return;
  }
  const release = process.env.SENTRY_RELEASE;
  Sentry.init({
    dsn,
    environment: process.env.STAGE ?? "dev",
    ...(release ? { release } : {}),
    tracesSampleRate: 0,
  });
  initialized = true;
}

export function captureError(err: unknown, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  if (!process.env.SENTRY_DSN) return;
  if (extra) {
    Sentry.captureException(err, { extra });
  } else {
    Sentry.captureException(err);
  }
}
