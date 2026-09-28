// The kernel's probe entry for this pack (it expects one probes/*.mjs): runs checks/live/ through
// vitest and exits with its code. The checks themselves live in checks/live/*.test.ts.
import { spawnSync } from "node:child_process"

process.exit(spawnSync("node_modules/.bin/vitest", ["run", "--config", "vitest.live.config.ts"], { cwd: new URL("..", import.meta.url), stdio: "inherit" }).status ?? 1)
