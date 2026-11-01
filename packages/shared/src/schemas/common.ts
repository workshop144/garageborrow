import { z } from "zod";

export const PhoneE164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "must be E.164 (e.g. +15551234567)");

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD");

export const IsoDateTime = z.iso.datetime({ offset: true });

export const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (00:00–23:59)");

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase-kebab slug");

export const TIER_NAMES = ["howdy", "friend", "family"] as const;
export type TierName = (typeof TIER_NAMES)[number];
export const TierNameSchema = z.enum(TIER_NAMES);

export const NonNegInt = z.number().int().nonnegative();
export const PosInt = z.number().int().positive();

// Zod's `z.url()` accepts any URL the WHATWG URL constructor parses, including
// `javascript:`, `data:`, and `vbscript:` — which become stored XSS when the
// value is later rendered as an anchor href. Use `HttpUrl` for any field that
// might surface in the UI. Length is bounded because rows holding these are
// read back whole (a wishlist page returns up to 100 rows in one response).
export const HTTP_URL_MAX_LENGTH = 2048;
export const HttpUrl = z
  .url()
  .max(HTTP_URL_MAX_LENGTH)
  .refine((u) => /^https?:\/\//i.test(u), {
    error: "must start with http:// or https://",
  });

type WithoutDefault<T extends z.core.SomeType> = T extends z.ZodDefault<infer Inner> ? Inner : T;

/**
 * PATCH-body variant of an object schema: every field optional, with any
 * `.default()` stripped. Zod 4 applies defaults even inside `.optional()` and
 * `.partial()`, so `Schema.partial()` would fill every omitted field with its
 * default and a merge would overwrite the stored value. Omitted keys must stay
 * absent in a patch.
 */
export function patchSchemaOf<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    shape[key] = (field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field).optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof Shape]: z.ZodOptional<WithoutDefault<Shape[K]>>;
  }>;
}
