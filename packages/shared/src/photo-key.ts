// An object key from /v1/uploads/sign: "uploads/<kind>/<id>.<ext>" (older keys
// carry one more path segment). No dot segments, so /img/<key> stays in /img/.
// Kept in a dependency-free module so the web can import it (via
// "@garageborrow/shared/photo-key") without pulling zod into the bundle.
export const PHOTO_KEY_RE = /^uploads\/[\w-]+(?:\/[\w-]+)+\.\w+$/;
