// The write path of the index tool: CREATE UNIQUE INDEX, one transaction per target, on ONE dedicated
// pool client -- `Pool.query` would run BEGIN, LOCK and the DDL on whatever connection is free, and
// destroys the connection on an error. No row is written and no index is ever dropped or rebuilt.
import * as Effect from "effect/Effect"
import type pg from "pg"
import { type Conflict, conflictsOf, IndexDbFailed, indexState, sql, tableExists } from "./contact-group-indexes-db.ts"
import { DEFAULT_LIMIT } from "./contact-group-indexes-help.ts"
import { indexSql, qi, type Target, TARGETS } from "./contact-group-indexes-spec.ts"

export type Result = "created" | "exists" | "absent-table" | "mismatch" | "invalid" | "blocked" | "failed"
export interface Outcome { readonly result: Result; readonly detail?: string; readonly conflicts?: ReadonlyArray<Conflict> }
export interface Detail extends Outcome { readonly spec: Target }
/**
 * created: did not exist, created, read back matching AND valid. exists: already there, matching and
 * valid. skipped: the table does not exist yet (the kernel makes it on first use) -- not a fault, but
 * NOT installed. failed: blocked by duplicates, a same-named index that differs or is invalid, or a
 * server error.
 */
export interface Stats { readonly scanned: number; readonly created: number; readonly exists: number; readonly skipped: number; readonly failed: number }

/** One client from the pool for the whole run, released when the scope closes. */
export const connectClient = (pool: pg.Pool) =>
  Effect.acquireRelease(
    Effect.tryPromise({ try: () => pool.connect(), catch: (cause) => new IndexDbFailed({ cause }) }),
    (client) => Effect.sync(() => client.release()),
  )

// Inside BEGIN: writes wait, reads do not. The duplicates are re-counted behind the lock, so a stale
// dry run never authorizes a write; the created index is read back before the COMMIT.
const build = (client: pg.PoolClient, spec: Target, limit: number) =>
  Effect.gen(function* () {
    yield* sql(client, `LOCK TABLE ${qi(spec.schema)}.${qi(spec.table)} IN SHARE ROW EXCLUSIVE MODE`)
    const conflicts = yield* conflictsOf(client, spec, limit)
    if (conflicts.length > 0) {
      yield* sql(client, "ROLLBACK")
      return { result: "blocked", detail: `${conflicts.length} duplicate set(s) must be reconciled first`, conflicts } satisfies Outcome
    }
    yield* sql(client, indexSql(spec))
    const after = yield* indexState(client, spec)
    if (after !== "ready") {
      yield* sql(client, "ROLLBACK")
      return { result: "failed", detail: `index ${spec.index} was created but reads back as "${after}"` } satisfies Outcome
    }
    yield* sql(client, "COMMIT")
    return { result: "created" } satisfies Outcome
  })

export const applyOne = (client: pg.PoolClient, spec: Target, limit: number): Effect.Effect<Outcome, IndexDbFailed> =>
  Effect.gen(function* () {
    if (!(yield* tableExists(client, spec.schema, spec.table))) {
      return { result: "absent-table", detail: `table ${spec.schema}.${spec.table} does not exist yet` }
    }
    const before = yield* indexState(client, spec)
    if (before === "ready") return { result: "exists" }
    if (before === "mismatch") {
      return {
        result: "mismatch",
        detail:
          `index ${spec.schema}.${spec.index} exists with a DIFFERENT definition. ` +
          `This tool never drops an index; an operator must inspect and remove it deliberately`,
      }
    }
    if (before === "invalid") {
      return {
        result: "invalid",
        detail:
          `index ${spec.schema}.${spec.index} carries the required definition but the catalog marks ` +
          `it invalid or not ready -- the leftover of an interrupted CREATE INDEX CONCURRENTLY. It ` +
          `enforces NOTHING, and the cube's writes stay refused. This tool never drops or rebuilds ` +
          `an index; an operator must DROP it deliberately and rerun`,
      }
    }
    yield* sql(client, "BEGIN")
    return yield* build(client, spec, limit).pipe(Effect.onError(() => Effect.ignore(sql(client, "ROLLBACK"))))
  })

const bucketOf = (result: Result) =>
  result === "created" || result === "exists" ? result : result === "absent-table" ? "skipped" : "failed"

/** Every target, in order; one that fails rolls back only itself and the run goes on. The reason is
 *  the SQLSTATE and class, never the message (a 23505 from a unique build quotes a group name). */
export const applyOn = (client: pg.PoolClient, limit = DEFAULT_LIMIT) =>
  Effect.map(
    Effect.forEach(TARGETS, (spec) =>
      applyOne(client, spec, limit).pipe(
        Effect.catchAll((error) => Effect.succeed<Outcome>({ result: "failed", detail: `the server refused this target (${error.message})` })),
        Effect.map((outcome): Detail => ({ spec, ...outcome })),
      )),
    (details) => {
      const stats = { scanned: details.length, created: 0, exists: 0, skipped: 0, failed: 0 }
      for (const d of details) stats[bucketOf(d.result)] += 1
      return { stats, details }
    },
  )
