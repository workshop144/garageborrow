// Service worker entry: route registration, the per-user API cache plugin,
// and the push / notificationclick / install / activate handlers. Workbox is
// mocked and `self` is replaced with a stub that records listeners.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const wb = vi.hoisted(() => ({
  precached: [] as unknown[],
  routes: [] as Array<{ match: (i: { url: URL; request: Request }) => boolean; handler: unknown }>,
}));

vi.mock("workbox-precaching", () => ({
  precacheAndRoute: (m: unknown) => {
    wb.precached.push(m);
  },
}));
vi.mock("workbox-routing", () => ({
  registerRoute: (match: (i: { url: URL; request: Request }) => boolean, handler: unknown) => {
    wb.routes.push({ match, handler });
  },
}));
vi.mock("workbox-strategies", () => {
  class Strategy {
    constructor(public opts: { cacheName: string; plugins?: unknown[] }) {}
  }
  class NetworkFirst extends Strategy {}
  class CacheFirst extends Strategy {}
  return { NetworkFirst, CacheFirst };
});
vi.mock("workbox-expiration", () => ({
  ExpirationPlugin: class {
    constructor(public opts: unknown) {}
  },
}));

type Handler = (event: unknown) => void;

interface FakeClient {
  focus?: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

const listeners = new Map<string, Handler>();
const fakeSelf = {
  __WB_MANIFEST: [{ url: "/index.html", revision: "abc" }],
  location: { origin: "https://app.example" },
  addEventListener: (type: string, fn: Handler) => listeners.set(type, fn),
  registration: { showNotification: vi.fn(() => Promise.resolve()) },
  clients: {
    matchAll: vi.fn<() => Promise<FakeClient[]>>(() => Promise.resolve([])),
    openWindow: vi.fn(() => Promise.resolve(null)),
    claim: vi.fn(() => Promise.resolve()),
  },
  skipWaiting: vi.fn(() => Promise.resolve()),
};

beforeAll(async () => {
  vi.stubGlobal("self", fakeSelf);
  await import("../sw");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fakeSelf.registration.showNotification.mockClear();
  fakeSelf.clients.matchAll.mockReset();
  fakeSelf.clients.matchAll.mockResolvedValue([]);
  fakeSelf.clients.openWindow.mockClear();
  fakeSelf.clients.claim.mockClear();
  fakeSelf.skipWaiting.mockClear();
});

function fire(type: string, event: Record<string, unknown>): Promise<unknown> {
  let pending: Promise<unknown> = Promise.resolve();
  const handler = listeners.get(type);
  if (!handler) throw new Error(`no ${type} listener`);
  handler({
    ...event,
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  return pending;
}

function pushEvent(data: { json: () => unknown; text: () => string } | null) {
  return { data };
}

function clickEvent(data: unknown) {
  const close = vi.fn();
  return { event: { notification: { close, data } }, close };
}

function jwt(sub: string): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64({ sub })}.sig`;
}

describe("sw registration", () => {
  it("precaches the injected manifest", () => {
    expect(wb.precached).toEqual([fakeSelf.__WB_MANIFEST]);
  });

  it("registers api, image, static-image and static-asset routes with the right matchers", () => {
    const names = wb.routes.map(
      (r) => (r.handler as { opts: { cacheName: string } }).opts.cacheName,
    );
    expect(names).toEqual(["api", "images", "static-images", "static-assets"]);
    const at = (path: string) => {
      const url = new URL(path, "https://app.example");
      const request = new Request(url);
      return wb.routes.map((r) => r.match({ url, request }));
    };
    expect(at("/v1/me")).toEqual([true, false, false, false]);
    expect(at("/img/tool.webp")).toEqual([false, true, true, false]);
    expect(at("/icon-192.png")).toEqual([false, false, true, false]);
    expect(at("/assets/app.js")).toEqual([false, false, false, true]);
    expect(at("/assets/fonts/inter.woff2")).toEqual([false, false, false, true]);
    expect(at("/about")).toEqual([false, false, false, false]);
  });

  describe("api identity plugin", () => {
    type Plugin = {
      cacheKeyWillBeUsed: (i: { request: Request }) => Promise<string>;
      cacheWillUpdate: (i: { request: Request; response: Response }) => Promise<Response | null>;
    };
    const plugin = (): Plugin => {
      const api = wb.routes[0]?.handler as { opts: { plugins: unknown[] } };
      return api.opts.plugins[0] as Plugin;
    };
    const authed = (sub: string) =>
      new Request("https://app.example/v1/me", {
        headers: { Authorization: `Bearer ${jwt(sub)}` },
      });
    const anon = () => new Request("https://app.example/v1/me");

    it("keys cached API responses by the token subject", async () => {
      const a = await plugin().cacheKeyWillBeUsed({ request: authed("user-a") });
      const b = await plugin().cacheKeyWillBeUsed({ request: authed("user-b") });
      expect(a).toContain("__sw_user=user-a");
      expect(b).toContain("__sw_user=user-b");
    });

    it("looks up unauthenticated requests under a key nothing is stored at", async () => {
      await expect(plugin().cacheKeyWillBeUsed({ request: anon() })).resolves.toBe(
        "https://app.example/v1/me#__sw_uncached",
      );
    });

    it("only stores OK responses for authenticated requests", async () => {
      const ok = new Response("{}", { status: 200 });
      await expect(plugin().cacheWillUpdate({ request: authed("u"), response: ok })).resolves.toBe(
        ok,
      );
      await expect(
        plugin().cacheWillUpdate({ request: anon(), response: new Response("{}") }),
      ).resolves.toBeNull();
      await expect(
        plugin().cacheWillUpdate({
          request: authed("u"),
          response: new Response("{}", { status: 500 }),
        }),
      ).resolves.toBeNull();
    });
  });
});

describe("push", () => {
  it("ignores pushes with no data", () => {
    const handler = listeners.get("push");
    const waitUntil = vi.fn();
    handler?.({ data: null, waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fakeSelf.registration.showNotification).not.toHaveBeenCalled();
  });

  it("shows the JSON payload's title, body and data", async () => {
    await fire(
      "push",
      pushEvent({
        json: () => ({
          title: "Due back",
          body: "Return the drill",
          data: { url: "/me", type: "loan_due" },
        }),
        text: () => "",
      }),
    );
    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith("Due back", {
      body: "Return the drill",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: "/me", type: "loan_due" },
    });
  });

  it("defaults the title, body and data when the JSON omits them", async () => {
    await fire("push", pushEvent({ json: () => null, text: () => "" }));
    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith("Garage Borrow", {
      body: "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: {},
    });
  });

  it("falls back to the raw text as the body when the payload is not JSON", async () => {
    await fire(
      "push",
      pushEvent({
        json: () => {
          throw new SyntaxError("bad json");
        },
        text: () => "plain words",
      }),
    );
    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      "Garage Borrow",
      expect.objectContaining({ body: "plain words", data: {} }),
    );
  });
});

describe("notificationclick", () => {
  it("closes the notification and opens the inbox when no window is open", async () => {
    const { event, close } = clickEvent(undefined);
    await fire("notificationclick", event);
    expect(close).toHaveBeenCalled();
    expect(fakeSelf.clients.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith("/me/notifications");
  });

  it("opens the payload's url when no window is open", async () => {
    const { event } = clickEvent({ url: "/g/demo-garage/tools/item-1" });
    await fire("notificationclick", event);
    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith("/g/demo-garage/tools/item-1");
  });

  it("focuses and navigates an existing window instead of opening a new one", async () => {
    const client = {
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(() => Promise.resolve()),
    };
    fakeSelf.clients.matchAll.mockResolvedValue([client]);
    const { event } = clickEvent({ url: "/me/stuff" });
    await fire("notificationclick", event);
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith("/me/stuff");
    expect(fakeSelf.clients.openWindow).not.toHaveBeenCalled();
  });

  it("keeps the focused window when navigate throws", async () => {
    const client = {
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(() => Promise.reject(new TypeError("cross-origin"))),
    };
    fakeSelf.clients.matchAll.mockResolvedValue([client]);
    const { event } = clickEvent({ url: "/me/stuff" });
    await expect(fire("notificationclick", event)).resolves.toBeUndefined();
    expect(client.focus).toHaveBeenCalled();
    expect(fakeSelf.clients.openWindow).not.toHaveBeenCalled();
  });

  it("focuses a client without navigate and skips clients that cannot focus", async () => {
    const noFocus = {};
    const focusOnly = { focus: vi.fn(() => Promise.resolve()) };
    fakeSelf.clients.matchAll.mockResolvedValue([noFocus, focusOnly]);
    const { event } = clickEvent({ url: "/me/stuff" });
    await fire("notificationclick", event);
    expect(focusOnly.focus).toHaveBeenCalled();
    expect(fakeSelf.clients.openWindow).not.toHaveBeenCalled();
  });

  it.each([
    ["https://elsewhere.example/phish", "/me/notifications"],
    ["//elsewhere.example/phish", "/me/notifications"],
    ["javascript:alert(1)", "/me/notifications"],
    ["data:text/html,hi", "/me/notifications"],
    ["https://app.example//elsewhere.example/x", "/me/notifications"],
    ["/\\elsewhere.example/x", "/me/notifications"],
    ["https://app.example/loans/l-1?x=1#top", "/loans/l-1?x=1#top"],
    ["/loans/l-1", "/loans/l-1"],
  ])("opens only same-origin paths: %s -> %s", async (url, expected) => {
    const { event } = clickEvent({ url });
    await fire("notificationclick", event);
    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith(expected);
  });

  it("never navigates an open tab off-origin", async () => {
    const tab = { focus: vi.fn(() => Promise.resolve()), navigate: vi.fn(() => Promise.resolve()) };
    fakeSelf.clients.matchAll.mockResolvedValue([tab]);
    const { event } = clickEvent({ url: "https://elsewhere.example/phish" });
    await fire("notificationclick", event);
    expect(tab.navigate).toHaveBeenCalledWith("/me/notifications");
  });
});

describe("lifecycle", () => {
  it("skips waiting on install", () => {
    listeners.get("install")?.({});
    expect(fakeSelf.skipWaiting).toHaveBeenCalled();
  });

  it("claims clients on activate", async () => {
    await fire("activate", {});
    expect(fakeSelf.clients.claim).toHaveBeenCalled();
  });
});
