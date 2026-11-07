import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ["src/__tests__/_global-setup.ts"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
      reporter: ["text-summary", "json-summary"],
      // Floors just under the 2026-11-06 numbers; raise them as coverage grows.
      thresholds: { statements: 88, branches: 75, functions: 91, lines: 92 },
    },
  },
});
