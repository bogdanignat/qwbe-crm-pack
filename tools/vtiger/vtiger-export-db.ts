// The vtiger MariaDB as the exporter sees it: one connection, the two structure reads (the cf_*
// column names, the active row count) and the row stream into a file. The rows are never decoded
// or printed: they go from the driver to the JSONL file as they arrive.
import * as FileSystem from "@effect/platform/FileSystem"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import mysql from "mysql2"
import { CfRows, CountRows, progressLine } from "./vtiger-export-pure.ts"
import { cfColumnQuery, type Entity } from "./vtiger-export-query.ts"

export class ExportFailed extends Data.TaggedError("ExportFailed")<{ readonly message: string }> {}

const failed = (error: unknown) => new ExportFailed({ message: error instanceof Error ? error.message : String(error) })

export interface Server {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: Redacted.Redacted
  readonly database: string
}

/** One connection for the scope; closed (errors ignored) when the scope ends. */
export const connect = ({ host, port, user, password, database }: Server) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      mysql.createConnection({ host, port, user, password: Redacted.value(password), database, multipleStatements: false })),
    (conn) => Effect.ignore(Effect.tryPromise(() => conn.promise().end())),
  )

const select = <A, I>(schema: Schema.Schema<A, I>, conn: mysql.Connection, sql: string) =>
  Effect.tryPromise({ try: () => conn.promise().query(sql), catch: failed }).pipe(
    Effect.flatMap(([rows]) => Schema.decodeUnknown(schema)(rows)),
    Effect.mapError(failed),
  )

/** The column names of the entity's cf companion table (custom fields differ per install). */
export const cfColumnsOf = (conn: mysql.Connection, entity: Entity) =>
  Effect.map(select(CfRows, conn, cfColumnQuery(entity)), (rows) => rows.map((r) => r.Field))

export const countOf = (conn: mysql.Connection, countSql: string) =>
  Effect.map(select(CountRows, conn, countSql), ([{ n }]) => n)

// `rowsAsStream` is NOT a mysql2 API; the Readable of Query.stream() is: rows flow one at a time.
const rows = (conn: mysql.Connection, sql: string) =>
  Stream.fromAsyncIterable<unknown, ExportFailed>(conn.query(sql).stream(), failed)

/** Streams every row as one JSON line into `outPath`; returns the row count. */
export const writeRows = (conn: mysql.Connection, sql: string, outPath: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    rows(conn, sql).pipe(
      Stream.zipWithIndex,
      Stream.tap(([, i]) => Option.match(progressLine(i + 1), { onNone: () => Effect.void, onSome: Console.error })),
      Stream.map(([row]) => JSON.stringify(row) + "\n"),
      Stream.encodeText,
      Stream.run(Sink.zip(fs.sink(outPath), Sink.count, { concurrent: true })),
      Effect.map(([, n]) => n),
      Effect.mapError(failed),
    ))
