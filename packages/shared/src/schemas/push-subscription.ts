import { z } from "zod";
import { IsoDateTime, PhoneE164 } from "./common.js";

export const PushSubscriptionSchema = z.object({
  user_phone: PhoneE164,
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  created_at: IsoDateTime,
});

export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export type PushSubscriptionInput = z.input<typeof PushSubscriptionSchema>;
