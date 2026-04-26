import { z } from "zod";
import { IsoDateTime, PhoneE164 } from "./common.js";

export const ReservationStatusSchema = z.enum(["pending", "approved", "declined", "cancelled"]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const ReservationSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  item_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  borrower_phone: PhoneE164,
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  status: ReservationStatusSchema,
  approval_required: z.boolean(),
  decided_by_phone: PhoneE164.optional(),
  decided_at: IsoDateTime.optional(),
  decline_reason: z.string().optional(),
});

export type Reservation = z.infer<typeof ReservationSchema>;
export type ReservationInput = z.input<typeof ReservationSchema>;
