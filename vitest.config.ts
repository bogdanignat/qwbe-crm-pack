import { defineConfig } from "vitest/config"

// Kernel-style isolation: each test file gets its own module graph, so env set before an import holds.
export default defineConfig({
  test: {
    include: [
      "tools/**/*.test.ts",
      "checks/_layers/**/*.test.ts",
      "checks/unit/**/*.test.ts",
      "checks/integration/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    isolate: true,
  },
})
