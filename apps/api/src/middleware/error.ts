import type { Context, ErrorHandler, MiddlewareHandler, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { ApiError, toEnvelope } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
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

function respondWithError(c: Context<AppEnv>, err: unknown): Response {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ err }, "api_error_5xx");
    return c.json(toEnvelope(err), err.status as ContentfulStatusCode);
  }
  if (err instanceof ZodError) {
    const apiErr = new ApiError("bad_request", "Validation failed", err.flatten());
    return c.json(toEnvelope(apiErr), 400);
  }
  logger.error({ err }, "unhandled_error");
  const fallback = new ApiError("internal_error", "Something broke.");
  return c.json(toEnvelope(fallback), 500);
}
