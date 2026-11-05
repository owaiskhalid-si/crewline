import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts", "apps/web/src/**/*.test.ts", "apps/mobile/src/**/*.test.ts"] },
});
