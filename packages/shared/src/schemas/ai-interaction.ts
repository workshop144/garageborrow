import { z } from "zod";
import { IsoDateTime, NonNegInt, PhoneE164 } from "./common.js";
import { AiModelSchema } from "./garage.js";

export const AiInteractionSchema = z.object({
  id: z.string().min(1),
  garage_id: z.string().min(1),
  user_phone: PhoneE164,
  timestamp: IsoDateTime,
  model: AiModelSchema,
  prompt_tokens: NonNegInt,
  completion_tokens: NonNegInt,
  cost_cents: NonNegInt,
  prompt_first_200: z.string().max(200),
});

export type AiInteraction = z.infer<typeof AiInteractionSchema>;
export type AiInteractionInput = z.input<typeof AiInteractionSchema>;
