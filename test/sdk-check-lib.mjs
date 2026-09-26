// The decisions `sdk-check.mjs` makes, separated from the side effects so each one can be
// tested without a Postgres, a kernel or a temp directory (T-1452, step B4).
//
// Four of them are safety rules, and they are the reason this file exists at all:
//
//   * `publicationPackageJson` builds the package.json the SANDBOX gets. The developer loop
//     needs `qwbe-core: file:../../qwbe/core` and `scripts.test` running node --test; the
//     invocation gate exists to refuse exactly that. So the sandbox copy is REWRITTEN, never
//     the checkout's own file, and the rewrite is proved here: canonical `qwbe check .`, the
//     real SDK version read from the kernel's package.json, and no `file:`/`link:`/`workspace:`
//     specifier anywhere in it.
//   * `checkEnv` derives the Postgres connection the checker needs to CREATE ITS OWN throwaway
//     database. It is a WHITELIST, not a filter: every inherited `QWBE_*` variable is dropped and
//     exactly the five in `CHECK_ENV_KEYS` are written back. Nothing the parent shell exports can
//     point the child at a live database, a live data dir, or either checkout -- `QWBE_REPO`
//     included, so a probe written against a checkout has no repo to aim at (the old
//     `probes/qwb31-install-lifecycle.mjs` rmtree'd `$QWBE_REPO/core/plugins/crm-pack`; it now
//     lives in `test/install-lifecycle.mjs`, runs on its own scratch root and is not a probe the
//     checker runs). It has no default password and
//     never returns the password to a caller that would print it.
//   * `redactSecrets` is what the runner puts between the checker's stdout and the terminal, so a
//     connection URL echoed by a probe does not land in a log.
//   * `isOwnSandbox` is the cleanup guard. The runner removes a directory only when this
//     function says the runner made it: under the OS temp dir, and carrying the runner's own
//     prefix. Anything else is left alone, loudly.

import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, sep } from "node:path"

/** The prefix every sandbox this runner creates carries. Cleanup keys off it. */
export const SANDBOX_PREFIX = "qwbe-crm-sdk-check-"

/** The only `scripts.test` the kernel's invocation gate accepts. */
export const CANONICAL_TEST = "qwbe check ."

/**
 * The operator's pre-ledger authorization, written out HERE as a literal and never derived from
 * the pack's manifests. The kernel refuses to boot with this pack on a database whose provenance
 * ledger has never seen the legacy cube names the pack declares a `dataMigration` from, and it is
 * explicit that "the package being checked does not get that vote"
 * (core/src/kernel/migrate-ownership.ts). Reading the three names out of each cube's `index.ts` would
 * hand the package exactly that vote, so they are typed out instead: changing this list is an
 * operator decision, visible in a diff and in the log line the runner prints.
 *
 * What it authorizes here is a no-op: the database is the one the CHECKER creates for this run and
 * drops afterwards, so it is empty and there is no legacy row to move. It is NOT an authorization
 * for any real deployment -- a live install still needs the operator to set this deliberately,
 * which is a REMAINING NATIVE GATE, not something this runner discharges.
 */
export const LEGACY_MIGRATIONS = "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack"

/** Specifier schemes that name a checkout instead of an install. The gate refuses these. */
const CHECKOUT_SCHEMES = ["file:", "link:", "workspace:", "portal:"]

/** Top-level entries that are the authoring checkout's, never the package's. The kernel's own
 *  staging filter (`package-source.ts`) drops most of them again inside the sandbox; this list
 *  is the OUTER copy's rule, so a screenshot or a Playwright trace never even reaches /tmp.
 *
 *  `test` is where THIS RUNNER lives, and that is why it lives there. The runner spawns npm and
 *  the kernel bin and reaches for `node:child_process`; under `tools/` it was package content
 *  (both filters keep `tools/`) and so an install would have shipped a build tool inside the
 *  plugin. `test` is dropped by both filters -- this one and `package-source.ts`'s
 *  `LOCAL_SOURCE_DIRECTORIES` -- so the runner cannot reach a staged package at all. */
const FOREIGN_ENTRIES = new Set([
  "node_modules",
  "frontend",
  "docs",
  "test",
  "dist",
  "build",
  "coverage",
  "package-lock.json",
])

/** A screenshot, a trace, a baseline dump: artifacts of a session, not of the package. */
const FOREIGN_PATTERN = /\.(png|jpe?g|gif|webp|zip|tgz|tar|log|sqlite|db)$/i

/**
 * Is this top-level entry of the pack checkout foreign to the package? Dotted entries are
 * foreign by rule rather than by name (`.git`, `.playwright-mcp`, `.t1450-baseline`, `.local`,
 * `.githooks`), so the next tool's directory ships no surprise either.
 */
export const isForeignEntry = (name) =>
  name.startsWith(".") || FOREIGN_ENTRIES.has(name) || FOREIGN_PATTERN.test(name)

/** `cpSync`'s filter for the outer copy: keep the root, drop every foreign TOP-LEVEL entry. */
export const copyFilter = (root) => (src) => {
  if (src === root) return true
  const rel = resolve(src).slice(resolve(root).length + 1)
  const top = rel.split(sep)[0] ?? ""
  return !isForeignEntry(top)
}

/**
 * The package.json the sandbox gets: the checkout's identity and its real dependencies, with
 * the two things the invocation gate judges replaced by their publication values. Throws rather
 * than returns on anything that would make the check a lie -- a missing version, a dependency
 * still naming a checkout.
 */
export const publicationPackageJson = (native, sdkVersion) => {
  if (typeof sdkVersion !== "string" || sdkVersion.length === 0)
    throw new Error("refusing to stage: the kernel package.json declares no version")
  const out = {
    ...native,
    version: native.version,
    private: true,
    type: "module",
    // Only the entry the gate reads. Every other script of the checkout is dropped: they run
    // node --test over files the package does not ship, and a sandbox that carried them would
    // invite someone to run the developer loop against the publication shape.
    scripts: { test: CANONICAL_TEST },
    dependencies: { ...native.dependencies, "qwbe-core": sdkVersion },
  }
  delete out.devDependencies
  const offenders = []
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(out[field] ?? {})) {
      if (typeof spec === "string" && CHECKOUT_SCHEMES.some((s) => spec.startsWith(s))) offenders.push(`${name}@${spec}`)
    }
  }
  if (offenders.length > 0)
    throw new Error(`refusing to stage: publication package.json still names a checkout: ${offenders.join(", ")}`)
  if (out.scripts.test !== CANONICAL_TEST)
    throw new Error(`refusing to stage: scripts.test must be ${CANONICAL_TEST}`)
  return out
}

/**
 * The exact set of `QWBE_*` variables the checked kernel is given. This is the whole list: the
 * four admin coordinates it needs to CREATE its own `qwbe_check_<hex>` database
 * (`check-package.ts`, `adminUrl`) and the one operator authorization above. A variable that is
 * not here does not reach the child, whether or not this file has ever heard of it.
 */
export const CHECK_ENV_KEYS = Object.freeze([
  "QWBE_PG_HOST",
  "QWBE_PG_PORT",
  "QWBE_PG_USER",
  "QWBE_PG_PASSWORD",
  "QWBE_LEGACY_MIGRATIONS",
])

/**
 * The environment the checker subprocess gets, for BOTH invocations (native and sandbox).
 *
 * A whitelist, deliberately, and not the blacklist this function used to be. The child of this
 * runner is a kernel that boots a pack and then runs that pack's own `probes/*.mjs`. Until
 * 2026-09-26 those were checkout probes that read `QWBE_REPO` and acted on paths under it -- one
 * (`probes/qwb31-install-lifecycle.mjs`) called `rmSync` on `$QWBE_REPO/core/plugins/crm-pack`,
 * the LIVE mounted copy in the kernel checkout, gitignored, so a deletion would not even show up
 * in git. The checkout-only scripts have since moved out of `probes/` (`test/install-lifecycle.mjs`
 * on a scratch root, `test/source-drift.mjs`, `frontend/e2e/sharing-adapter-check.mjs`) and
 * `probes/crm.mjs` speaks `QWBE_URL`; the rule stays, because the next probe could be written
 * against a checkout again. So no `QWBE_REPO` is forwarded,
 * and because a blacklist only covers the names it was written with, EVERY inherited `QWBE_*`
 * variable is dropped first -- including whatever the parent shell happens to export after
 * sourcing `qwbe/.env` (`QWBE_DATABASE_URL` naming the live `qwbe` database, `QWBE_DATA_DIR`,
 * `QWBE_STORE_DIR`, `QWBE_PLUGINS_DIR`, `QWBE_PORT`, `QWBE_URL`, `QWBE_REPO`). Non-`QWBE_`
 * variables pass through untouched: the spawned node still needs `PATH` and `HOME`.
 *
 * `QWBE_REPO` remains an INPUT to the runner itself -- it is how the runner finds the kernel bin
 * and builds `core/dist`. It stops at the runner; it is not part of what the child is told.
 *
 * The admin coordinates are still derived from `QWBE_DATABASE_URL` when the explicit `QWBE_PG_*`
 * spelling is absent: the host, port and user of that URL, never its database name, and the
 * password only as a fallback. No password default -- an unset password is a refusal, never a
 * guess.
 */
export const checkEnv = (env) => {
  const url = env.QWBE_DATABASE_URL ? new URL(env.QWBE_DATABASE_URL) : null
  const password = env.QWBE_PG_PASSWORD ?? url?.password
  if (!password)
    throw new Error(
      "set QWBE_PG_PASSWORD (or QWBE_DATABASE_URL) for the throwaway check database -- there is no password default",
    )
  // Scrub first, then write back exactly CHECK_ENV_KEYS. An inherited QWBE_* name this file has
  // never heard of is dropped by the same rule as the ones it has.
  const out = {}
  for (const [key, value] of Object.entries(env)) if (!key.startsWith("QWBE_")) out[key] = value
  out.QWBE_PG_HOST = env.QWBE_PG_HOST ?? url?.hostname ?? "127.0.0.1"
  out.QWBE_PG_PORT = env.QWBE_PG_PORT ?? (url?.port || "5433")
  out.QWBE_PG_USER = env.QWBE_PG_USER ?? (url?.username || "postgres")
  out.QWBE_PG_PASSWORD = password
  out.QWBE_LEGACY_MIGRATIONS = LEGACY_MIGRATIONS
  return out
}

/** A `scheme://user:password@host` credential in any text the runner relays. */
const CREDENTIAL_URL = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]*@/gi

/** Secrets shorter than this are NOT substituted: a one- or two-character password matches
 *  half the output and redacting it would mangle the report instead of protecting anything.
 *  That is a documented gap, not a silent one -- see docs/t1452-sdk-check-report.md. */
export const MIN_REDACTABLE_SECRET = 4

/**
 * The checker's stdout and stderr are relayed verbatim to the terminal, and the checker boots a
 * kernel whose own logging is not this runner's to change. So the relay is filtered here: any
 * `scheme://user:pass@host` collapses to `scheme://user:***@host`, and the literal password this
 * runner derived is substituted wherever it appears. This is a string filter, not a logging
 * subsystem -- it cannot catch a secret it was not given.
 */
export const redactSecrets = (text, secrets = []) => {
  if (typeof text !== "string" || text.length === 0) return text
  let out = text.replace(CREDENTIAL_URL, "$1:***@")
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < MIN_REDACTABLE_SECRET) continue
    out = out.split(secret).join("***")
  }
  return out
}

/** What may be printed about the connection: everything except the password. The list of names
 *  the child is given is printed too -- if this line ever grows a variable, it is in the log and
 *  in the diff. */
export const describeEnv = (env) =>
  `postgres ${env.QWBE_PG_USER}@${env.QWBE_PG_HOST}:${env.QWBE_PG_PORT} (password from the environment, not logged); ` +
  `QWBE_LEGACY_MIGRATIONS=${env.QWBE_LEGACY_MIGRATIONS} (operator authorization for the EMPTY throwaway database only); ` +
  `the child's QWBE_* environment is exactly ${CHECK_ENV_KEYS.join(", ")} -- no QWBE_REPO, no live URL, no live paths`

/**
 * May the runner delete this path? Only a directory it made itself: resolved under the OS temp
 * directory AND carrying the runner's prefix. Everything else is refused -- the runner never
 * removes a sandbox it merely found, and never anything in either checkout.
 */
export const isOwnSandbox = (path) => {
  if (typeof path !== "string" || path.length === 0) return false
  let real
  try {
    real = realpathSync(path)
  } catch {
    real = resolve(path)
  }
  const base = realpathSync(tmpdir())
  if (!real.startsWith(base + sep)) return false
  const rest = real.slice(base.length + 1).split(sep)
  return rest.length >= 1 && (rest[0] ?? "").startsWith(SANDBOX_PREFIX)
}
