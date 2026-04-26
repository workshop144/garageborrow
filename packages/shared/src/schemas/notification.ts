import { z } from "zod";
import { IsoDateTime, PhoneE164 } from "./common.js";

export const NotificationChannelSchema = z.enum(["sms", "push", "inapp"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationSchema = z.object({
  id: z.string().min(1),
  user_phone: PhoneE164,
  garage_id: z.string().min(1).optional(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  channel: NotificationChannelSchema,
  sent_at: IsoDateTime,
  read_at: IsoDateTime.optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationInput = z.input<typeof NotificationSchema>;
