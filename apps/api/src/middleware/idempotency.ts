import { createHash } from "node:crypto";

import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Context, MiddlewareHandler, Next } from "hono";

import { ddb } from "../lib/ddb.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { isConditionFailure } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";

const TTL_SECONDS = 60 * 60 * 24; // 24h
// How long a claimed key blocks a duplicate while the first request runs. A
// marker left by a crashed invocation expires and the key can be retried.
const IN_PROGRESS_SECONDS = 60;

interface StoredEntry {
  status: number;
  body: unknown;
}

// Scoped to the caller, the method and the path, so a key reused on another
// endpoint never replays an unrelated response.
function pkFor(
  phone: string,
  method: string,
  path: string,
  key: string,
): { PK: string; SK: string } {
  const scope = createHash("sha256").update(`${method} ${path}`).digest("hex").slice(0, 16);
  return { PK: `USER#${phone}`, SK: `IDEMPOTENCY#${scope}#${key}` };
}

// Claims the key before the handler runs (a conditional write, so of two
// concurrent requests with the same key exactly one runs). The other gets the
// stored response once the first finishes, or 409 while it is still running.
// Only 2xx responses are stored; anything else releases the key for a retry.
export function idempotency(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const key = c.req.header("idempotency-key") ?? c.req.header("Idempotency-Key");
    if (!key) {
      await next();
      return undefined;
    }
    const user = c.get("user");
    const phone = user?.phone ?? "anon";
    c.set("idempotency_key", key);
    const k = pkFor(phone, c.req.method, c.req.path, key);
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      await ddb().send(
        new PutCommand({
          TableName: env.tableName(),
          Item: { ...k, state: "in_progress", expires_at: nowSec + IN_PROGRESS_SECONDS },
          ConditionExpression: "attribute_not_exists(PK) OR expires_at <= :now",
          ExpressionAttributeValues: { ":now": nowSec },
        }),
      );
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
      const existing = await ddb().send(
        new GetCommand({ TableName: env.tableName(), Key: k, ConsistentRead: true }),
      );
      const stored = existing.Item as { entry?: StoredEntry } | undefined;
      if (stored?.entry) {
        c.res = c.json(stored.entry.body, stored.entry.status as 200);
        return undefined;
      }
      throw new ApiError("conflict", "The same request is still being processed; try again");
    }

    let stored = false;
    try {
      await next();
      if (c.res.status >= 200 && c.res.status < 300) {
        try {
          const cloned = c.res.clone();
          const body = await cloned.json().catch(() => null);
          const entry: StoredEntry = { status: c.res.status, body };
          await ddb().send(
            new PutCommand({
              TableName: env.tableName(),
              Item: { ...k, entry, expires_at: Math.floor(Date.now() / 1000) + TTL_SECONDS },
            }),
          );
          stored = true;
        } catch (err) {
          logger.warn({ err }, "idempotency_persist_failed");
        }
      }
    } finally {
      if (!stored) {
        await ddb()
          .send(new DeleteCommand({ TableName: env.tableName(), Key: k }))
          .catch((err: unknown) => logger.warn({ err }, "idempotency_release_failed"));
      }
    }
    return undefined;
  };
}

export function requireIdempotencyKey(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const key = c.req.header("idempotency-key") ?? c.req.header("Idempotency-Key");
    if (!key) {
      throw new ApiError("bad_request", "Idempotency-Key header is required");
    }
    await next();
  };
}
