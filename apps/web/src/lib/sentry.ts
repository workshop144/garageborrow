// Browser Sentry wiring. The DSN is read at build time from VITE_SENTRY_DSN
// (Vite inlines `import.meta.env` references). When unset we skip init and
// log a single boot warning so deploys without Sentry don't fail loud.

import * as Sentry from "@sentry/browser";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.warn("[sentry] VITE_SENTRY_DSN unset — error tracking disabled");
    initialized = true;
    return;
  }
  const release = import.meta.env.VITE_RELEASE_SHA;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    ...(release ? { release } : {}),
    tracesSampleRate: 0,
  });
  initialized = true;
}

export function captureError(err: unknown, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  if (extra) {
    Sentry.captureException(err, { extra });
  } else {
    Sentry.captureException(err);
  }
}
