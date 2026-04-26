import { z } from "zod";
import { NonNegInt } from "./common.js";

export const NonprofitOrgSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().url().optional(),
  donate_url: z.string().url().optional(),
  logo_url: z.string().url().optional(),
  ein: z.string().optional(),
  display_order: NonNegInt,
});

export type NonprofitOrg = z.infer<typeof NonprofitOrgSchema>;
