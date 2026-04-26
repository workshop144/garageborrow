// Client-generated idempotency keys (uuid v4). Same key is reused across
// transient retries so the server can dedupe; a fresh key is minted per
// user-visible attempt.

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID. Uses Math.random,
  // which is not cryptographically strong, but a duplicate within the
  // dedupe window is still extremely unlikely.
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const b = bytes.map(hex).join("");
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}
