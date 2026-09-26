// The reproducible `qwbe check` run for this pack, against the SDK as an INSTALL (T-1452, B4).
//
//   npm run test:check                 # both invocations, in order
//   QWBE_REPO=<qwbe> npm run test:check
//
// It lives under `test/` and not `tools/` on purpose: `test/` is a top-level entry BOTH staging
// filters drop (this runner's own `copyFilter`, and the kernel's `package-source.ts`
// `LOCAL_SOURCE_DIRECTORIES`), so a script that spawns npm and `child_process` can never become
// content of the installed plugin. `tools/` is package content and would have shipped it.
//
// Two invocations, logged separately, because they prove different things:
//
//   [native]  `qwbe check .` in this checkout. It is EXPECTED TO FAIL, at stage invocation:
//             `scripts.test` runs node --test and `qwbe-core` is `file:../../qwbe/core`. That
//             failure is the gate working. The developer loop (`npm test`, the file:
//             dependency) is therefore left exactly as it is -- this runner never edits it.
//   [sandbox] the same command against a publication-shaped COPY in a temp directory, with the
//             kernel installed as a real directory under the copy's own node_modules (the
//             fixture shape probes/check-command.mjs proves, never a symlink -- npm link is
//             what stage invocation refuses). All four stages must pass.
//
// A sandbox pass is NOT a release-ready claim: nothing is published, no registry is contacted,
// the version staged is the kernel's own, and the native gates this repo runs (npm test,
// typecheck, lint) are unaffected and still have to pass on their own.
//
// Side effects, all of them:
//   1. it writes one mkdtemp directory under the OS temp dir and removes it (guarded by
//      isOwnSandbox);
//   2. it builds `core/dist` in the qwbe checkout when absent -- which compiles whatever state
//      that checkout is in, uncommitted work included;
//   3. the checker it spawns creates and drops its own `qwbe_check_<hex>` Postgres database;
//   4. the checker's own scratch mount does NOT go to /tmp. `check-package.ts` picks
//      `mkdtemp(kernelRoot()/.qwbe-check-)` whenever it is running as a CHECKOUT, and it is: the
//      bin spawned below is `<qwbe>/core/bin/qwbe.mjs`, outside node_modules, so `installed` is
//      false. Every run therefore leaves a `<qwbe>/core/.qwbe-check-*` directory behind if the
//      checker is killed, and that path is in the qwbe checkout, not in a temp dir.
// It never touches the live data dir, the live database, or the running instance on
// 4500/4510/4520 -- no `QWBE_*` variable naming any of them reaches the child (see `checkEnv`).
//
// What the child is NOT given: `QWBE_REPO`. It is an input to THIS file (finding the kernel bin,
// building dist/) and stops here. A probe written against a checkout must have no repo to aim at;
// the pack's one probe (`probes/crm.mjs`) takes `QWBE_URL` from the checker instead.

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  checkEnv,
  copyFilter,
  describeEnv,
  isOwnSandbox,
  publicationPackageJson,
  redactSecrets,
  SANDBOX_PREFIX,
} from "./sdk-check-lib.mjs"

const PACK = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const QWBE_REPO = resolve(process.env.QWBE_REPO ?? join(PACK, "..", "..", "qwbe"))
const CORE = join(QWBE_REPO, "core")
const BIN = join(CORE, "bin", "qwbe.mjs")
const TIMEOUT = 300_000

const die = (message) => {
  console.error(`\nsdk-check: ${message}`)
  process.exit(1)
}

if (!existsSync(BIN)) die(`no kernel bin at ${BIN} -- set QWBE_REPO to the qwbe checkout`)

// --- core/dist is a prerequisite, not an optional nicety ----------------------------------------
// An installed kernel boots from dist/ (node refuses type stripping under node_modules) and the
// mounted pack resolves `qwbe-core/*` through the qwbe-dist condition. Without dist/ the sandbox
// check fails for a reason that has nothing to do with this pack.
const buildDist = () => {
  if (existsSync(join(CORE, "dist", "cube-contract.js"))) return "already built"
  const built = spawnSync("npm", ["run", "build"], { cwd: CORE, encoding: "utf8", timeout: TIMEOUT })
  if (built.status !== 0) die(`core/dist build failed (exit ${built.status})\n${built.stdout ?? ""}${built.stderr ?? ""}`)
  return "built now"
}

/** The kernel as an install: a real directory holding exactly the package.json `files` list,
 *  plus a symlink to the kernel's own node_modules for its runtime dependencies. The PACKAGE
 *  itself is never a symlink -- that is the npm-link shape stage invocation must refuse. */
const installKernel = (sandbox) => {
  const dest = join(sandbox, "node_modules", "qwbe-core")
  mkdirSync(dirname(dest), { recursive: true })
  for (const entry of ["bin", "src", "dist", "package.json", "qwbe.config.json"]) {
    const from = join(CORE, entry)
    if (!existsSync(from)) die(`the kernel checkout is missing ${entry}`)
    cpSync(from, join(dest, entry), { recursive: true, filter: (s) => !s.includes("node_modules") })
  }
  symlinkSync(join(CORE, "node_modules"), join(dest, "node_modules"))
  return dest
}

/** The publication-shaped copy. The checkout's own package.json is READ and never written. */
const stage = (sdkVersion) => {
  const sandbox = mkdtempSync(join(tmpdir(), SANDBOX_PREFIX))
  cpSync(PACK, sandbox, { recursive: true, filter: copyFilter(PACK), dereference: false })
  const native = JSON.parse(readFileSync(join(PACK, "package.json"), "utf8"))
  writeFileSync(
    join(sandbox, "package.json"),
    `${JSON.stringify(publicationPackageJson(native, sdkVersion), null, 2)}\n`,
  )
  installKernel(sandbox)
  return sandbox
}

const runCheck = (dir, env) =>
  spawnSync(process.execPath, [BIN, "check", dir], { cwd: dir, encoding: "utf8", timeout: TIMEOUT, env })

/** The checker's output is relayed, not summarised -- but through the redactor, so a probe that
 *  echoes a connection URL does not put a password on the terminal or in a captured log. */
const report = (label, run, secrets) => {
  console.log(`\n===== [${label}] node ${BIN} check <dir> =====`)
  process.stdout.write(redactSecrets(run.stdout ?? "", secrets))
  if (run.stderr) process.stderr.write(redactSecrets(run.stderr, secrets))
  console.log(`----- [${label}] exit ${run.status}${run.signal ? ` (signal ${run.signal})` : ""} -----`)
  return run.status
}

let sandbox
try {
  const env = checkEnv(process.env)
  // Everything the redactor is told to hide. It is a string filter over the relay, not a logger:
  // a secret that is not in this list is not caught.
  const secrets = [env.QWBE_PG_PASSWORD, process.env.QWBE_PG_PASSWORD, process.env.QWBE_DATABASE_URL].filter(
    (s) => typeof s === "string" && s.length > 0,
  )
  const sdkVersion = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).version
  console.log(`sdk-check: kernel ${QWBE_REPO} version ${sdkVersion}; core/dist ${buildDist()}`)
  console.log(`sdk-check: ${describeEnv(env)}; the checker creates and drops its own qwbe_check_* database`)

  // --- [native] the developer checkout: the gate is EXPECTED to refuse it --------------------
  const native = report("native", runCheck(PACK, env), secrets)
  const nativeRefused = native !== 0
  console.log(
    nativeRefused
      ? "[native] EXPECTED FAIL: the checkout is not a publication shape (scripts.test + file: dependency). The gate is strict; nothing was relaxed."
      : "[native] UNEXPECTED PASS: the checkout passed the invocation gate, which means the gate stopped being strict.",
  )

  // --- [sandbox] the publication shape: all four stages must pass ---------------------------
  sandbox = stage(sdkVersion)
  console.log(`\n[sandbox] staged at ${sandbox} (publication package.json, qwbe-core ${sdkVersion}, no file:/link:)`)
  const sandboxStatus = report("sandbox", runCheck(sandbox, env), secrets)

  const ok = nativeRefused && sandboxStatus === 0
  console.log(
    `\nsdk-check: native ${nativeRefused ? "FAIL (expected)" : "PASS (NOT expected)"}, sandbox ${sandboxStatus === 0 ? "PASS (4/4 stages)" : `FAIL (exit ${sandboxStatus})`}`,
  )
  console.log("sdk-check: a sandbox pass is evidence of the SDK surface only -- NOT release-ready, nothing published.")
  process.exitCode = ok ? 0 : 1
} finally {
  // Only ever the directory this process made. A path the guard rejects is reported, not removed.
  if (sandbox !== undefined) {
    if (isOwnSandbox(sandbox)) rmSync(sandbox, { recursive: true, force: true })
    else console.error(`sdk-check: REFUSING to remove ${sandbox} -- it is not a sandbox this runner created`)
  }
}
