import { defineConfig } from "vitest/config"

// Each live file boots real servers over its own Postgres database, so files must not compete
// for CPU or connections, and a boot may take a while.
export default defineConfig({
  test: {
    include: ["checks/live/**/*.test.ts"],
    isolate: true,
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
})
