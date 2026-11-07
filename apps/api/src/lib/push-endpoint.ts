// Web Push endpoints the API accepts and the notifier will POST to. A browser's
// PushSubscription.endpoint always points at its vendor's push service; any
// other host is either a bug or someone steering the notifier at a URL of
// their choosing (SSRF once web-push is wired; 2026-11-07 review F10).

// Exact hosts, and suffixes that match a subdomain (each starts with a dot).
const EXACT_HOSTS = new Set([
  "fcm.googleapis.com", // Chrome, Edge (Chromium), Android
  "android.googleapis.com", // legacy GCM endpoints still issued by old Chrome
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari / iOS home-screen apps
]);
const HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

// Most push subscriptions a member keeps. Browsers rotate endpoints, so a new
// one past the cap replaces the oldest instead of being refused.
export const MAX_PUSH_SUBSCRIPTIONS = 10;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (EXACT_HOSTS.has(host)) return true;
  return HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

// Push services answer 404 or 410 for a subscription that is gone for good.
export function isGonePushError(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return status === 404 || status === 410;
}
