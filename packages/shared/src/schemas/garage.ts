import { z } from "zod";
import { IsoDate, IsoDateTime, NonNegInt, PhoneE164, Slug, TierNameSchema } from "./common.js";
import { NonprofitOrgSchema } from "./nonprofit-org.js";

export const GarageStatusSchema = z.enum(["open", "closed_until", "closed_indefinitely"]);
export type GarageStatus = z.infer<typeof GarageStatusSchema>;

export const AiModelSchema = z.enum(["haiku", "sonnet"]);
export type AiModel = z.infer<typeof AiModelSchema>;

export const GeoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type Geo = z.infer<typeof GeoSchema>;

export const TierLabelsSchema = z
  .object({
    howdy: z.string().min(1),
    friend: z.string().min(1),
    family: z.string().min(1),
  })
  .default({ howdy: "Howdy", friend: "Friend", family: "Family" });
export type TierLabels = z.infer<typeof TierLabelsSchema>;

export const GarageSchema = z.object({
  id: Slug,
  name: z.string().min(1),
  owner_phone: PhoneE164,
  city_slug: Slug,
  city_display: z.string().min(1),
  geo: GeoSchema.nullable(),
  quality_tiers: z.array(z.string().min(1)),
  status: GarageStatusSchema,
  closed_until_date: IsoDate.optional(),
  payforward_orgs: z.array(NonprofitOrgSchema).default([]),
  payforward_intro_copy: z.string().optional(),
  ai_enabled: z.boolean().default(false),
  ai_min_tier: TierNameSchema.default("family"),
  ai_total_monthly_cap_cents: NonNegInt.default(500),
  ai_default_user_monthly_tokens: NonNegInt.default(100000),
  ai_default_model: AiModelSchema.default("haiku"),
  tier_labels: TierLabelsSchema,
  vouching_required: z.boolean().default(false),
  // Wishlist gear-request feature. When disabled per garage, all wishlist
  // routes 404 and the nav entry hides. Threshold defaults to 5 — once a
  // request crosses it, the owner gets a one-time `wishlist_popular` ping.
  wishlist_enabled: z.boolean().default(true),
  wishlist_popular_threshold: z.number().int().positive().default(5),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export type Garage = z.infer<typeof GarageSchema>;
export type GarageInput = z.input<typeof GarageSchema>;
