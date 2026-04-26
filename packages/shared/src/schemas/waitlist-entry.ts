import { z } from "zod";
import { IsoDateTime, NonNegInt, PhoneE164 } from "./common.js";

export const WaitlistEntrySchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  item_id: z.string().min(1),
  borrower_phone: PhoneE164,
  joined_at: IsoDateTime,
  position: NonNegInt,
  notify_when_available: z.boolean().default(true),
});

export type WaitlistEntry = z.infer<typeof WaitlistEntrySchema>;
export type WaitlistEntryInput = z.input<typeof WaitlistEntrySchema>;
