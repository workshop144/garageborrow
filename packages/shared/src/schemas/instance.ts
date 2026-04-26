import { z } from "zod";
import { IsoDateTime } from "./common.js";

export const InstanceStatusSchema = z.enum([
  "available",
  "loaned",
  "reserved",
  "maintenance",
  "broken",
  "retired",
]);
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;

export const InstanceSchema = z.object({
  id: z.string().min(1),
  item_id: z.string().min(1),
  garage_id: z.string().min(1),
  label: z.string().min(1),
  quality_tier: z.string().min(1),
  notes: z.string().optional(),
  status: InstanceStatusSchema,
  current_loan_id: z.string().min(1).optional(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export type Instance = z.infer<typeof InstanceSchema>;
export type InstanceInput = z.input<typeof InstanceSchema>;
