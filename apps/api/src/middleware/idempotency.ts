import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Context, MiddlewareHandler, Next } from "hono";

import { ddb } from "../lib/ddb.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import type { AppEnv } from "../lib/types.js";

const TTL_SECONDS = 60 * 60 * 24; // 24h

interface StoredEntry {
  status: number;
  body: unknown;
}

function pkFor(phone: string, key: string): { PK: string; SK: string } {
  return { PK: `USER#${phone}`, SK: `IDEMPOTENCY#${key}` };
}

// On dup hits, replays the original status + body. Records are written *after*
// the inner handler runs successfully so transient errors don't poison the
// cache; failures fall through and let the client retry.
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
    const k = pkFor(phone, key);
    const existing = await ddb().send(new GetCommand({ TableName: env.tableName(), Key: k }));
    if (existing.Item) {
      const stored = existing.Item as { entry?: StoredEntry };
      if (stored.entry) {
        c.res = c.json(stored.entry.body, stored.entry.status as 200);
        return undefined;
      }
    }
    await next();
    if (c.res.status >= 200 && c.res.status < 300) {
      try {
        const cloned = c.res.clone();
        const body = await cloned.json().catch(() => null);
        const entry: StoredEntry = { status: c.res.status, body };
        await ddb().send(
          new PutCommand({
            TableName: env.tableName(),
            Item: {
              ...k,
              entry,
              expires_at: Math.floor(Date.now() / 1000) + TTL_SECONDS,
            },
          }),
        );
      } catch (err) {
        logger.warn({ err }, "idempotency_persist_failed");
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
