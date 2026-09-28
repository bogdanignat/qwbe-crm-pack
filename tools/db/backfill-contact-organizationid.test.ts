// Test for the one-shot backfill of schema keys older rows lack (QWB-54, tickets 07, 13;
// the key's name is organizationId since the ticket-12 rename).
//
// What is proven, against a throwaway database (checks/_layers/test-db.ts: the
// password comes from QWBE_PG_PASSWORD, never a default):
//   1. only rows WITHOUT the organizationId key gain `organizationId = null`;
//   2. rows that carry the key -- null or a value -- are untouched;
//   3. a second run changes nothing (idempotent), including the reported count;
//   4. the accountNo/accountType rename moves the old keys to organizationNo/organizationType
//      and a second run changes nothing (QWB-54, ticket 14).
//
// Requires a reachable Postgres (QWBE_PG_HOST/PORT/USER/PASSWORD, port 5433 by default).

import { describe, expect, layer } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import pg from "pg"
import { TestDb, testDb } from "../../checks/_layers/test-db.ts"
import { backfillMissingKey, renameOrganizationKeys } from "./backfill-contact-organizationid.ts"
import { query } from "./query.ts"

const SCHEMA = "backfill_test"
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
    yield* query(pool, `CREATE SCHEMA "${SCHEMA}"`)
    // The rows table, as the kernel's pg store creates it (core/src/pg/setup.ts).
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
    // Rows from before the keys existed (no organizationId, no externalId), rows with the
    // key null, one linked, and one that already carries its external identity.
    yield* query(
      pool,
      `INSERT INTO "${SCHEMA}"."${TABLE}" (id, type, body) VALUES
         ('old', 'Contact', '{"id":"old","type":"Contact","name":"Old Row"}'),
         ('null', 'Contact', '{"id":"null","type":"Contact","name":"Null Row","organizationId":null}'),
         ('linked', 'Contact', '{"id":"linked","type":"Contact","name":"Linked Row","organizationId":"org_1"}'),
         ('ext', 'Contact', '{"id":"ext","type":"Contact","name":"External Row","externalId":"vtiger:55"}')`,
    )
    return pool
  }),
).pipe(Layer.provide(testDb("backfill")))

// Organizations migrated from the old crm/accounts cube carry the pre-rename field names;
// the renamed schema requires organizationNo/organizationType (present, nullable), so a
// row still holding the old keys fails response encoding.
const accountRows = Layer.effectDiscard(
  Effect.flatMap(Db, (pool) =>
    query(
      pool,
      `INSERT INTO "${SCHEMA}"."${TABLE}" (id, type, body) VALUES
         ('acct', 'Organization', '{"id":"acct","type":"Organization","name":"Old Names","accountNo":"ACC-1","accountType":"Customer"}'),
         ('org', 'Organization', '{"id":"org","type":"Organization","name":"New Names","organizationNo":"ORG-1","organizationType":"Partner"}')`,
    ),
  ),
)

const bodyOf = (id: string) =>
  Effect.flatMap(Db, (pool) =>
    query<{ body: Record<string, unknown> }>(pool, `SELECT body FROM "${SCHEMA}"."${TABLE}" WHERE id = $1`, [id]),
  ).pipe(Effect.map((r) => r.rows[0]!.body))

const backfill = (key: string) => Effect.flatMap(Db, (pool) => backfillMissingKey(pool, SCHEMA, TABLE, key))
const rename = Effect.flatMap(Db, (pool) => renameOrganizationKeys(pool, SCHEMA, TABLE))

// Live clock: the drop's retry schedule must really sleep, not wait on a TestClock.
layer(db, { timeout: 60_000, excludeTestServices: true })((it) => {
  describe("the one-shot organizationId backfill", () => {
    it.effect("fills the key with null only where it is missing", () =>
      Effect.gen(function* () {
        expect(yield* backfill("organizationId")).toBe(2) // old and ext lacked the key
        expect(yield* bodyOf("old")).toEqual({ id: "old", type: "Contact", name: "Old Row", organizationId: null })
        expect(yield* bodyOf("null")).toEqual({ id: "null", type: "Contact", name: "Null Row", organizationId: null })
        expect(yield* bodyOf("linked")).toEqual({ id: "linked", type: "Contact", name: "Linked Row", organizationId: "org_1" })
      }))

    it.effect("is idempotent: a second run reports zero and changes nothing", () =>
      Effect.gen(function* () {
        expect(yield* backfill("organizationId")).toBe(0)
        expect((yield* bodyOf("old")).organizationId).toBe(null)
        expect((yield* bodyOf("linked")).organizationId).toBe("org_1")
      }))
  })

  describe("the one-shot externalId backfill (QWB-54, ticket 13)", () => {
    it.effect("gives every row the key, null where no source system put one there", () =>
      Effect.gen(function* () {
        expect(yield* backfill("externalId")).toBe(3) // old, null, linked lacked the key; 'ext' already carries one
        expect((yield* bodyOf("old")).externalId).toBe(null)
        expect((yield* bodyOf("ext")).externalId).toBe("vtiger:55")
      }))

    it.effect("is idempotent: a second run reports zero and changes nothing", () =>
      Effect.gen(function* () {
        expect(yield* backfill("externalId")).toBe(0)
        expect((yield* bodyOf("ext")).externalId).toBe("vtiger:55")
      }))
  })

  it.layer(accountRows, { timeout: 60_000 })("the accountNo/accountType rename (QWB-54, ticket 14)", (it) => {
    it.effect("moves the old keys to the new names, deleting the old ones", () =>
      Effect.gen(function* () {
        expect(yield* rename).toBe(1) // only 'acct' still carries accountNo
        expect(yield* bodyOf("acct")).toEqual({
          id: "acct",
          type: "Organization",
          name: "Old Names",
          organizationNo: "ACC-1",
          organizationType: "Customer",
        })
        expect((yield* bodyOf("org")).organizationNo).toBe("ORG-1")
      }))

    it.effect("is idempotent: a second run reports zero and changes nothing", () =>
      Effect.gen(function* () {
        expect(yield* rename).toBe(0)
        expect((yield* bodyOf("acct")).accountNo).toBe(undefined)
        expect((yield* bodyOf("acct")).organizationNo).toBe("ACC-1")
      }))
  })
})
