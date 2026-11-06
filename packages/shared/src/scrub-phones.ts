// Replace E.164 phone numbers in text sent to third parties (Sentry). Admin
// routes carry a member's phone in the path (/admin/members/%2B1...), and the
// pino redaction in the API logger does not cover Sentry events, extras or
// browser fetch breadcrumbs. Matches "+" followed by 6 or more digits, the
// URL-encoded "%2B" and the double-encoded "%252B" (either case). The whole
// digit run is replaced, so an over-long run leaves no tail behind.
//
// Dependency-free so the web can import it via "@garageborrow/shared/scrub-phones"
// without pulling zod into the bundle.

// Non-global on purpose: a shared /g regex keeps lastIndex between .test()
// or .exec() calls. scrubPhones builds its own global copy.
export const PHONE_IN_TEXT_RE = /(?:%(?:25)?2B|\+)\d{6,}/i;
const PHONE_IN_TEXT_GLOBAL_RE = new RegExp(PHONE_IN_TEXT_RE.source, "gi");

export const PHONE_PLACEHOLDER = "[phone]";

export function scrubPhones(text: string): string {
  return text.replace(PHONE_IN_TEXT_GLOBAL_RE, PHONE_PLACEHOLDER);
}

function isPlainObject(v: object): boolean {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Deep copy of `value` with every string (and every plain-object key) passed
// through scrubPhones. Arrays and plain objects are rebuilt; other objects
// (Error, Date, class instances) are returned as they are. Cycles are kept.
export function scrubPhonesDeep<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubPhones(v);
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (const item of v) out.push(walk(item));
      return out;
    }
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const [k, inner] of Object.entries(v)) out[scrubPhones(k)] = walk(inner);
    return out;
  };
  return walk(value) as T;
}
