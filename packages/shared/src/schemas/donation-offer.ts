import { z } from "zod";
import { IsoDateTime, PhoneE164 } from "./common.js";

export const DonationConditionSchema = z.enum(["new", "good", "fair", "poor"]);
export type DonationCondition = z.infer<typeof DonationConditionSchema>;

export const DonationOfferStatusSchema = z.enum(["pending", "accepted", "declined", "received"]);
export type DonationOfferStatus = z.infer<typeof DonationOfferStatusSchema>;

export const DonationOfferSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  donor_phone: PhoneE164,
  item_name: z.string().min(1),
  description: z.string(),
  photo_keys: z.array(z.string().min(1)).default([]),
  condition: DonationConditionSchema,
  donor_notes: z.string().optional(),
  suggested_category: z.string().optional(),
  status: DonationOfferStatusSchema,
  decided_at: IsoDateTime.optional(),
  decided_by_phone: PhoneE164.optional(),
  owner_notes: z.string().optional(),
  decline_reason: z.string().optional(),
  resulting_item_id: z.string().min(1).optional(),
  created_at: IsoDateTime,
});

export type DonationOffer = z.infer<typeof DonationOfferSchema>;
export type DonationOfferInput = z.input<typeof DonationOfferSchema>;
