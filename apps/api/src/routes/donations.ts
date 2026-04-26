import { Hono } from "hono";
import { DonationConditionSchema } from "@garageborrow/shared";
import type { DonationOffer, Item } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import { getDonation, listDonations, putDonation, putItem } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const donationRoutes = new Hono<AppEnv>();

donationRoutes.use("/v1/g/:garage/donations", requireAuth(), loadGarageContext());
donationRoutes.use("/v1/g/:garage/donations/*", requireAuth(), loadGarageContext());

const DonationCreateSchema = z.object({
  item_name: z.string().min(1),
  description: z.string(),
  photo_keys: z.array(z.string().min(1)).default([]),
  condition: DonationConditionSchema,
  donor_notes: z.string().optional(),
  suggested_category: z.string().optional(),
});

donationRoutes.use("/v1/g/:garage/donations", idempotency());
donationRoutes.post("/v1/g/:garage/donations", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const body = DonationCreateSchema.parse(await c.req.json());
  const ts = nowIso();
  const offer: DonationOffer = {
    id: newId(),
    garage_id: garage.id,
    donor_phone: user.phone,
    item_name: body.item_name,
    description: body.description,
    photo_keys: body.photo_keys,
    condition: body.condition,
    ...(body.donor_notes !== undefined ? { donor_notes: body.donor_notes } : {}),
    ...(body.suggested_category !== undefined
      ? { suggested_category: body.suggested_category }
      : {}),
    status: "pending",
    created_at: ts,
  };
  await putDonation(offer);
  return c.json({ donation: offer }, 201);
});

donationRoutes.get("/v1/g/:garage/donations/mine", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const all = await listDonations(garage.id);
  const mine = all.filter((d) => d.donor_phone === user.phone);
  return c.json({ donations: mine });
});

// Owner-only:
donationRoutes.use("/v1/g/:garage/admin/donations", requireAuth(), ownerOnly());
donationRoutes.use("/v1/g/:garage/admin/donations/*", requireAuth(), ownerOnly());

donationRoutes.get("/v1/g/:garage/admin/donations", async (c) => {
  const garage = mustGarage(c);
  const all = await listDonations(garage.id);
  return c.json({ donations: all });
});

const DecideSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("accept"),
    item_overrides: z
      .object({
        category: z.string().min(1).optional(),
        primary_photo_key: z.string().min(1).optional(),
        handling_notes: z.string().optional(),
        min_tier: z.enum(["howdy", "friend", "family"]).optional(),
        auto_approve_tier: z.enum(["howdy", "friend", "family"]).optional(),
      })
      .default({}),
    owner_notes: z.string().optional(),
  }),
  z.object({
    decision: z.literal("decline"),
    decline_reason: z.string().min(1),
    owner_notes: z.string().optional(),
  }),
]);

donationRoutes.use("/v1/g/:garage/admin/donations/:id/decide", idempotency());
donationRoutes.post("/v1/g/:garage/admin/donations/:id/decide", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const offer = await getDonation(garage.id, id);
  if (!offer) throw new ApiError("not_found", "Donation not found");
  if (offer.status !== "pending") {
    throw new ApiError("conflict", `Donation already ${offer.status}`);
  }
  const body = DecideSchema.parse(await c.req.json());
  const ts = nowIso();
  if (body.decision === "decline") {
    const updated: DonationOffer = {
      ...offer,
      status: "declined",
      decline_reason: body.decline_reason,
      ...(body.owner_notes !== undefined ? { owner_notes: body.owner_notes } : {}),
      decided_at: ts,
      decided_by_phone: user.phone,
    };
    await putDonation(updated);
    await invokeNotifier({
      type: "donation_declined",
      garage_id: garage.id,
      payload: { donation_id: offer.id },
    });
    return c.json({ donation: updated });
  }
  const overrides = body.item_overrides;
  const item: Item = {
    id: newId(),
    garage_id: garage.id,
    name: offer.item_name,
    description: offer.description,
    category: overrides.category ?? offer.suggested_category ?? "uncategorized",
    primary_photo_key: overrides.primary_photo_key ?? offer.photo_keys[0] ?? "",
    ...(overrides.handling_notes !== undefined ? { handling_notes: overrides.handling_notes } : {}),
    default_duration_days: 3,
    requires_approval: false,
    min_tier: overrides.min_tier ?? "howdy",
    auto_approve_tier: overrides.auto_approve_tier ?? "family",
    tags: [],
    donated_by_phone: offer.donor_phone,
    status: "available",
    created_at: ts,
    updated_at: ts,
  };
  await putItem(item);
  const updated: DonationOffer = {
    ...offer,
    status: "accepted",
    ...(body.owner_notes !== undefined ? { owner_notes: body.owner_notes } : {}),
    decided_at: ts,
    decided_by_phone: user.phone,
    resulting_item_id: item.id,
  };
  await putDonation(updated);
  await invokeNotifier({
    type: "donation_accepted",
    garage_id: garage.id,
    payload: { donation_id: offer.id, resulting_item_id: item.id },
  });
  return c.json({ donation: updated, item });
});
