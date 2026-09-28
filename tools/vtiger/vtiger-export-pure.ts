// Decisions of the vtiger exporter, free of I/O: which entity and mode the argv asks for, and the
// summary lines a run prints. Structure only: never a row value.
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { ENTITIES, Entity } from "./vtiger-export-query.ts"

export const USAGE = `usage: node tools/vtiger/vtiger-export.ts <${ENTITIES.join("|")}> [--write]`

/** The first non-flag word must be an entity; `--write` anywhere switches to the export. */
export const exportArgs = (argv: ReadonlyArray<string>) =>
  Option.map(Schema.decodeUnknownOption(Entity)(argv.find((a) => !a.startsWith("--"))), (entity) => ({
    entity,
    write: argv.includes("--write"),
  }))

/** SHOW COLUMNS rows, reduced to the names; COUNT(*) arrives as a number or, over text, a string. */
export const CfRows = Schema.Array(Schema.Struct({ Field: Schema.String }))
export const CountRows = Schema.Tuple(Schema.Struct({ n: Schema.Union(Schema.Number, Schema.NumberFromString) }))

export const summaryLines = (entity: Entity, columns: number, cfColumns: ReadonlyArray<string>, total: number) => {
  const key = entity === "accounts" ? "accountid" : "contactid"
  return [
    `entity:      ${entity}`,
    `columns:     ${columns} (${cfColumns.filter((c) => c !== key).length} cf_*)`,
    `active rows: ${total}`,
  ]
}

export const dryRunLines = (sql: string) => [
  "--- SQL that a --write run would execute ---",
  sql,
  "dry run: nothing was written. Pass --write to export.",
]

/** One progress line on stderr per 5000 rows written. */
export const progressLine = (written: number) => (written % 5000 === 0 ? Option.some(`  ... ${written} rows written`) : Option.none())
