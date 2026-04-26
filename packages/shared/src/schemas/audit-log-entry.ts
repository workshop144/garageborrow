import { z } from "zod";
import { IsoDate, IsoDateTime, PhoneE164 } from "./common.js";

// Action types are kept open-ended (string) so adding a new admin route does
// not require a shared-package version bump. Routes choose a stable
// dot-namespaced verb like "member.tier_changed" or "item.bulk_imported".
export const AuditActionTypeSchema = z.string().min(1).max(64);
export type AuditActionType = z.infer<typeof AuditActionTypeSchema>;

export const AuditEntityTypeSchema = z.enum([
  "member",
  "item",
  "instance",
  "donation",
  "incident",
  "garage",
  "items_bulk",
]);
export type AuditEntityType = z.infer<typeof AuditEntityTypeSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  date: IsoDate,
  actor_phone: PhoneE164,
  action_type: AuditActionTypeSchema,
  entity_type: AuditEntityTypeSchema,
  entity_id: z.string().min(1),
  before_snapshot: z.unknown().nullable(),
  after_snapshot: z.unknown().nullable(),
  http_method: z.enum(["POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().min(1),
  created_at: IsoDateTime,
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export type AuditLogEntryInput = z.input<typeof AuditLogEntrySchema>;
