import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ["src/__tests__/_global-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
