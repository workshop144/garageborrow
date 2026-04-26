import { z } from "zod";
import { HhMm, IsoDateTime, PhoneE164 } from "./common.js";

export const UserVisibilitySchema = z.enum(["visible", "hidden"]);
export type UserVisibility = z.infer<typeof UserVisibilitySchema>;

export const NotificationPrefsSchema = z.object({
  sms_enabled: z.boolean().default(true),
  push_enabled: z.boolean().default(true),
  reminders: z.boolean().default(true),
  waitlist_updates: z.boolean().default(true),
  new_tools: z.boolean().default(true),
  promotion_celebrations: z.boolean().default(true),
  quiet_hours_start: HhMm.default("21:00"),
  quiet_hours_end: HhMm.default("08:00"),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const UserSchema = z.object({
  phone: PhoneE164,
  display_name: z.string().min(1),
  visibility: UserVisibilitySchema.default("visible"),
  garages_member_of: z.array(z.string().min(1)).default([]),
  notification_prefs: NotificationPrefsSchema,
  deleted_at: IsoDateTime.optional(),
  created_at: IsoDateTime,
  last_seen_at: IsoDateTime,
});

export type User = z.infer<typeof UserSchema>;
export type UserInput = z.input<typeof UserSchema>;
