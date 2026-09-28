// What the index tool reads from its argv and what it may print: arguments, the plan as prose or CSV,
// the success rule, and a server error reduced to what is safe to say. No I/O.
import * as Either from "effect/Either"
import { Refused } from "../shared/run-tool.ts"
import type { Stats } from "./contact-group-indexes-apply.ts"
import type { TargetPlan } from "./contact-group-indexes-db.ts"
import { DEFAULT_LIMIT } from "./contact-group-indexes-help.ts"

/**
 * A server error reduced to its SQLSTATE and its class, and NOTHING of its message: PostgreSQL quotes
 * the colliding key in a 23505 (`Key (lower(btrim(...)))=(ada) is duplicated`), so for these indexes
 * the message IS a group name; `detail` and `where` carry it too. The SQLSTATE is a closed alphabet and
 * the shape test is what makes it safe to interpolate; the class is the CONSTRUCTOR name, not its text.
 * Same rule and regex as the kernel's `sqlstate` (core/src/pg/setup.ts), deliberately.
 */
export const fault = (e: unknown): string => {
  const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined
  const sqlstate = typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code) ? code : "unknown"
  const name = e === null || e === undefined ? undefined : (e as { readonly constructor?: { readonly name?: unknown } }).constructor?.name
  const cls = typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "unknown"
  return `${cls}, SQLSTATE ${sqlstate}`
}

/** `created + exists === scanned` is the ONLY state in which both invariants are enforced. */
export const allReady = (stats: Stats): boolean => stats.created + stats.exists === stats.scanned

export interface Options {
  readonly help: boolean
  readonly apply: boolean
  readonly understood: boolean
  readonly csv: boolean
  readonly limit: number
}

const refuse = (message: string) => Either.left(new Refused({ message, code: 2 }))

/** Dry run unless BOTH --apply and --i-understand; an unknown flag or a bad limit is exit 2. */
export const parseArgs = (argv: ReadonlyArray<string>): Either.Either<Options, Refused> => {
  const opts = { help: false, apply: false, understood: false, csv: false, limit: DEFAULT_LIMIT }
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true
    else if (arg === "--apply") opts.apply = true
    else if (arg === "--i-understand") opts.understood = true
    else if (arg === "--csv") opts.csv = true
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length))
      if (!Number.isInteger(n) || n < 1) return refuse(`--limit must be a positive integer, got "${arg}"`)
      opts.limit = n
    } else return refuse(`unknown argument "${arg}" (try --help)`)
  }
  if (opts.apply && !opts.understood) return refuse("--apply also needs --i-understand; refusing to write")
  return Either.right(opts)
}

const rowsOf = (t: TargetPlan) => t.conflicts.reduce((n, c) => n + c.rows, 0)

/** The plan for an operator: counts and row ids only, never a row value. */
export const planProse = (targets: ReadonlyArray<TargetPlan>): ReadonlyArray<string> =>
  targets.flatMap((t) => [
    `${t.spec.schema}.${t.spec.table}: table ${t.tableExists ? "present" : "ABSENT"}, ` +
      `index ${t.spec.index} ${t.indexState}` +
      (rowsOf(t) > 0 ? `, ${t.conflicts.length} duplicate set(s) covering ${rowsOf(t)} rows` : ""),
    ...t.conflicts.map((c) => `    ${c.rows} rows: ${c.ids.join(" ")}`),
    ...(t.tableExists
      ? []
      : [`    the kernel creates the table AND its index on first use: one authorized ` +
          `GET /contact-groups?limit=1 creates the groups table, then rerun (see --help)`]),
  ])

const cell = (v: string | number | boolean) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

/** The plan for an auditor. */
export const planCsv = (targets: ReadonlyArray<TargetPlan>): string =>
  [
    "schema,table,index,tableExists,indexState,conflictSets,conflictRows",
    ...targets.map((t) =>
      [t.spec.schema, t.spec.table, t.spec.index, t.tableExists, t.indexState, t.conflicts.length, rowsOf(t)].map(cell).join(",")),
  ].join("\n")
