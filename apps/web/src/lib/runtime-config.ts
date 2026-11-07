// Deploy-time configuration the build cannot know: the API Gateway URL and the
// Cognito pool and client ids exist only once `sam deploy` has run, and the
// deploy job that can read them runs no repo code (S4-3). So the deploy job
// writes them to /config.json from the stack outputs, and the app loads that
// file before it renders (2026-11-07 review F2). Local dev and tests have no
// config.json and fall back to the VITE_* build variables.

export interface RuntimeConfig {
  apiBaseUrl?: string;
  userPoolId?: string;
  userPoolClientId?: string;
}

const STORAGE_KEY = "gb:runtime-config";

// Only values of the expected shape are used: an https API origin with no
// path, query or credentials, and Cognito-shaped ids.
const API_ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i;
const POOL_ID_RE = /^[a-z]{2}(?:-[a-z]+)+-\d_[A-Za-z0-9]+$/;
const CLIENT_ID_RE = /^[A-Za-z0-9]{1,128}$/;

let current: RuntimeConfig = {};

export function sanitizeRuntimeConfig(raw: unknown): RuntimeConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: RuntimeConfig = {};
  if (typeof r.apiBaseUrl === "string") {
    const v = r.apiBaseUrl.replace(/\/+$/, "");
    if (API_ORIGIN_RE.test(v)) out.apiBaseUrl = v;
  }
  if (typeof r.userPoolId === "string" && POOL_ID_RE.test(r.userPoolId)) {
    out.userPoolId = r.userPoolId;
  }
  if (typeof r.userPoolClientId === "string" && CLIENT_ID_RE.test(r.userPoolClientId)) {
    out.userPoolClientId = r.userPoolClientId;
  }
  return out;
}

function remembered(): RuntimeConfig {
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    return s ? sanitizeRuntimeConfig(JSON.parse(s)) : {};
  } catch {
    return {};
  }
}

function remember(cfg: RuntimeConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Storage blocked: the next start fetches it again.
  }
}

// Fetches /config.json (never from a cache). Offline, the last good config
// is used so an installed PWA still knows its API and pool.
export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  try {
    const res = await fetchImpl("/config.json", { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    // CloudFront answers a missing file with index.html (status 200).
    if (res.ok && type.includes("json")) {
      const cfg = sanitizeRuntimeConfig(await res.json());
      if (Object.keys(cfg).length > 0) {
        current = cfg;
        remember(cfg);
        return current;
      }
    }
  } catch {
    // Offline or unreachable: fall through.
  }
  current = remembered();
  return current;
}

export function setRuntimeConfigForTest(cfg: RuntimeConfig): void {
  current = cfg;
}

// The API base the client prefixes paths with ("…/v1").
export function apiBase(): string {
  if (current.apiBaseUrl) return `${current.apiBaseUrl}/v1`;
  return import.meta.env.VITE_API_BASE_URL ?? "/v1";
}

export function cognitoIds(): { userPoolId: string; clientId: string } {
  return {
    userPoolId: current.userPoolId ?? import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
    clientId: current.userPoolClientId ?? import.meta.env.VITE_COGNITO_CLIENT_ID ?? "",
  };
}
