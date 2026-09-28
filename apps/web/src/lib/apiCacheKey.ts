// Service-worker cache keys for /v1 responses, bound to the signed-in user.
//
// The API cache used to be keyed by URL alone, so a response cached for one
// user (e.g. /v1/me) could be served to the next person signed in on the same
// device whenever the network was slow or offline. The key now carries the
// token's subject, and requests without a bearer token are never cached.

function tokenSubject(authorization: string | null): string | undefined {
  const m = /^Bearer\s+[\w-]+\.([\w-]+)\.[\w-]*$/.exec(authorization ?? "");
  if (!m?.[1]) return undefined;
  try {
    const json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub !== "" ? sub : undefined;
  } catch {
    return undefined;
  }
}

// The cache key for this request, or undefined when it must not be cached.
export function apiCacheKey(request: Request): string | undefined {
  const sub = tokenSubject(request.headers.get("authorization"));
  if (!sub) return undefined;
  const url = new URL(request.url);
  url.searchParams.set("__sw_user", sub);
  return url.toString();
}
