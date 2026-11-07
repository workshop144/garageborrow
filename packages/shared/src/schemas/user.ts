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
  // When true, notify the user once the AI helper goes live in their garage.
  // Borrower-facing toggle from the "Coming Soon" placeholder card.
  ai_ready_notify: z.boolean().default(false),
  quiet_hours_start: HhMm.default("21:00"),
  quiet_hours_end: HhMm.default("08:00"),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

// A member's name is shown to every member of each garage they belong to, so it
// is bounded like every other member-writable text field. Control characters
// and bidi overrides are rejected: they can break or disguise the rows other
// members see (a right-to-left override can make one name read as another).
// Zero-width joiners stay allowed, emoji sequences need them.
export const DISPLAY_NAME_MAX_LENGTH = 60;
// eslint-disable-next-line no-control-regex
const DISPLAY_NAME_FORBIDDEN_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX_LENGTH)
  .refine((v) => !DISPLAY_NAME_FORBIDDEN_RE.test(v), "must not contain control characters");

export const UserSchema = z.object({
  phone: PhoneE164,
  display_name: DisplayName,
  visibility: UserVisibilitySchema.default("visible"),
  garages_member_of: z.array(z.string().min(1)).default([]),
  notification_prefs: NotificationPrefsSchema,
  deleted_at: IsoDateTime.optional(),
  created_at: IsoDateTime,
  last_seen_at: IsoDateTime,
});

export type User = z.infer<typeof UserSchema>;
export type UserInput = z.input<typeof UserSchema>;
