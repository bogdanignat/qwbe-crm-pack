// Tests for the unique externalId index module (QWB-54, ticket 13).
//
// What is proven, against a throwaway database (checks/_layers/test-db.ts: the password
// comes from QWBE_PG_PASSWORD, never a default):
//   1. the index is created, partial on live rows with a non-null externalId;
//   2. a second run reports "exists" and changes nothing (idempotent);
//   3. a missing table is REFUSED, never silently skipped -- an index silently skipped
//      would leave the import without its guarantee;
//   4. the database itself refuses a second row with an externalId already taken.
// Structure only is asserted; no row values beyond the synthetic fixture strings below.

import { describe, expect, layer } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import pg from "pg"
import { TestDb, testDb } from "../../checks/_layers/test-db.ts"
import { ensureExternalIdIndex, indexName, schemaOf } from "./ensure-external-id-index.ts"
import { query } from "./query.ts"

const SCHEMA = "extidx_test"
const TABLE = "rows"

class Db extends Context.Tag("Db")<Db, pg.Pool>() {}

// The pool ends before the layer below drops the database (dropThrowawayDb waits for it).
const db = Layer.scoped(
  Db,
  Effect.gen(function* () {
    const { url } = yield* TestDb
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new pg.Pool({ connectionString: url, max: 1 }).on("error", () => {})), // a late FATAL must never crash the file
      (pool) => Effect.promise(() => pool.end()),
    )
    // The schema and table, as the kernel's pg store creates them (core/src/pg/setup.ts) --
    // exactly what ensureCubeSchema + ensureTable would have left behind after one list call.
    yield* query(pool, `CREATE SCHEMA "${SCHEMA}"`)
    yield* query(
      pool,
      `CREATE TABLE "${SCHEMA}"."${TABLE}" (
         id text PRIMARY KEY,
         type text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         deleted boolean NOT NULL DEFAULT false,
         version integer NOT NULL DEFAULT 1,
         body jsonb NOT NULL
       )`,
    )
    yield* query(
      pool,
      `INSERT INTO "${SCHEMA}"."${TABLE}" (id, type, body) VALUES
         ('one', 'Organization', $1),
         ('two', 'Organization', $2)`,
      [JSON.stringify({ name: "One", externalId: "vtiger:1" }), JSON.stringify({ name: "Two", externalId: null })],
    )
    return pool
  }),
).pipe(Layer.provide(testDb("extidx")))

// Live clock: the drop's retry schedule must really sleep, not wait on a TestClock.
layer(db, { timeout: 60_000, excludeTestServices: true })((it) => {
  describe("the unique externalId index", () => {
    it.effect("is created once, reported as existing on the second run", () =>
      Effect.gen(function* () {
        const pool = yield* Db
        expect(yield* ensureExternalIdIndex(pool, SCHEMA, TABLE)).toBe("created")
        expect(yield* ensureExternalIdIndex(pool, SCHEMA, TABLE)).toBe("exists")
        const r = yield* query<{ indexdef: string }>(
          pool,
          `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
          [SCHEMA, indexName(TABLE)],
        )
        expect(r.rows.length).toBe(1)
        expect(r.rows[0]!.indexdef).toMatch(/CREATE UNIQUE INDEX/)
        expect(r.rows[0]!.indexdef).toMatch(/externalId/)
        expect(r.rows[0]!.indexdef).toMatch(/deleted = false/)
      }))

    it.effect("refuses a missing table instead of silently skipping the guarantee", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(ensureExternalIdIndex(yield* Db, SCHEMA, "no_such_table"))
        expect(error.message).toMatch(/does not exist yet/)
      }))

    it.effect("the database refuses a second row with an externalId already taken", () =>
      Effect.gen(function* () {
        const pool = yield* Db
        const error = yield* Effect.flip(
          Effect.tryPromise({
            try: () =>
              pool.query(`INSERT INTO "${SCHEMA}"."${TABLE}" (id, type, body) VALUES ('dup', 'Organization', $1)`, [
                JSON.stringify({ name: "Dup", externalId: "vtiger:1" }),
              ]),
            catch: (e) => e as { code?: string },
          }),
        )
        expect(error.code).toBe("23505")
      }))

    it("maps a cube name to its schema by the kernel's own rule", () => {
      expect(schemaOf("crm/organizations")).toBe("crm--organizations")
    })
  })
})
