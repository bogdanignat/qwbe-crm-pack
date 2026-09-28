#!/usr/bin/env node
// The vtiger structural exporter.
//
// Reads from the vtiger MariaDB and writes JSON Lines, one object per active entity row,
// joining crmentity + base table + *cf companion + address block. It streams: the driver
// query runs in stream mode (mysql2's Query.stream(), wrapped as an Effect Stream) and rows go
// to a FileSystem sink as they arrive, so a 74k-row export never holds the result set in memory.
//
// Credentials come ONLY from the environment, never hard-coded, never printed:
//   VTIGER_DB_HOST (default 127.0.0.1), VTIGER_DB_PORT (default 3306),
//   VTIGER_DB_USER, VTIGER_DB_PASSWORD, VTIGER_DB_NAME
//
// Two modes:
//   default / --dry-run : prints the SQL, the column list and the row COUNT. No data leaves.
//   --write             : streams the JSONL to <repo>/.local/vtiger-export/
//                         (or QWB50_EXPORT_DIR when set)
//                         and prints ONLY the output path and the row count.
//
// Usage: node tools/vtiger/vtiger-export.ts <accounts|contacts> [--write]

import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type mysql from "mysql2"
import { printLines, Refused, runTool } from "../shared/run-tool.ts"
import { exportFile } from "./export-files.ts"
import { cfColumnsOf, connect, countOf, ExportFailed, writeRows } from "./vtiger-export-db.ts"
import { dryRunLines, exportArgs, summaryLines, USAGE } from "./vtiger-export-pure.ts"
import { buildQuery, type Entity } from "./vtiger-export-query.ts"

const Server = Config.all({
  host: Config.string("VTIGER_DB_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.integer("VTIGER_DB_PORT").pipe(Config.withDefault(3306)),
  user: Config.string("VTIGER_DB_USER").pipe(Config.withDefault("")),
  password: Config.redacted("VTIGER_DB_PASSWORD").pipe(Config.withDefault(Redacted.make(""))),
  database: Config.string("VTIGER_DB_NAME").pipe(Config.withDefault("")),
})

/** The connection settings; Refused (exit 2) without the credentials and the database name. */
const server = Effect.mapError(Server, (e) => new ExportFailed({ message: `config error: ${e.message}` })).pipe(
  Effect.filterOrFail(
    (s) => s.user !== "" && Redacted.value(s.password) !== "" && s.database !== "",
    () => new Refused({ message: "set VTIGER_DB_USER, VTIGER_DB_PASSWORD and VTIGER_DB_NAME in the environment", code: 2 }),
  ),
)

/** Prints the entity's structure and active row count; the SELECT a --write run executes. */
const describe = (conn: mysql.Connection, entity: Entity) =>
  Effect.gen(function* () {
    const cfColumns = yield* cfColumnsOf(conn, entity)
    const { sql, countSql, columns } = buildQuery(entity, cfColumns)
    yield* printLines(summaryLines(entity, columns.length, cfColumns, yield* countOf(conn, countSql)))
    return sql
  })

/** Streams the rows into <export dir>/<entity>.jsonl; prints only the path and the count. */
const exportRows = (conn: mysql.Connection, entity: Entity, sql: string) =>
  Effect.gen(function* () {
    const outPath = yield* exportFile(`${entity}.jsonl`)
    const n = yield* writeRows(conn, sql, outPath)
    yield* printLines([`written: ${outPath}`, `rows:    ${n}`])
  })

const main = Effect.gen(function* () {
  const { entity, write } = yield* Effect.orElseFail(exportArgs(process.argv.slice(2)), () => new Refused({ message: USAGE, code: 2 }))
  const conn = yield* Effect.flatMap(server, connect)
  const sql = yield* describe(conn, entity)
  yield* write ? exportRows(conn, entity, sql) : printLines(dryRunLines(sql))
  return 0
}).pipe(Effect.scoped)

runTool(main, "vtiger-export failed: ")
