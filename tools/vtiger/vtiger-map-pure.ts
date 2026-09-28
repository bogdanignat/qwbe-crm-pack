// Decisions of the vtiger import, free of I/O: the argv, the mapping file and reply shapes, the
// run's tally and the lines it prints. Counts, HTTP statuses and schema field names only --
// never a row value, never a vtiger id.
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Mapping } from "./vtiger-map-lib.ts"

export const USAGE =
  "usage: node tools/vtiger/vtiger-map.ts <file.jsonl> <mapping.json> [--set <setId>] [--max-rejects <n>]"

const Args = Schema.Struct({
  file: Schema.NonEmptyString,
  mappingPath: Schema.NonEmptyString,
  setId: Schema.optional(Schema.String),
  maxRejects: Schema.NumberFromString.pipe(Schema.int(), Schema.nonNegative()),
})
export type MapArgs = typeof Args.Type

const VALUE_FLAGS = ["--set", "--max-rejects"] as const

/** Two positional paths plus the two value flags; a flag's value is never taken for a path,
 *  other `--x` words are ignored, and a missing --max-rejects means 0. */
export const mapArgs = (argv: ReadonlyArray<string>) => {
  const flag = (name: (typeof VALUE_FLAGS)[number]) => {
    const i = argv.indexOf(name)
    return i > -1 ? argv[i + 1] : undefined
  }
  const valueAt = argv.flatMap((a, i) => ((VALUE_FLAGS as ReadonlyArray<string>).includes(a) ? [i + 1] : []))
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valueAt.includes(i))
  return Schema.decodeUnknownOption(Args)({
    file: positional[0],
    mappingPath: positional[1],
    setId: flag("--set"),
    maxRejects: flag("--max-rejects") ?? "0",
  })
}

/** The mapping file: the pure mapping plus where the rows go. cube/table are checked by the tool
 *  (a missing one is a refusal naming both, exit 2), so they are optional here. */
export const MapFile = Schema.parseJson(Schema.Struct({
  ...Mapping.fields,
  entity: Schema.String,
  route: Schema.String,
  cube: Schema.optional(Schema.String),
  table: Schema.optional(Schema.String),
  accountKey: Schema.optional(Schema.String),
}))
export type MapFile = typeof MapFile.Type

export const Row = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
export const Page = Schema.Struct({
  total: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
})
export const SetState = Schema.Struct({ rowCount: Schema.Number, malformedCount: Schema.Number })

/** The vtiger organization a contact row points at; none for the "no organization" markers. */
export const orgKeyOf = (row: Record<string, unknown>, accountKey: string | undefined): Option.Option<string> => {
  const v = accountKey === undefined ? undefined : row[accountKey]
  const k = v === undefined || v === null ? "" : String(v)
  return k === "" || k === "0" ? Option.none() : Option.some(k)
}

// The kernel adds no error mapping, so a rejected payload can come back embedded in the Effect
// decode error. Only the ["field"] positions of that error are printed; LOOKUP failures print
// the status alone -- their bodies are page payloads, and no part of a row may be echoed.
const fieldPaths = (body: unknown): ReadonlyArray<string> => {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "")
  return [...new Set([...text.matchAll(/\[\\?"([A-Za-z0-9_]+)\\?"\]/g)].map((m) => m[1]!))]
}
export const describeFailure = (verb: string, status: number, body: unknown) => {
  const fields = fieldPaths(body)
  return `${verb}: HTTP ${status}${fields.length > 0 ? ` (field: ${fields.join(", ")})` : ""}`
}
export const describeStatus = (verb: string, status: number) => `${verb}: HTTP ${status}`

export const emptyTally = {
  seen: 0, created: 0, updated: 0, missingOrg: 0, noOrg: 0, errors: 0, skipped: 0, skippedNoKey: 0,
  firstError: Option.none<string>(),
}
export type Tally = typeof emptyTally
export type Counter = Exclude<keyof Tally, "firstError" | "errors">

export const bump = (key: Counter) => (t: Tally): Tally => ({ ...t, [key]: t[key] + 1 })

/** One more error; the first message of the run is the one kept. */
export const failed = (message?: string) => (t: Tally): Tally => ({
  ...t,
  errors: t.errors + 1,
  firstError: Option.orElse(t.firstError, () => Option.fromNullable(message)),
})

export const rejectedOf = (t: Tally) => t.errors + t.skipped + t.skippedNoKey

export const summaryLines = (m: MapFile, t: Tally): ReadonlyArray<string> => [
  `entity:     ${m.entity}`,
  `rows seen:  ${t.seen}`,
  `created:    ${t.created}`,
  `updated:    ${t.updated}`,
  ...(m.entity === "contacts"
    ? [
      `no org:     ${t.noOrg} (contact has no organization in vtiger)`,
      `missing org:${t.missingOrg} (organization not in qwbe; organizationId set to null; count only, ids never printed)`,
    ]
    : []),
  `skipped:    ${t.skipped} (empty required name or a mapping error)`,
  `no key:     ${t.skippedNoKey} (row without ${m.key}; never POSTed)`,
  `errors:     ${t.errors}`,
  ...Option.toArray(Option.map(t.firstError, (e) => `first error: ${e}`)),
]

export const stagingLines = (setId: string, state: typeof SetState.Type, seen: number): ReadonlyArray<string> => [
  `staging:    set ${setId} holds ${state.rowCount} rows, ${state.malformedCount} malformed`,
  state.rowCount !== seen
    ? `DIVERGENCE: staging ${state.rowCount} vs file ${seen} rows`
    : "staging matches the file row for row (count)",
]
