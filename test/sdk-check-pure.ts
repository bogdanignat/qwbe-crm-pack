// The staging decisions of the `qwbe check` runner (T-1452, B4), without a kernel, a temp dir or a
// spawn: which top-level entries of the checkout reach the sandbox, and the package.json the sandbox
// gets. The sandbox copy is REWRITTEN, never the checkout's own file: the developer loop needs
// `qwbe-core: file:../../qwbe/core` and a node test script, which is exactly what the invocation
// gate exists to refuse.
import { resolve, sep } from "node:path"
import * as Data from "effect/Data"
import * as Either from "effect/Either"

/** The prefix every sandbox this runner creates carries. Cleanup keys off it. */
export const SANDBOX_PREFIX = "qwbe-crm-sdk-check-"

/** The only `scripts.test` the kernel's invocation gate accepts. */
export const CANONICAL_TEST = "qwbe check ."

/**
 * The operator's pre-ledger authorization, written out HERE as a literal and never derived from the
 * pack's manifests. The kernel refuses to boot this pack on a database whose provenance ledger has
 * never seen the legacy cube names it declares a `dataMigration` from, and "the package being
 * checked does not get that vote" (core/src/kernel/migrate-ownership.ts). Reading the names out of
 * each cube's `index.ts` would hand the package that vote, so they are typed out: changing this
 * list is an operator decision, visible in a diff and in the log line the runner prints.
 *
 * It authorizes a no-op here -- the checker's own throwaway database is empty. It is NOT an
 * authorization for a real deployment: that remains a native gate this runner does not discharge.
 */
export const LEGACY_MIGRATIONS = "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack"

/** Specifier schemes that name a checkout instead of an install. The gate refuses these. */
const CHECKOUT_SCHEMES = ["file:", "link:", "workspace:", "portal:"]

// Top-level entries that are the authoring checkout's, never the package's. `test` is where THIS
// runner lives: it spawns npm and the kernel bin, so it sits with the pack's tests, not its tooling.
// `test` is dropped by this filter and by the kernel's `package-source.ts` LOCAL_SOURCE_DIRECTORIES
// (which, since kernel PR #45, drops `tools/` and `checks/` at install as well).
const FOREIGN_ENTRIES = new Set(["node_modules", "frontend", "docs", "test", "dist", "build", "coverage", "package-lock.json"])

/** A screenshot, a trace, a baseline dump: artifacts of a session, not of the package. */
const FOREIGN_PATTERN = /\.(png|jpe?g|gif|webp|zip|tgz|tar|log|sqlite|db)$/i

/** Dotted entries are foreign by rule rather than by name, so the next tool's directory ships no surprise. */
export const isForeignEntry = (name: string) =>
  name.startsWith(".") || FOREIGN_ENTRIES.has(name) || FOREIGN_PATTERN.test(name)

/** The outer copy's predicate: keep the root, drop every foreign TOP-LEVEL entry, keep all below. */
export const copyFilter = (root: string) => (src: string) => {
  if (src === root) return true
  const top = resolve(src).slice(resolve(root).length + 1).split(sep)[0] ?? ""
  return !isForeignEntry(top)
}

/** Staging would make the check a lie: a missing SDK version, a dependency still naming a checkout. */
export class StageRefused extends Data.TaggedError("StageRefused")<{ readonly message: string }> {}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const offendersIn = (out: Record<string, unknown>) =>
  ["dependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
    Object.entries(record(out[field]))
      .filter(([, spec]) => typeof spec === "string" && CHECKOUT_SCHEMES.some((s) => spec.startsWith(s)))
      .map(([name, spec]) => `${name}@${String(spec)}`),
  )

/**
 * The package.json the sandbox gets: the checkout's identity and real dependencies, with the two
 * things the gate judges replaced by their publication values. Only `scripts.test` survives: the
 * developer scripts run a loop over files the package does not ship. The input is not mutated.
 */
export const publicationPackageJson = (
  native: Readonly<Record<string, unknown>>,
  sdkVersion: string | undefined,
): Either.Either<Record<string, unknown>, StageRefused> => {
  if (typeof sdkVersion !== "string" || sdkVersion.length === 0)
    return Either.left(new StageRefused({ message: "refusing to stage: the kernel package.json declares no version" }))
  const { devDependencies: _dropped, ...kept } = native
  const out = {
    ...kept,
    private: true,
    type: "module",
    scripts: { test: CANONICAL_TEST },
    dependencies: { ...record(native.dependencies), "qwbe-core": sdkVersion },
  }
  const offenders = offendersIn(out)
  return offenders.length > 0
    ? Either.left(
        new StageRefused({ message: `refusing to stage: publication package.json still names a checkout: ${offenders.join(", ")}` }),
      )
    : Either.right(out)
}
