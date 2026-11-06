import type { Context, ErrorHandler, MiddlewareHandler, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, z } from "zod";

import { scrubPhones } from "@garageborrow/shared/scrub-phones";

import { ApiError, toEnvelope } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { captureError } from "../lib/sentry.js";
import type { AppEnv } from "../lib/types.js";

// Catches sync/async throws inside route handlers and returns the canonical
// `{ error: { code, message, details? } }` envelope. ZodError → 400 with
// flattened issue list. Anything else → 500 with a redacted message.
export function errorBoundary(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    try {
      await next();
    } catch (err) {
      respondWithError(c, err);
    }
  };
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  return respondWithError(c, err);
};

// Admin routes put a member's phone in the path (/admin/members/:phone), so
// the path goes to Sentry with phone numbers replaced (finding S5-2).
export function sentryExtra(c: Context<AppEnv>): { path: string; method: string } {
  return { path: scrubPhones(c.req.path), method: c.req.method };
}

function respondWithError(c: Context<AppEnv>, err: unknown): Response {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      logger.error({ err }, "api_error_5xx");
      captureError(err, sentryExtra(c));
    }
    return c.json(toEnvelope(err), err.status as ContentfulStatusCode);
  }
  if (err instanceof ZodError) {
    const apiErr = new ApiError("bad_request", "Validation failed", z.flattenError(err));
    return c.json(toEnvelope(apiErr), 400);
  }
  // c.req.json() on a truncated or non-JSON body: the client's mistake.
  if (err instanceof SyntaxError && /JSON/i.test(err.message)) {
    return c.json(toEnvelope(new ApiError("bad_request", "Invalid JSON body")), 400);
  }
  logger.error({ err }, "unhandled_error");
  captureError(err, sentryExtra(c));
  const fallback = new ApiError("internal_error", "Something broke.");
  return c.json(toEnvelope(fallback), 500);
}
