import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensurePushSubscription,
  fetchVapidPublicKey,
  getPermissionState,
  hasPromptBeenShown,
  markPromptShown,
  syncAppBadge,
} from "../pushSubscription";

type Perm = "default" | "granted" | "denied";

const SUB_JSON = {
  endpoint: "https://push.example.test/sub/1",
  keys: { p256dh: "p256", auth: "authk" },
};

let fetchCalls: Array<{ url: string; init?: RequestInit }>;

function stubApi(vapid: string | undefined | Error): void {
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/health")) {
        if (vapid instanceof Error) return Promise.reject(vapid);
        return Promise.resolve(
          new Response(JSON.stringify(vapid === undefined ? {} : { vapid_public_key: vapid }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
}

function installPush(opts: { perm: Perm; ask?: Perm; existing?: boolean }) {
  const requestPermission = vi.fn(() => Promise.resolve(opts.ask ?? opts.perm));
  vi.stubGlobal("Notification", { permission: opts.perm, requestPermission });
  vi.stubGlobal("PushManager", function PushManager() {});
  const sub = { toJSON: () => SUB_JSON };
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(opts.existing ? sub : null)),
    subscribe: vi.fn(() => Promise.resolve(sub)),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  return { requestPermission, pushManager };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no serviceWorker; remove the stub so "unsupported" tests see that.
  delete (navigator as unknown as Record<string, unknown>)["serviceWorker"];
});

describe("permission helpers", () => {
  it("reports unsupported without the Notification API", () => {
    vi.stubGlobal("Notification", undefined);
    delete (window as unknown as Record<string, unknown>)["Notification"];
    expect(getPermissionState()).toBe("unsupported");
  });

  it("reads the current permission", () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    expect(getPermissionState()).toBe("denied");
  });

  it("remembers that the prompt was shown", () => {
    expect(hasPromptBeenShown()).toBe(false);
    markPromptShown();
    expect(hasPromptBeenShown()).toBe(true);
  });

  it("treats blocked storage as not shown and does not throw on write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(hasPromptBeenShown()).toBe(false);
    expect(() => markPromptShown()).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("fetchVapidPublicKey", () => {
  it("returns the key, or undefined when empty, missing or the call fails", async () => {
    stubApi("BKey");
    expect(await fetchVapidPublicKey()).toBe("BKey");
    stubApi("");
    expect(await fetchVapidPublicKey()).toBeUndefined();
    stubApi(undefined);
    expect(await fetchVapidPublicKey()).toBeUndefined();
    stubApi(new Error("offline"));
    expect(await fetchVapidPublicKey()).toBeUndefined();
  });
});

describe("ensurePushSubscription", () => {
  it("is unsupported without service workers", async () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    expect(await ensurePushSubscription()).toEqual({ status: "unsupported" });
  });

  it("asks once when permission is default and stops on denial", async () => {
    stubApi("BKey");
    const { requestPermission, pushManager } = installPush({ perm: "default", ask: "denied" });
    expect(await ensurePushSubscription()).toEqual({ status: "denied" });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns default when the prompt is dismissed", async () => {
    stubApi("BKey");
    installPush({ perm: "default", ask: "default" });
    expect(await ensurePushSubscription()).toEqual({ status: "default" });
  });

  it("does not subscribe when the server has no VAPID key", async () => {
    stubApi("");
    const { pushManager } = installPush({ perm: "granted" });
    expect(await ensurePushSubscription()).toEqual({ status: "granted-no-vapid" });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes with the decoded VAPID key and registers the endpoint", async () => {
    // "AQID-_8" is base64url for bytes 01 02 03 fb ff
    stubApi("AQID-_8");
    const { requestPermission, pushManager } = installPush({ perm: "granted" });
    expect(await ensurePushSubscription()).toEqual({ status: "granted-subscribed" });
    expect(requestPermission).not.toHaveBeenCalled();
    const arg = pushManager.subscribe.mock.calls[0] as unknown as [
      { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer },
    ];
    expect(arg[0].userVisibleOnly).toBe(true);
    expect(Array.from(new Uint8Array(arg[0].applicationServerKey))).toEqual([1, 2, 3, 0xfb, 0xff]);
    const post = fetchCalls.find((c) => c.url.endsWith("/me/push-subscription"));
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual(SUB_JSON);
  });

  it("reuses an existing subscription", async () => {
    stubApi("BKey");
    const { pushManager } = installPush({ perm: "granted", existing: true });
    expect(await ensurePushSubscription()).toEqual({ status: "granted-subscribed" });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("syncAppBadge", () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)["setAppBadge"];
    delete (navigator as unknown as Record<string, unknown>)["clearAppBadge"];
  });

  function badge(fail = false) {
    const set = vi.fn(() => (fail ? Promise.reject(new Error("x")) : Promise.resolve()));
    const clear = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "setAppBadge", { configurable: true, value: set });
    Object.defineProperty(navigator, "clearAppBadge", { configurable: true, value: clear });
    return { set, clear };
  }

  it("sets the count when there are unread items and clears at zero", async () => {
    const { set, clear } = badge();
    await syncAppBadge(3);
    expect(set).toHaveBeenCalledWith(3);
    await syncAppBadge(0);
    expect(clear).toHaveBeenCalled();
  });

  it("swallows Badging API failures", async () => {
    badge(true);
    await expect(syncAppBadge(2)).resolves.toBeUndefined();
  });
});
