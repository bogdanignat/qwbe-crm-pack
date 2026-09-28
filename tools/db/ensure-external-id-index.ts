// The unique index on a cube's external identity.
//
// WHY this module exists: the import is idempotent through `externalId` ("vtiger:<crmid>")
// carried ON each row, and uniqueness must live in the DATABASE, not in the application and
// not in a file a crash can lose. A plugin cube cannot create the index itself: the kernel's
// per-cube role holds DML only (SELECT/INSERT/UPDATE/DELETE -- core/src/pg/setup.ts), and
// Postgres refuses CREATE INDEX to anyone but the table's owner ("must be owner of table").
// The kernel offers no index declaration either. So the pack brings a small tool that connects
// to the same database as the kernel, as its owner user, and creates the one partial unique
// index per importable table. The vtiger-map tool runs it before its first write; it can also
// be run standalone for both importable cubes.
//
// The index is PARTIAL: only live rows (deleted = false) with a non-null externalId enter it.
// Rows created by hand (no source system) have no externalId and never conflict; a soft-deleted
// row does not block its identity from being imported again.
//
// Connection (same contract as the backfill tool, no password default):
//   QWBE_DATABASE_URL=postgres://... node tools/db/ensure-external-id-index.ts
// or the local-dev parts:
//   QWBE_PG_PASSWORD=qwbe node tools/db/ensure-external-id-index.ts
// With neither variable set the tool refuses to guess and exits 2.
//
// The table must already exist: the kernel creates it on first use, so one list request
// (GET /organizations?limit=1) is enough -- the import tool does exactly that before calling
// this module. Structure only is ever printed: schema, table, index name, created/exists.

import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { pathToFileURL } from "node:url"
import type pg from "pg"
import { runTool } from "../shared/run-tool.ts"
import { type DbFailed, query, withDatabase } from "./query.ts"

/** The cube's schema name, by the kernel's own rule (core/src/pg/setup.ts schemaName). */
export const schemaOf = (cube: string): string => cube.replace(/\//g, "--")

/** Deterministic index name per table: re-runs are no-ops, and the name is what shows up
 *  in a duplicate-key error, so it must not depend on the run that happened to create it. */
export const indexName = (table: string): string => `${table}_external_id_key`

export class TableMissing extends Data.TaggedError("TableMissing")<{ readonly message: string }> {}

const qi = (identifier: string): string => `"` + identifier.replace(/"/g, `""`) + `"`

/** The one statement, for any schema/table (tests use a scratch pair). */
const externalIdIndexSql = (schema: string, table: string): string =>
  `CREATE UNIQUE INDEX IF NOT EXISTS ${qi(indexName(table))} ON ${qi(schema)}.${qi(table)} ` +
  `((body->>'externalId')) WHERE deleted = false AND body->>'externalId' IS NOT NULL`

/**
 * Ensure the partial unique index on (body->>'externalId'). Returns "created" or "exists".
 * Refuses (fails with TableMissing) when the table does not exist yet, with the one command
 * that fixes it -- an index silently skipped here would leave the import without its guarantee.
 */
export const ensureExternalIdIndex = (
  db: pg.Pool,
  schema: string,
  table: string,
): Effect.Effect<"created" | "exists", TableMissing | DbFailed> =>
  Effect.gen(function* () {
    const exists = yield* query<{ t: string | null }>(db, `SELECT to_regclass($1) AS t`, [`${qi(schema)}.${qi(table)}`])
    if (!exists.rows[0]?.t) {
      return yield* Effect.fail(
        new TableMissing({
          message:
            `table ${schema}.${table} does not exist yet -- the kernel creates it on first use; ` +
            `one list request (GET /${table}?limit=1) is enough, or run the import tool, which ensures the index itself`,
        }),
      )
    }
    const before = yield* query(db, `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
      schema,
      indexName(table),
    ])
    yield* query(db, externalIdIndexSql(schema, table))
    return (before.rowCount ?? 0) > 0 ? "exists" : "created"
  })

/** The two importable cubes of this pack: every target of tools/vtiger/vtiger-map.ts. */
export const IMPORTABLE = [
  { cube: "crm/organizations", schema: "crm--organizations", table: "organizations" },
  { cube: "crm/contacts", schema: "crm--contacts", table: "contacts" },
] as const

const ensureTarget = (db: pg.Pool, target: (typeof IMPORTABLE)[number]) =>
  ensureExternalIdIndex(db, target.schema, target.table).pipe(
    Effect.flatMap((state) => Effect.as(Console.log(`${target.cube}: index ${indexName(target.table)} ${state}`), true)),
    Effect.catchAll((error) => Effect.as(Console.error(`${target.cube}: ${error.message}`), false)),
  )

// Every target is tried, in order; one refusal still exits 1.
const main = withDatabase((db) =>
  Effect.map(Effect.forEach(IMPORTABLE, (target) => ensureTarget(db, target)), (oks) => (oks.every(Boolean) ? 0 : 1)),
)

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTool(main)
}
