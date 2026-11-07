import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/__tests__/**", "src/test/**", "src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      // Floors just under the 2026-11-06 numbers (69.5/61.1/64.9/71.7 after the
      // coverage push); raise them as coverage grows.
      thresholds: { statements: 68, branches: 59, functions: 63, lines: 70 },
    },
  },
});
