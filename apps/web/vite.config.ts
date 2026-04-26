import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const tenantName = env.VITE_TENANT_NAME ?? "Demo Garage";
  const tenantShort = env.VITE_TENANT_SHORT_NAME ?? "Garage";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "icon-source.svg",
          "icon-32-favicon.png",
          "icon-180-apple.png",
          "offline.html",
        ],
        manifest: {
          name: tenantName,
          short_name: tenantShort,
          description: "Lend what you have. Borrow what you need.",
          theme_color: "#E8B833",
          background_color: "#FAF7F0",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icon-maskable-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          navigateFallback: "/offline.html",
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          runtimeCaching: [
            {
              urlPattern: /\/v1\//,
              handler: "NetworkFirst",
              options: {
                cacheName: "api",
                networkTimeoutSeconds: 5,
                expiration: { maxAgeSeconds: 60 * 5, maxEntries: 50 },
              },
            },
            {
              urlPattern: /\/img\//,
              handler: "CacheFirst",
              options: {
                cacheName: "images",
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /\.(?:png|jpg|jpeg|webp|svg|ico)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "static-images",
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /\.(?:js|css|woff2)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "static-assets",
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
  };
});
