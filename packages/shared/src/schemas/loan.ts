import { z } from "zod";
import { IsoDateTime, NonNegInt, PhoneE164 } from "./common.js";

export const LoanStatusSchema = z.enum(["active", "returned", "overdue", "lost"]);
export type LoanStatus = z.infer<typeof LoanStatusSchema>;

export const LoanSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  item_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  borrower_phone: PhoneE164,
  borrowed_at: IsoDateTime,
  expected_return_at: IsoDateTime,
  actual_return_at: IsoDateTime.optional(),
  status: LoanStatusSchema,
  extension_count: NonNegInt.default(0),
  last_extended_at: IsoDateTime.optional(),
  liability_acknowledged_at: IsoDateTime,
  liability_copy_version: z.string().min(1),
});

export type Loan = z.infer<typeof LoanSchema>;
export type LoanInput = z.input<typeof LoanSchema>;
