import { z } from "zod";
import { IsoDateTime, PhoneE164, TierNameSchema } from "./common.js";

// An owner's invitation for one phone number to join one garage. Self-service
// sign-up is closed (the user pool only allows admin-created users), so an
// unexpired invite is what lets a new number get an account; the first signed-in
// call to POST /v1/me/join turns it into a membership and deletes it.
export const GarageInviteSchema = z.object({
  garage_id: z.string().min(1),
  phone: PhoneE164,
  tier: TierNameSchema.default("howdy"),
  invited_by_phone: PhoneE164,
  created_at: IsoDateTime,
  // Epoch seconds; the table's TTL attribute, so expired invites disappear.
  expires_at: z.number().int().positive(),
});

export type GarageInvite = z.infer<typeof GarageInviteSchema>;
