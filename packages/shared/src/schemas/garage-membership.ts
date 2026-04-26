import { z } from "zod";
import { IsoDateTime, NonNegInt, PhoneE164, TierNameSchema } from "./common.js";

export const GarageMembershipSchema = z.object({
  garage_id: z.string().min(1),
  user_phone: PhoneE164,
  tier: TierNameSchema.default("howdy"),
  joined_at: IsoDateTime,
  vouched_by_phone: PhoneE164.optional(),
  borrows_total: NonNegInt.default(0),
  borrows_active: NonNegInt.default(0),
  returns_on_time: NonNegInt.default(0),
  returns_late: NonNegInt.default(0),
  no_shows: NonNegInt.default(0),
  ai_tokens_used_this_month: NonNegInt.default(0),
  ai_tokens_used_total: NonNegInt.default(0),
  ai_budget_override_tokens: NonNegInt.optional(),
  notes: z.string().optional(),
});

export type GarageMembership = z.infer<typeof GarageMembershipSchema>;
export type GarageMembershipInput = z.input<typeof GarageMembershipSchema>;
