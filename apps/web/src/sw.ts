/// <reference lib="webworker" />

// Service worker entry. We use vite-plugin-pwa's injectManifest strategy so
// we can wire up `push` and `notificationclick` handlers that the
// workbox-generated SW doesn't surface. Workbox precaching still happens —
// `self.__WB_MANIFEST` is replaced at build time with the precache list and
// the workbox runtime takes over from there.

import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

// ExpirationPlugin's runtime shape is correct but its declared interface
// uses optional methods that conflict with `exactOptionalPropertyTypes` —
// cast to the strategy plugin type so construction stays clean at the call
// site without disabling the project-wide compiler flag.
type StrategyPlugins = ConstructorParameters<typeof NetworkFirst>[0] extends {
  plugins?: Array<infer P>;
}
  ? P
  : never;
const expirationPlugin = (opts: { maxEntries?: number; maxAgeSeconds?: number }): StrategyPlugins =>
  new ExpirationPlugin(opts) as unknown as StrategyPlugins;

interface MatchInput {
  url: URL;
  request: Request;
}
type RouteCb = (input: MatchInput) => boolean;

registerRoute(
  (({ url }: MatchInput) => url.pathname.startsWith("/v1/")) as RouteCb,
  new NetworkFirst({
    cacheName: "api",
    networkTimeoutSeconds: 5,
    plugins: [expirationPlugin({ maxAgeSeconds: 60 * 5, maxEntries: 50 })],
  }),
);

registerRoute(
  (({ url }: MatchInput) => url.pathname.startsWith("/img/")) as RouteCb,
  new CacheFirst({
    cacheName: "images",
    plugins: [expirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

registerRoute(
  (({ request }: MatchInput) => /\.(?:png|jpg|jpeg|webp|svg|ico)$/.test(request.url)) as RouteCb,
  new CacheFirst({
    cacheName: "static-images",
    plugins: [expirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

registerRoute(
  (({ request }: MatchInput) => /\.(?:js|css|woff2)$/.test(request.url)) as RouteCb,
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [expirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

interface PushPayload {
  title?: string;
  body?: string;
  data?: { url?: string; type?: string } & Record<string, unknown>;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: PushPayload = {};
  try {
    payload = (event.data.json() as PushPayload) ?? {};
  } catch {
    payload = { body: event.data.text() };
  }
  const title = payload.title ?? "Garage Borrow";
  const body = payload.body ?? "";
  const data = payload.data ?? {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  const target = data.url ?? "/me/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        // Reuse an existing tab if we already have one open at any path —
        // navigating it is friendlier than spawning a new tab on every push.
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              // Cross-origin navigates can throw; ignore and stick with the
              // existing tab's URL.
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
