// Per-deployment identity, set at build time through VITE_* variables. The
// defaults are neutral so the open-source repo names no real place.

const env = import.meta.env;

export const TENANT_NAME = env.VITE_TENANT_NAME || "Garage Borrow";
export const SITE_URL = env.VITE_SITE_URL || "";
// "the State of X" and "X County, X courts" in the terms of service.
export const GOVERNING_LAW = env.VITE_TENANT_GOVERNING_LAW || "the state where the garage operates";
export const VENUE = env.VITE_TENANT_VENUE || "the courts of the county where the garage operates";

// Fill {{tenant_name}}, {{governing_law}}, {{venue}} and {{site}} in legal markdown.
export function fillTenant(markdown: string): string {
  const site = SITE_URL
    ? SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : "the garage's website";
  return markdown
    .replaceAll("{{tenant_name}}", TENANT_NAME)
    .replaceAll("{{governing_law}}", GOVERNING_LAW)
    .replaceAll("{{venue}}", VENUE)
    .replaceAll("{{site}}", site);
}
