import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/services/__integration__/*.test.ts"],
    globals: true,
    setupFiles: ["src/services/__integration__/setup.ts"],
    // Set CYPRESS before any module is imported (ES import hoisting
    // means process.env assignments inside setup.ts run AFTER imports).
    env: { CYPRESS: "true" },
    // Run sequentially — each test suite truncates tables
    sequence: { concurrent: false },
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
