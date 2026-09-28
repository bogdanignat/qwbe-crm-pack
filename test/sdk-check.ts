// Entry point: `npm run test:check` (or `QWBE_REPO=<qwbe> node test/sdk-check.ts`). The reproducible
// `qwbe check` run for this pack against the SDK as an INSTALL (T-1452, B4). Exit 0 only when
// [native] failed as expected and [sandbox] passed.
//
// It lives under `test/`, not `tools/`: `test/` is dropped by both staging filters (this runner's
// copyFilter and the kernel's LOCAL_SOURCE_DIRECTORIES), so a script that spawns npm can never
// become content of the installed plugin; it stays with the pack's tests (`test/`, never packaged).
//
//   [native]  `qwbe check` on this checkout. EXPECTED TO FAIL at stage invocation (the developer
//             test script, `qwbe-core: file:`): the gate working. The developer loop is left as is.
//   [sandbox] the same command on a publication-shaped copy in a temp dir, the kernel installed
//             as a real directory under its node_modules. All four stages must pass.
// A sandbox pass is NOT release-ready: nothing is published, the version staged is the kernel's own.
//
// Side effects: one temp dir under the OS temp dir, removed only through removeOwnSandbox; core/dist
// built in the qwbe checkout when absent (whatever state it is in); the checker's own
// `qwbe_check_<hex>` database; and, since the bin runs as a CHECKOUT, a `<qwbe>/core/.qwbe-check-*`
// scratch dir left behind if the checker is killed. Never the live data dir, database or instance:
// no `QWBE_*` naming them reaches the child (checkEnv), QWBE_REPO included.
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { QWBE_REPO } from "../checks/_layers/kernel.ts"
import { Refused, runTool } from "../tools/shared/run-tool.ts"
import { checkEnv, describeEnv, redactSecrets } from "./sdk-check-env.ts"
import { buildDist, report, runCheck } from "./sdk-check-run.ts"
import { stageSandbox } from "./sdk-check-sandbox.ts"

const PACK = resolve(fileURLToPath(new URL("..", import.meta.url)))

const KernelPackage = Schema.parseJson(Schema.Struct({ version: Schema.optional(Schema.String) }))

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const repo = resolve(yield* QWBE_REPO)
  const core = join(repo, "core")
  const bin = join(core, "bin", "qwbe.mjs")
  if (!(yield* fs.exists(bin)))
    return yield* new Refused({ message: `\nsdk-check: no kernel bin at ${bin} -- set QWBE_REPO to the qwbe checkout`, code: 1 })

  const env = yield* checkEnv(process.env)
  // Everything the redactor is told to hide; a secret not in this list is not caught.
  const secrets = [env.QWBE_PG_PASSWORD, process.env.QWBE_PG_PASSWORD, process.env.QWBE_DATABASE_URL].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  )
  const { version } = yield* Schema.decodeUnknown(KernelPackage)(yield* fs.readFileString(join(core, "package.json")))
  // A failed build carries npm's whole output in its message: it goes through the same redactor.
  const dist = yield* buildDist(core).pipe(
    Effect.catchTag("BuildFailed", (error) =>
      new Refused({ message: redactSecrets(`\nsdk-check: ${error.message}`, secrets), code: 1 })),
  )
  yield* Console.log(`sdk-check: kernel ${repo} version ${version}; core/dist ${dist}`)
  yield* Console.log(`sdk-check: ${describeEnv(env)}; the checker creates and drops its own qwbe_check_* database`)

  const nativeRefused = (yield* report("native", bin, yield* runCheck(bin, PACK, env), secrets)) !== 0
  yield* Console.log(
    nativeRefused
      ? "[native] EXPECTED FAIL: the checkout is not a publication shape (scripts.test + file: dependency). The gate is strict; nothing was relaxed."
      : "[native] UNEXPECTED PASS: the checkout passed the invocation gate, which means the gate stopped being strict.",
  )

  const sandboxStatus = yield* Effect.scoped(
    Effect.gen(function* () {
      const sandbox = yield* stageSandbox(PACK, core, version)
      yield* Console.log(`\n[sandbox] staged at ${sandbox} (publication package.json, qwbe-core ${version}, no file:/link:)`)
      return yield* report("sandbox", bin, yield* runCheck(bin, sandbox, env), secrets)
    }),
  )

  yield* Console.log(
    `\nsdk-check: native ${nativeRefused ? "FAIL (expected)" : "PASS (NOT expected)"}, sandbox ${sandboxStatus === 0 ? "PASS (4/4 stages)" : `FAIL (exit ${sandboxStatus})`}`,
  )
  yield* Console.log("sdk-check: a sandbox pass is evidence of the SDK surface only -- NOT release-ready, nothing published.")
  return nativeRefused && sandboxStatus === 0 ? 0 : 1
})

runTool(program, "\nsdk-check: ")
