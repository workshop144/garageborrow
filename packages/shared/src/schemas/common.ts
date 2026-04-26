import { z } from "zod";

export const PhoneE164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "must be E.164 (e.g. +15551234567)");

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD");

export const IsoDateTime = z.string().datetime({ offset: true });

export const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (00:00–23:59)");

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase-kebab slug");

export const TIER_NAMES = ["howdy", "friend", "family"] as const;
export type TierName = (typeof TIER_NAMES)[number];
export const TierNameSchema = z.enum(TIER_NAMES);

export const NonNegInt = z.number().int().nonnegative();
export const PosInt = z.number().int().positive();
