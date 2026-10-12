import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [".research/**", "node_modules/**", "dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 4,
  },
});
