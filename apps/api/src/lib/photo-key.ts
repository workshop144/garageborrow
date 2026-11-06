import { PHOTO_KEY_RE } from "@garageborrow/shared";
import { z } from "zod";

// An object key from /v1/uploads/sign (see PHOTO_KEY_RE in the shared package).
// The web renders keys through /img/<key>, so anything else, a full URL above
// all, must never be stored as a photo key.
export { PHOTO_KEY_RE };

export const PhotoKey = z
  .string()
  .max(300)
  .regex(PHOTO_KEY_RE, "Must be an uploaded photo key (uploads/...)");
