import { z } from "zod";
import { IsoDateTime, PhoneE164 } from "./common.js";

export const WishlistVoteSchema = z.object({
  request_id: z.string().min(1),
  voter_phone: PhoneE164,
  voted_at: IsoDateTime,
});

export type WishlistVote = z.infer<typeof WishlistVoteSchema>;
export type WishlistVoteInput = z.input<typeof WishlistVoteSchema>;
