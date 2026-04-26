import { Hono } from "hono";
import { resolveItemAccess } from "@garageborrow/shared";
import { ItemSchema, ItemStatusSchema } from "@garageborrow/shared";
import type { Item, ItemStatus } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustMembership, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import {
  getItem,
  listInstances,
  listItems,
  listWaitlist,
  putIncident,
  putItem,
  putWaitlist,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const itemRoutes = new Hono<AppEnv>();

itemRoutes.use("/v1/g/:garage/items", requireAuth(), loadGarageContext());
itemRoutes.use("/v1/g/:garage/items/*", requireAuth(), loadGarageContext());
itemRoutes.use("/v1/g/:garage/incidents", requireAuth(), ownerOnly());

// GET /v1/g/:garage/items — list items filtered by user's tier. Items that
// resolve to access === "hidden" are dropped entirely; for the rest we
// attach an `access` field so the UI knows whether to show "Borrow" vs
// "Request" vs nothing.
itemRoutes.get("/v1/g/:garage/items", async (c) => {
  const garage = mustGarage(c);
  const membership = mustMembership(c);
  const items = await listItems(garage.id);
  const visible = items
    .map((it) => {
      const access = resolveItemAccess(membership.tier, it.min_tier, it.auto_approve_tier);
      return { ...it, access };
    })
    .filter((it) => it.access !== "hidden");
  return c.json({ items: visible });
});

itemRoutes.get("/v1/g/:garage/items/:id", async (c) => {
  const garage = mustGarage(c);
  const membership = mustMembership(c);
  const itemId = c.req.param("id");
  if (!itemId) throw new ApiError("bad_request", "Missing item id");
  const item = await getItem(garage.id, itemId);
  if (!item) throw new ApiError("not_found", "Item not found");
  const access = resolveItemAccess(membership.tier, item.min_tier, item.auto_approve_tier);
  if (access === "hidden") throw new ApiError("not_found", "Item not found");
  const instances = await listInstances(garage.id, itemId);
  const statusPills: string[] = [];
  if (item.status === "broken") statusPills.push("Broken");
  if (item.status === "maintenance") statusPills.push("In maintenance");
  if (item.status === "all_loaned") statusPills.push("All loaned out");
  if (item.status === "partial_loaned") statusPills.push("Partial");
  return c.json({
    item: { ...item, access },
    instances,
    status_pills: statusPills,
    handling_notes: item.handling_notes ?? "",
  });
});

const ItemCreateSchema = ItemSchema.omit({
  id: true,
  garage_id: true,
  created_at: true,
  updated_at: true,
  status: true,
  retired_at: true,
}).extend({
  status: ItemStatusSchema.optional(),
});

itemRoutes.use("/v1/g/:garage/items", idempotency());
itemRoutes.post("/v1/g/:garage/items", ownerOnly(), async (c) => {
  const garage = mustGarage(c);
  const body = ItemCreateSchema.parse(await c.req.json());
  const ts = nowIso();
  const item: Item = {
    ...body,
    id: newId(),
    garage_id: garage.id,
    created_at: ts,
    updated_at: ts,
    status: body.status ?? ("available" as ItemStatus),
    tags: body.tags ?? [],
    default_duration_days: body.default_duration_days ?? 3,
    requires_approval: body.requires_approval ?? false,
    min_tier: body.min_tier ?? "howdy",
    auto_approve_tier: body.auto_approve_tier ?? "family",
  };
  await putItem(item);
  return c.json({ item }, 201);
});

const ItemPatchSchema = ItemCreateSchema.partial();
itemRoutes.patch("/v1/g/:garage/items/:id", ownerOnly(), async (c) => {
  const garage = mustGarage(c);
  const itemId = c.req.param("id");
  if (!itemId) throw new ApiError("bad_request", "Missing item id");
  const existing = await getItem(garage.id, itemId);
  if (!existing) throw new ApiError("not_found", "Item not found");
  const body = ItemPatchSchema.parse(await c.req.json());
  const merged: Item = { ...existing, updated_at: nowIso() };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  await putItem(merged);
  return c.json({ item: merged });
});

const InstanceCreateSchema = z.object({
  label: z.string().min(1),
  quality_tier: z.string().min(1),
  notes: z.string().optional(),
});

itemRoutes.use("/v1/g/:garage/items/:id/instances", idempotency());
itemRoutes.post("/v1/g/:garage/items/:id/instances", ownerOnly(), async (c) => {
  const garage = mustGarage(c);
  const itemId = c.req.param("id");
  if (!itemId) throw new ApiError("bad_request", "Missing item id");
  const item = await getItem(garage.id, itemId);
  if (!item) throw new ApiError("not_found", "Item not found");
  const body = InstanceCreateSchema.parse(await c.req.json());
  const ts = nowIso();
  const inst = {
    id: newId(),
    item_id: itemId,
    garage_id: garage.id,
    label: body.label,
    quality_tier: body.quality_tier,
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    status: "available" as const,
    created_at: ts,
    updated_at: ts,
  };
  const { putInstance } = await import("../lib/repo.js");
  await putInstance(inst);
  return c.json({ instance: inst }, 201);
});

const InstancePatchSchema = z.object({
  label: z.string().min(1).optional(),
  quality_tier: z.string().min(1).optional(),
  notes: z.string().optional(),
  status: z
    .enum(["available", "loaned", "reserved", "maintenance", "broken", "retired"])
    .optional(),
});

itemRoutes.patch("/v1/g/:garage/items/:id/instances/:iid", ownerOnly(), async (c) => {
  const garage = mustGarage(c);
  const itemId = c.req.param("id");
  const iid = c.req.param("iid");
  if (!itemId || !iid) throw new ApiError("bad_request", "Missing id");
  const instances = await listInstances(garage.id, itemId);
  const existing = instances.find((i) => i.id === iid);
  if (!existing) throw new ApiError("not_found", "Instance not found");
  const body = InstancePatchSchema.parse(await c.req.json());
  const merged = { ...existing, updated_at: nowIso() };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  const { putInstance } = await import("../lib/repo.js");
  await putInstance(merged);
  return c.json({ instance: merged });
});

itemRoutes.use("/v1/g/:garage/items/:id/retire", idempotency());
itemRoutes.post("/v1/g/:garage/items/:id/retire", ownerOnly(), async (c) => {
  const garage = mustGarage(c);
  const itemId = c.req.param("id");
  if (!itemId) throw new ApiError("bad_request", "Missing item id");
  const existing = await getItem(garage.id, itemId);
  if (!existing) throw new ApiError("not_found", "Item not found");
  const ts = nowIso();
  const updated: Item = { ...existing, status: "retired", retired_at: ts, updated_at: ts };
  await putItem(updated);
  return c.json({ item: updated });
});

itemRoutes.use("/v1/g/:garage/items/:id/waitlist", idempotency());
itemRoutes.post("/v1/g/:garage/items/:id/waitlist", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const itemId = c.req.param("id");
  if (!itemId) throw new ApiError("bad_request", "Missing item id");
  const item = await getItem(garage.id, itemId);
  if (!item) throw new ApiError("not_found", "Item not found");
  const existing = await listWaitlist(garage.id, itemId);
  const ts = nowIso();
  const entry = {
    id: newId(),
    garage_id: garage.id,
    item_id: itemId,
    borrower_phone: user.phone,
    joined_at: ts,
    position: existing.length + 1,
    notify_when_available: true,
  };
  await putWaitlist(entry);
  return c.json({ entry }, 201);
});

const IncidentCreateSchema = z.object({
  item_id: z.string().min(1),
  loan_id: z.string().min(1),
  type: z.enum(["damage", "loss", "malfunction"]),
  description: z.string().min(1),
  photo_keys: z.array(z.string().min(1)).default([]),
  suggested_action: z.string().optional(),
});

itemRoutes.use("/v1/g/:garage/incidents", idempotency());
itemRoutes.post("/v1/g/:garage/incidents", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const body = IncidentCreateSchema.parse(await c.req.json());
  const ts = nowIso();
  const inc = {
    id: newId(),
    garage_id: garage.id,
    item_id: body.item_id,
    loan_id: body.loan_id,
    reporter_phone: user.phone,
    type: body.type,
    description: body.description,
    photo_keys: body.photo_keys,
    ...(body.suggested_action ? { suggested_action: body.suggested_action } : {}),
    status: "open" as const,
    created_at: ts,
  };
  await putIncident(inc);
  return c.json({ incident: inc }, 201);
});
