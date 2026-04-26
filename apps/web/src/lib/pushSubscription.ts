// Web-push subscription helpers. The first time a user borrows, we surface
// the browser permission prompt with a short rationale and — if they accept
// — register a PushSubscription against our service worker and POST the
// (endpoint, keys) tuple back to the api so the notifier can target this
// device.

import { api } from "./api";

const PROMPT_FLAG_KEY = "gb.push.promptShown";

export type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function getPermissionState(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission as PermissionState;
}

export function hasPromptBeenShown(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPromptShown(): void {
  try {
    window.localStorage.setItem(PROMPT_FLAG_KEY, "1");
  } catch {
    // Ignore — private mode storage failures are non-fatal here.
  }
}

interface HealthResponse {
  vapid_public_key?: string;
}

export async function fetchVapidPublicKey(): Promise<string | undefined> {
  try {
    const res = await api.get<HealthResponse>("/health");
    return res.vapid_public_key && res.vapid_public_key.length > 0
      ? res.vapid_public_key
      : undefined;
  } catch {
    return undefined;
  }
}

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export interface SubscribeResult {
  status: "granted-subscribed" | "granted-no-vapid" | "denied" | "default" | "unsupported";
}

// Single-call wrapper used by the borrow flow. Bails out gracefully when
// the browser doesn't support push at all (Safari < 16, embedded browsers).
export async function ensurePushSubscription(): Promise<SubscribeResult> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { status: "unsupported" };
  }
  const before = window.Notification.permission;
  let perm: NotificationPermission = before;
  if (before === "default") {
    perm = await window.Notification.requestPermission();
  }
  if (perm === "denied") return { status: "denied" };
  if (perm === "default") return { status: "default" };

  const vapid = await fetchVapidPublicKey();
  if (!vapid) return { status: "granted-no-vapid" };

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(vapid),
    });
  }
  const json = subscription.toJSON();
  if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
    await api.post("/me/push-subscription", {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  }
  return { status: "granted-subscribed" };
}

// Called when a push lands in-app (or after marking notifications read) to
// keep the OS-level app icon badge in sync with our unread count.
export async function syncAppBadge(unreadCount: number): Promise<void> {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (unreadCount > 0 && nav.setAppBadge) {
      await nav.setAppBadge(unreadCount);
    } else if (nav.clearAppBadge) {
      await nav.clearAppBadge();
    }
  } catch {
    // Badging API is opportunistic — failures shouldn't surface to the user.
  }
}
