import { z } from "zod";
import { HttpUrl, IsoDate, IsoDateTime, NonNegInt, PhoneE164 } from "./common.js";

export const WishlistRequestStatusSchema = z.enum([
  "open",
  "acquired",
  "declined",
  "duplicate",
  "cancelled",
]);
export type WishlistRequestStatus = z.infer<typeof WishlistRequestStatusSchema>;

export const WishlistRequestSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  requester_phone: PhoneE164,
  item_name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  desired_by: IsoDate.optional(),
  reason: z.string().max(500).optional(),
  reference_url: HttpUrl.optional(),
  photo_url: z.string().min(1).optional(),
  status: WishlistRequestStatusSchema,
  acquired_item_id: z.string().min(1).optional(),
  duplicate_of_id: z.string().min(1).optional(),
  vote_count: NonNegInt,
  decided_at: IsoDateTime.optional(),
  decided_by_phone: PhoneE164.optional(),
  decline_reason: z.string().optional(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export type WishlistRequest = z.infer<typeof WishlistRequestSchema>;
export type WishlistRequestInput = z.input<typeof WishlistRequestSchema>;
