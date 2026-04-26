import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon-source.svg", "icon-32-favicon.png", "icon-180-apple.png"],
      manifest: {
        name: "Demo Garage",
        short_name: "Garage",
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
        runtimeCaching: [
          {
            urlPattern: /\/v1\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api",
              expiration: { maxAgeSeconds: 60 * 5 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|svg)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
});
