import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/services/__integration__/*.test.ts"],
    globals: true,
    globalSetup: ["scripts/pglite-global-setup.ts"],
    setupFiles: ["src/services/__integration__/setup.ts"],
    env: {
      CYPRESS: "true",
      DATABASE_URL_TEST_UNPOOLED: "postgres://localhost:5488/postgres?search_path=test",
    },
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
