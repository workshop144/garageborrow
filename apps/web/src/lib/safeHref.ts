/**
 * Returns the URL only if it is a safe http(s) URL; otherwise undefined.
 *
 * Use as: `<a href={safeHref(url)}>` — when undefined, React renders an
 * anchor without an href attribute, which is non-clickable. Defense in depth
 * against `javascript:` / `data:` / `vbscript:` payloads that slip past
 * server-side validation.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return url;
  } catch {
    return undefined;
  }
  return undefined;
}
