import { z } from "zod";
import { IsoDateTime, PhoneE164 } from "./common.js";

export const IncidentTypeSchema = z.enum(["damage", "loss", "malfunction"]);
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const IncidentStatusSchema = z.enum(["open", "resolved", "closed"]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentReportSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  item_id: z.string().min(1),
  loan_id: z.string().min(1),
  reporter_phone: PhoneE164,
  type: IncidentTypeSchema,
  description: z.string().min(1),
  photo_keys: z.array(z.string().min(1)).default([]),
  suggested_action: z.string().optional(),
  status: IncidentStatusSchema,
  created_at: IsoDateTime,
  resolved_at: IsoDateTime.optional(),
});

export type IncidentReport = z.infer<typeof IncidentReportSchema>;
export type IncidentReportInput = z.input<typeof IncidentReportSchema>;
