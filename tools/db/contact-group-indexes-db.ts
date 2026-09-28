// The read path of the index tool: what the database holds for each declared index and what blocks it.
// Writes nothing. Every statement goes through `sql`, never tools/db/query.ts: `DbFailed` carries the
// driver's message, and for a 23505 on these indexes that message quotes a group name.
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type pg from "pg"
import { DEFAULT_LIMIT } from "./contact-group-indexes-help.ts"
import { fault } from "./contact-group-indexes-report.ts"
import { type IndexKey, normalizeIndexDef, qi, type Target, TARGETS } from "./contact-group-indexes-spec.ts"

/** A statement the server (or the driver) refused. Its message is `fault(cause)`, never the driver's. */
export class IndexDbFailed extends Data.TaggedError("IndexDbFailed")<{ readonly cause: unknown }> {
  override get message() {
    return fault(this.cause)
  }
}

export type IndexState = "ready" | "mismatch" | "invalid" | "missing"
export interface Conflict { readonly rows: number; readonly ids: ReadonlyArray<string> }
export interface TargetPlan {
  readonly spec: Target
  readonly tableExists: boolean
  readonly indexState: IndexState
  readonly conflicts: ReadonlyArray<Conflict>
}

export const sql = <R extends pg.QueryResultRow = pg.QueryResultRow>(db: pg.ClientBase, text: string, values: ReadonlyArray<unknown> = []) =>
  Effect.tryPromise({ try: () => db.query<R>(text, [...values]), catch: (cause) => new IndexDbFailed({ cause }) })

export const tableExists = (db: pg.ClientBase, schema: string, table: string) =>
  Effect.map(sql<{ t: string | null }>(db, `SELECT to_regclass($1) AS t`, [`${qi(schema)}.${qi(table)}`]), (r) => (r.rows[0]?.t ?? null) !== null)

/**
 * Read through `pg_index`, NOT the `pg_indexes` view: an interrupted CREATE INDEX CONCURRENTLY leaves
 * an index with `indisvalid = false` that `pg_get_indexdef` renders exactly like the real one. The
 * kernel's write gate (`requireUniqueIndex`) checks the same two flags.
 */
export const indexState = (db: pg.ClientBase, spec: Target): Effect.Effect<IndexState, IndexDbFailed> =>
  Effect.map(
    sql<{ indexdef: string; valid: boolean; ready: boolean }>(
      db,
      `SELECT pg_get_indexdef(x.indexrelid) AS indexdef, x.indisvalid AS valid, x.indisready AS ready
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2 AND i.relname = $3`,
      [spec.schema, spec.table, spec.index],
    ),
    ({ rows: [row] }) =>
      row === undefined ? "missing" : normalizeIndexDef(row.indexdef) !== spec.def ? "mismatch" : row.valid && row.ready ? "ready" : "invalid",
  )

// Rendered from the declared keys, so it cannot describe another key than the index. The key is grouped
// by and NOT returned (names are business data). A NULL key is not a duplicate: NULLs are distinct in a
// unique index, so every key is required NOT NULL, as the index itself enforces.
const duplicatesSql = (spec: Target) => {
  const keyExpr = (k: IndexKey) => (k.normalize === "lower-btrim" ? `lower(btrim(body ->> '${k.body}'))` : `body ->> '${k.body}'`)
  const notNull = spec.keys.map((k) => ` AND (body ->> '${k.body}') IS NOT NULL`).join("")
  return `SELECT count(*)::int AS n, array_agg(id ORDER BY created_at, id) AS ids
     FROM ${qi(spec.schema)}.${qi(spec.table)}
    WHERE ${spec.where}${notNull}
    GROUP BY ${spec.keys.map(keyExpr).join(", ")}
   HAVING count(*) > 1
    ORDER BY 1 DESC
    LIMIT $1`
}

/** Rows that would make CREATE UNIQUE INDEX fail: at most `limit` duplicate sets, as counts and ids. */
export const conflictsOf = (db: pg.ClientBase, spec: Target, limit: number): Effect.Effect<ReadonlyArray<Conflict>, IndexDbFailed> =>
  Effect.map(sql<{ n: number; ids: Array<string> }>(db, duplicatesSql(spec), [limit]), (r) => r.rows.map((row) => ({ rows: row.n, ids: row.ids })))

/** What is there, what is missing, what blocks it, per target in declaration order. */
export const planOn = (db: pg.ClientBase, limit = DEFAULT_LIMIT): Effect.Effect<ReadonlyArray<TargetPlan>, IndexDbFailed> =>
  Effect.forEach(TARGETS, (spec) =>
    Effect.gen(function* () {
      const present = yield* tableExists(db, spec.schema, spec.table)
      const state = present ? yield* indexState(db, spec) : "missing"
      const conflicts = present ? yield* conflictsOf(db, spec, limit) : []
      return { spec, tableExists: present, indexState: state, conflicts }
    }))
