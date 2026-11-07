// Image URL for an uploaded photo key ("uploads/<kind>/<id>.<ext>"), served
// through the CDN's /img/ route. Anything else — notably a full URL a member
// slipped in as a key — renders nothing, so no member's browser is sent to a
// third-party host.
//
// Only the resized variants are ever rendered (GB-R1-2): the image resizer
// re-encodes each upload into img/thumb/<key> (256 px wide) and
// img/medium/<key> (1024 px wide) with every metadata block dropped. The
// original upload keeps whatever the phone wrote into it (EXIF GPS position,
// camera serial) and is never served: CloudFront can read only the img/
// prefix of the bucket.
import { PHOTO_KEY_RE } from "@garageborrow/shared/photo-key";

const PHOTO_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/v1\/?$/, "") ?? "";

export type PhotoSize = "thumb" | "medium";

export function photoUrl(key: string | undefined | null, size: PhotoSize = "medium"): string {
  if (!key || !PHOTO_KEY_RE.test(key)) return "";
  return `${PHOTO_BASE}/img/${size === "thumb" ? "thumb" : "medium"}/${key}`;
}
