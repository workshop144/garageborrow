import { z } from "zod";
import { IsoDateTime, PhoneE164, PosInt, TierNameSchema } from "./common.js";

export const ItemStatusSchema = z.enum([
  "available",
  "all_loaned",
  "partial_loaned",
  "broken",
  "maintenance",
  "retired",
  "lost",
]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const ItemSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  primary_photo_key: z.string().min(1),
  handling_notes: z.string().optional(),
  default_duration_days: PosInt.default(3),
  requires_approval: z.boolean().default(false),
  min_tier: TierNameSchema.default("howdy"),
  auto_approve_tier: TierNameSchema.default("family"),
  approx_value: z.number().nonnegative().optional(),
  tags: z.array(z.string().min(1)).default([]),
  donated_by_phone: PhoneE164.optional(),
  donated_by_display: z.string().optional(),
  status: ItemStatusSchema,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  retired_at: IsoDateTime.optional(),
});

export type Item = z.infer<typeof ItemSchema>;
export type ItemInput = z.input<typeof ItemSchema>;
