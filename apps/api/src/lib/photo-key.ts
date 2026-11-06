import { z } from "zod";

// An object key from /v1/uploads/sign: "uploads/<kind>/<id>.<ext>" (older keys
// carry one more path segment). The web renders keys through /img/<key>, so
// anything else, a full URL above all, must never be stored as a photo key.
export const PHOTO_KEY_RE = /^uploads\/[\w-]+(?:\/[\w-]+)+\.\w+$/;

export const PhotoKey = z
  .string()
  .max(300)
  .regex(PHOTO_KEY_RE, "Must be an uploaded photo key (uploads/...)");
