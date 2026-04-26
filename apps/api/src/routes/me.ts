import { Hono } from "hono";
import { z } from "zod";
import { createHash } from "node:crypto";
import { NotificationPrefsSchema, UserVisibilitySchema } from "@garageborrow/shared";
import type { GarageMembership, User } from "@garageborrow/shared";

import { mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import {
  getMembership,
  getNotification,
  getUser,
  getUserAnyGarage,
  listNotifications,
  putNotification,
  putPushSubscription,
  putUser,
} from "../lib/repo.js";
import { sendDataExportEmail } from "../lib/ses.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { idempotency, requireIdempotencyKey } from "../middleware/idempotency.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth());

meRoutes.get("/v1/me", async (c) => {
  const user = mustUser(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const memberships: GarageMembership[] = [];
  for (const garageId of primary.garages_member_of) {
    const m = await getMembership(garageId, user.phone);
    if (m) memberships.push(m);
  }
  return c.json({ user: primary, memberships });
});

const PatchMeSchema = z
  .object({
    display_name: z.string().min(1).optional(),
    visibility: UserVisibilitySchema.optional(),
    notification_prefs: NotificationPrefsSchema.partial().optional(),
  })
  .strict();

meRoutes.patch("/v1/me", async (c) => {
  const user = mustUser(c);
  const body = PatchMeSchema.parse(await c.req.json());
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const prefs = { ...primary.notification_prefs };
  if (body.notification_prefs) {
    for (const [k, v] of Object.entries(body.notification_prefs)) {
      if (v !== undefined) (prefs as unknown as Record<string, unknown>)[k] = v;
    }
  }
  const updated: User = {
    ...primary,
    ...(body.display_name ? { display_name: body.display_name } : {}),
    ...(body.visibility ? { visibility: body.visibility } : {}),
    notification_prefs: prefs,
    last_seen_at: nowIso(),
  };
  for (const garageId of updated.garages_member_of) {
    await putUser(garageId, updated);
  }
  return c.json({ user: updated });
});

meRoutes.use("/v1/me/delete-request", idempotency());
meRoutes.post("/v1/me/delete-request", requireIdempotencyKey(), async (c) => {
  const user = mustUser(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const ts = nowIso();
  const updated: User = { ...primary, deleted_at: ts };
  for (const garageId of updated.garages_member_of) {
    await putUser(garageId, updated);
  }
  // The account-cleaner Lambda hard-deletes records 30 days after deleted_at.
  return c.json({ scheduled_for_hard_delete_at: ts, status: "deletion_requested" });
});

meRoutes.get("/v1/me/data-export", async (c) => {
  const user = mustUser(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const exportPayload = {
    user: primary,
    exported_at: nowIso(),
    garages: primary.garages_member_of,
  };
  const recipient = c.req.query("email") ?? `${user.phone.replace("+", "")}@example.invalid`;
  await sendDataExportEmail({
    to: recipient,
    subject: "Your Garage Borrow data export",
    body: JSON.stringify(exportPayload, null, 2),
  });
  return c.json({ status: "queued" });
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// GET /v1/me/notifications — last 30 days, sorted desc by sent_at. Optional
// ?unread=true|false filter, opaque cursor pagination.
meRoutes.get("/v1/me/notifications", async (c) => {
  const user = mustUser(c);
  const params = parsePageParams(c);
  const unreadRaw = c.req.query("unread");
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const all = await listNotifications(user.phone);
  let scoped = all.filter((n) => n.sent_at >= cutoff);
  if (unreadRaw === "true") {
    scoped = scoped.filter((n) => !n.read_at);
  } else if (unreadRaw === "false") {
    scoped = scoped.filter((n) => Boolean(n.read_at));
  }
  scoped.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  const { page, next_cursor } = paginate(scoped, params);
  return c.json(next_cursor ? { items: page, next_cursor } : { items: page });
});

meRoutes.post("/v1/me/notifications/:id/read", async (c) => {
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing notification id");
  const existing = await getNotification(user.phone, id);
  if (!existing) throw new ApiError("not_found", "Notification not found");
  if (existing.read_at) {
    return c.json({ notification: existing });
  }
  const updated = { ...existing, read_at: nowIso() };
  await putNotification(updated);
  return c.json({ notification: updated });
});

meRoutes.post("/v1/me/notifications/read-all", async (c) => {
  const user = mustUser(c);
  const all = await listNotifications(user.phone);
  const ts = nowIso();
  let count = 0;
  for (const n of all) {
    if (n.read_at) continue;
    await putNotification({ ...n, read_at: ts });
    count += 1;
  }
  return c.json({ marked_read: count });
});

const PushSubSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

meRoutes.use("/v1/me/push-subscription", idempotency());
meRoutes.post("/v1/me/push-subscription", async (c) => {
  const user = mustUser(c);
  const body = PushSubSchema.parse(await c.req.json());
  const sub = {
    user_phone: user.phone,
    endpoint: body.endpoint,
    keys: body.keys,
    created_at: nowIso(),
  };
  const hash = createHash("sha256").update(body.endpoint).digest("hex").slice(0, 32);
  await putPushSubscription(sub, hash);
  // Touch the user's last_seen_at while we're here.
  const primary = await getUserAnyGarage(user.phone);
  if (primary) {
    for (const garageId of primary.garages_member_of) {
      const u = await getUser(garageId, user.phone);
      if (u) await putUser(garageId, { ...u, last_seen_at: nowIso() });
    }
  }
  return c.json({ id: newId(), status: "registered" }, 201);
});
