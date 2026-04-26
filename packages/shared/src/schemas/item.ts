import { z } from "zod";
import { IsoDateTime, NonNegInt, PhoneE164, PosInt, TierNameSchema } from "./common.js";

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

// Visible access levels exposed to API clients. "hidden" items are filtered
// out server-side, so list/detail responses only ever carry "request" or
// "instant".
export const ItemAccessSchema = z.enum(["request", "instant"]);
export type ItemAccess = z.infer<typeof ItemAccessSchema>;

export const ItemCountsSchema = z.object({
  available_count: NonNegInt,
  total_count: NonNegInt,
  borrows_total: NonNegInt,
  borrows_last_30d: NonNegInt,
});
export type ItemCounts = z.infer<typeof ItemCountsSchema>;

export const ItemListEntrySchema = ItemSchema.extend({
  access: ItemAccessSchema,
}).merge(ItemCountsSchema);
export type ItemListEntry = z.infer<typeof ItemListEntrySchema>;

export const ItemDetailSchema = ItemSchema.extend({
  access: ItemAccessSchema,
}).merge(ItemCountsSchema);
export type ItemDetail = z.infer<typeof ItemDetailSchema>;

export const ItemSortSchema = z.enum(["recent", "popular", "alphabetical"]);
export type ItemSort = z.infer<typeof ItemSortSchema>;
