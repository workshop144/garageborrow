// Image URL for an uploaded photo key ("uploads/<kind>/<id>.<ext>"), served
// through the API's /img/ route. Anything else — notably a full URL a member
// slipped in as a key — renders nothing, so no member's browser is sent to a
// third-party host.
const PHOTO_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/v1\/?$/, "") ?? "";

const UPLOAD_KEY = /^uploads\/[\w-]+(?:\/[\w-]+)+\.\w+$/;

export function photoUrl(key: string | undefined | null): string {
  if (!key || !UPLOAD_KEY.test(key)) return "";
  return `${PHOTO_BASE}/img/${key}`;
}
