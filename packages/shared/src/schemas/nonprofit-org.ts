import { z } from "zod";
import { HttpUrl, NonNegInt } from "./common.js";

export const NonprofitOrgSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: HttpUrl.optional(),
  donate_url: HttpUrl.optional(),
  logo_url: HttpUrl.optional(),
  ein: z.string().optional(),
  display_order: NonNegInt,
});

export type NonprofitOrg = z.infer<typeof NonprofitOrgSchema>;
