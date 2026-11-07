import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the sources: after `pnpm build`, dist/__tests__ holds compiled
    // copies of every test, which used to run a second time.
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      reporter: ["text-summary", "json-summary"],
      // Floors just under the 2026-11-06 numbers; raise them as coverage grows.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
