// One-shot backfill for rows written before a schema key existed.
//
// Why: the kernel's generic list serves rows exactly as stored, and a row missing a key the
// schema declares (present, nullable) fails response encoding, so the absence is fixed once,
// in the data.
//
// Three kinds of fix today:
//   - `organizationId` on contacts: rows stored before the organizations cube existed (the
//     key's name is organizationId since the one-name rename).
//   - `externalId` on contacts and organizations: the external identity of the vtiger import.
//     Rows created by hand have no source system; they gain the key
//     with a null value, and the partial unique index ignores nulls.
//   - the field RENAME inside organizations: rows migrated from the old
//     crm/accounts cube carry the old field names `accountNo`/`accountType`; the renamed
//     schema serves `organizationNo`/`organizationType` and a row missing them fails
//     response encoding. Each old key moves to its new name in the same jsonb body.
//
// Idempotent: `body ? 'key'` is true iff the key exists (null included), so rows that carry
// the key are never touched and a second run changes nothing. Safe against a live store: one
// UPDATE per (schema, table, key), matched only on rows that lack the key.
//
// Targets, all four steps: crm--contacts.contacts (organizationId, externalId),
// crm--organizations.organizations (externalId, plus the accountNo/accountType rename).
//
// Connection (same contract as the qwbe probes, no password default):
//   QWBE_DATABASE_URL=postgres://... node tools/db/backfill-contact-organizationid.ts
// or the local-dev parts:
//   QWBE_PG_PASSWORD=qwbe node tools/db/backfill-contact-organizationid.ts
// With neither variable set the tool refuses to guess and exits 2.

import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { pathToFileURL } from "node:url"
import type pg from "pg"
import { runTool } from "../shared/run-tool.ts"
import { type DbFailed, query, withDatabase } from "./query.ts"

/** The one statement, for any schema/table/key (tests use a scratch pair). */
export const fillKeySql = (schema: string, table: string, key: string): string =>
  `UPDATE "${schema}"."${table}" SET body = body || '${JSON.stringify({ [key]: null })}'::jsonb WHERE NOT body ? '${key}'`

/** Runs one backfill and returns how many rows gained the key. */
export const backfillMissingKey = (
  db: pg.Pool,
  schema: string,
  table: string,
  key: string,
): Effect.Effect<number, DbFailed> =>
  Effect.map(query(db, fillKeySql(schema, table, key)), (result) => result.rowCount ?? 0)

/**
 * The rename statement: moves each old key into its new name inside the
 * same jsonb body, deleting the old keys. The whole expression reads the OLD row, so the new
 * keys are built from values that are still there; `body ? '<old>'` makes it idempotent -- a
 * renamed row no longer carries the old key, so a second run changes nothing.
 */
export const renameAccountKeysSql = (schema: string, table: string): string =>
  `UPDATE "${schema}"."${table}" SET body = (body - 'accountNo' - 'accountType') || ` +
  `jsonb_build_object('organizationNo', body->'accountNo', 'organizationType', body->'accountType') ` +
  `WHERE body ? 'accountNo'`

/** Renames accountNo/accountType to their organization* names; returns the rows moved. */
export const renameOrganizationKeys = (
  db: pg.Pool,
  schema = "crm--organizations",
  table = "organizations",
): Effect.Effect<number, DbFailed> =>
  Effect.map(query(db, renameAccountKeysSql(schema, table)), (result) => result.rowCount ?? 0)

const TARGETS = [
  { schema: "crm--contacts", table: "contacts", key: "organizationId" },
  { schema: "crm--contacts", table: "contacts", key: "externalId" },
  { schema: "crm--organizations", table: "organizations", key: "externalId" },
] as const

const main = withDatabase((db) =>
  Effect.gen(function* () {
    yield* Effect.forEach(TARGETS, (t) =>
      Effect.flatMap(backfillMissingKey(db, t.schema, t.table, t.key), (n) =>
        Console.log(`backfill done: ${n} ${t.table} row(s) gained ${t.key} = null`),
      ),
    )
    const renamed = yield* renameOrganizationKeys(db)
    yield* Console.log(`backfill done: ${renamed} organizations row(s) renamed accountNo/accountType`)
    return 0
  }),
)

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTool(main)
}
