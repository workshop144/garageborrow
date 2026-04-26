import type { Context, MiddlewareHandler, Next } from "hono";
import type { AuditActionType, AuditEntityType, AuditLogEntry } from "@garageborrow/shared";

import { newId, nowIso, dateOf } from "../lib/ids.js";
import { logger } from "../lib/logger.js";
import { putAuditLogEntry } from "../lib/repo.js";
import type { AppEnv, AuditDetails } from "../lib/types.js";

// Handlers call this to record the precise before/after snapshot of the
// entity they touched. The audit middleware then writes a single AuditLogEntry
// after the response is sent. If a handler doesn't call this, the middleware
// records a generic entry with whatever it knows from the request.
export function setAuditDetails(
  c: Context<AppEnv>,
  details: {
    action_type: AuditActionType;
    entity_type: AuditEntityType;
    entity_id: string;
    before_snapshot?: unknown;
    after_snapshot?: unknown;
  },
): void {
  const full: AuditDetails = {
    action_type: details.action_type,
    entity_type: details.entity_type,
    entity_id: details.entity_id,
    before_snapshot: details.before_snapshot ?? null,
    after_snapshot: details.after_snapshot ?? null,
  };
  c.set("audit_details", full);
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Wraps every /admin/* mutation route. Captures method, path, and the user
// identity, runs the handler, then writes one AuditLogEntry to DDB if the
// response was 2xx. Failures are logged but never propagate — auditing is
// best-effort and must never block a user-visible mutation.
export function audit(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (!MUTATING_METHODS.has(method)) {
      await next();
      return;
    }
    // Snapshot the request body up-front since handlers may consume it.
    let requestBody: unknown = null;
    try {
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const cloned = c.req.raw.clone();
        const text = await cloned.text();
        requestBody = text ? JSON.parse(text) : null;
      }
    } catch {
      requestBody = null;
    }

    await next();

    if (c.res.status < 200 || c.res.status >= 300) return;
    const user = c.get("user");
    const garage = c.get("garage");
    if (!user || !garage) return;

    const details = c.get("audit_details");
    const ts = nowIso();
    const path = new URL(c.req.url).pathname;
    const httpMethod = method as "POST" | "PATCH" | "PUT" | "DELETE";
    const entry: AuditLogEntry = details
      ? {
          id: newId(),
          garage_id: garage.id,
          date: dateOf(ts),
          actor_phone: user.phone,
          action_type: details.action_type,
          entity_type: details.entity_type,
          entity_id: details.entity_id,
          before_snapshot: details.before_snapshot,
          after_snapshot: details.after_snapshot,
          http_method: httpMethod,
          path,
          created_at: ts,
        }
      : {
          id: newId(),
          garage_id: garage.id,
          date: dateOf(ts),
          actor_phone: user.phone,
          action_type: `${httpMethod.toLowerCase()}.${path.split("/").slice(-1)[0] ?? "unknown"}`,
          entity_type: "garage",
          entity_id: garage.id,
          before_snapshot: null,
          after_snapshot: requestBody,
          http_method: httpMethod,
          path,
          created_at: ts,
        };

    try {
      await putAuditLogEntry(entry);
    } catch (err) {
      logger.warn({ err, entry_id: entry.id }, "audit_persist_failed");
    }
  };
}
