// The contact-group unique-index tool against a REAL PostgreSQL server (a throwaway database from
// checks/_layers/test-db.ts). A double would prove nothing: Postgres is the arbiter of uniqueness,
// and the cube's write gate compares the rendered `indexdef` against the declaration's rendering.
//
// What is proven, in order (the tests share one database and build on each other):
//   1. absent tables are REPORTED (skipped), never silently "succeeded";
//   2. live duplicates BLOCK their own target, as counts and row ids only, and are never repaired;
//   3. the index is created once the duplicate is gone, and the definition rendered from the cube's
//      declaration is exactly what PostgreSQL writes into the catalog;
//   4. a second run creates nothing (idempotent);
//   5. rows whose KEY IS NULL are not duplicates -- the index does not think so either;
//   6. the DATABASE refuses a duplicate name (case- and space-insensitive) and a duplicate live pair,
//      with the constraint names the cube maps, and a soft delete frees both;
//   7. an index carrying the right NAME with a different definition (or a wrong-cased key) is refused;
//   8. an INVALID leftover of CREATE INDEX CONCURRENTLY is refused, and never dropped or rebuilt;
//   9. the CSV an auditor reads.
import { describe, expect, layer } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import pg from "pg"
import { TestDb, testDb } from "../../checks/_layers/test-db.ts"
// The same leaf the TOOL reads, deliberately.
import { NAME_INDEX, PAIR_INDEX, SCHEMA } from "../../cubes/crm/contact-groups/invariant.ts"
import { applyOn, applyOne } from "./contact-group-indexes-apply.ts"
import { conflictsOf, indexState, planOn, tableExists } from "./contact-group-indexes-db.ts"
import { DEFAULT_LIMIT } from "./contact-group-indexes-help.ts"
import { allReady, planCsv } from "./contact-group-indexes-report.ts"
import { normalizeIndexDef, TARGETS } from "./contact-group-indexes-spec.ts"

class Db extends Context.Tag("Db")<Db, pg.PoolClient>() {}

// One dedicated client, as the tool holds one; released before the pool ends, and the pool ends before
// the layer below drops the database (dropThrowawayDb waits for it).
const db = Layer.scoped(
  Db,
  Effect.gen(function* () {
    const { url } = yield* TestDb
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new pg.Pool({ connectionString: url, max: 1 }).on("error", () => {})), // a late FATAL must never crash the file
      (pool) => Effect.promise(() => pool.end()),
    )
    return yield* Effect.acquireRelease(Effect.promise(() => pool.connect()), (client) => Effect.sync(() => client.release()))
  }),
).pipe(Layer.provide(testDb("cgidx")))

const target = (i: 0 | 1) => TARGETS[i]!

/** A statement the test itself needs; a failure dies with the driver's error, for a readable red test. */
const exec = <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: ReadonlyArray<unknown> = []) =>
  Effect.flatMap(Db, (client) => Effect.orDie(Effect.tryPromise(() => client.query<R>(text, [...values]))))
/** A statement the SERVER must refuse: the driver's error, code and constraint included. */
const refused = (text: string, values: ReadonlyArray<unknown> = []) =>
  Effect.flatMap(Db, (client) =>
    Effect.flip(Effect.tryPromise({ try: () => client.query(text, [...values]), catch: (e) => e as pg.DatabaseError })))

/** The table shape the kernel's pg store creates for every cube table (core/src/pg/setup.ts). */
const createTable = (table: string, schema = SCHEMA) =>
  `CREATE TABLE "${schema}"."${table}" (
     id text PRIMARY KEY,
     type text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     deleted boolean NOT NULL DEFAULT false,
     version integer NOT NULL DEFAULT 1,
     body jsonb NOT NULL
   )`

const insertGroupSql = `INSERT INTO "${SCHEMA}"."contact_groups" (id, type, deleted, body) VALUES ($1, 'ContactGroup', $2, $3)`
const groupValues = (id: string, name: string, deleted = false) => [id, deleted, JSON.stringify({ name, normalizedName: name.trim().toLowerCase() })]
const insertGroup = (id: string, name: string, deleted = false) => exec(insertGroupSql, groupValues(id, name, deleted))
const insertMemberSql = `INSERT INTO "${SCHEMA}"."contact_group_members" (id, type, deleted, body) VALUES ($1, 'ContactGroupMember', $2, $3)`
const memberValues = (id: string, groupId: string, contactId: string) => [id, false, JSON.stringify({ groupId, contactId })]
const insertMember = (id: string, groupId: string, contactId: string) => exec(insertMemberSql, memberValues(id, groupId, contactId))

const indexdefIn = (schema: string, index: string) =>
  Effect.map(exec<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [schema, index]), (r) => r.rows)
const countIn = (text: string) => Effect.map(exec<{ n: number }>(text), (r) => r.rows[0]?.n)

// Live clock: the drop's retry schedule must really sleep, not wait on a TestClock.
layer(db, { timeout: 60_000, excludeTestServices: true })((it) => {
  describe("ensure-contact-group-indexes, against a real server", () => {
    it.effect("reports absent tables and creates nothing before the kernel has made them", () =>
      Effect.gen(function* () {
        const client = yield* Db
        const targets = yield* planOn(client)
        expect(targets.length).toBe(2)
        for (const t of targets) {
          expect(t.tableExists).toBe(false)
          expect(t.indexState).toBe("missing")
          expect(t.conflicts).toEqual([])
        }
        const { stats, details } = yield* applyOn(client)
        // SKIPPED, not failed: nothing went wrong -- but the guarantee is not installed either.
        expect(stats).toEqual({ scanned: 2, created: 0, exists: 0, skipped: 2, failed: 0 })
        expect(allReady(stats), "a skipped target must never read as 'installed'").toBe(false)
        for (const d of details) {
          expect(d.result).toBe("absent-table")
          expect(d.detail).toMatch(/does not exist yet/)
        }
      }))

    it.effect("blocks a target whose live rows already duplicate the key, and repairs nothing", () =>
      Effect.gen(function* () {
        const client = yield* Db
        yield* exec(`CREATE SCHEMA "${SCHEMA}"`)
        yield* exec(createTable("contact_groups"))
        yield* exec(createTable("contact_group_members"))
        // Two live groups whose names differ only in case and surrounding space: one key, two rows.
        yield* insertGroup("cgrp-1", "Key accounts")
        yield* insertGroup("cgrp-2", "  KEY ACCOUNTS ")

        expect(yield* tableExists(client, SCHEMA, "contact_groups")).toBe(true)
        const conflicts = yield* conflictsOf(client, target(0), DEFAULT_LIMIT)
        expect(conflicts.length).toBe(1)
        expect(conflicts[0]!.rows).toBe(2)
        expect(conflicts[0]!.ids).toEqual(["cgrp-1", "cgrp-2"])
        // Counts and row ids only: a group NAME is business data and must not reach the report.
        expect(JSON.stringify(conflicts).toLowerCase()).not.toContain("key accounts")

        const { stats, details } = yield* applyOn(client)
        expect(stats.created, "the membership index has nothing blocking it and must be created").toBe(1)
        expect(stats.failed).toBe(1)
        const blocked = details.find((d) => d.spec.index === NAME_INDEX)!
        expect(blocked.result).toBe("blocked")
        expect(blocked.detail).toMatch(/reconciled first/)
        // Nothing was repaired: both rows are still live.
        expect(yield* countIn(`SELECT count(*)::int AS n FROM "${SCHEMA}"."contact_groups" WHERE deleted = false`)).toBe(2)
        expect(yield* indexState(client, target(0))).toBe("missing")
      }))

    it.effect("creates the index once the duplicate is gone, and renders exactly the definition the cube expects", () =>
      Effect.gen(function* () {
        // The operator's decision, not the tool's: one of the two is retired.
        yield* exec(`UPDATE "${SCHEMA}"."contact_groups" SET deleted = true WHERE id = 'cgrp-2'`)
        const { stats } = yield* applyOn(yield* Db)
        expect(stats).toEqual({ scanned: 2, created: 1, exists: 1, skipped: 0, failed: 0 })
        for (const spec of TARGETS) {
          const rows = yield* indexdefIn(spec.schema, spec.index)
          expect(rows.length, `${spec.index} was not created`).toBe(1)
          // THE assertion this file exists for: the definition rendered from the DECLARATION is what
          // PostgreSQL renders -- which also keeps this renderer and the kernel's from drifting apart.
          expect(normalizeIndexDef(rows[0]!.indexdef)).toBe(spec.def)
          expect(rows[0]!.indexdef).toMatch(/CREATE UNIQUE INDEX/)
          expect(rows[0]!.indexdef).toMatch(/deleted = false/)
        }
      }))

    it.effect("is idempotent: a second run creates nothing and reports both as existing", () =>
      Effect.gen(function* () {
        const client = yield* Db
        expect((yield* applyOn(client)).stats).toEqual({ scanned: 2, created: 0, exists: 2, skipped: 0, failed: 0 })
        for (const t of yield* planOn(client)) expect(t.indexState).toBe("ready")
      }))

    it.effect("does not call rows with a NULL key duplicates -- the index does not either", () =>
      Effect.gen(function* () {
        const client = yield* Db
        const put = (id: string, body: unknown) =>
          exec(`INSERT INTO "${SCHEMA}"."contact_groups" (id, type, deleted, body) VALUES ($1, 'ContactGroup', false, $2)`, [
            id,
            JSON.stringify(body),
          ])
        // Three live rows with no name at all, and one with an explicit JSON null: four NULL keys.
        yield* put("cgrp-null-1", {})
        yield* put("cgrp-null-2", {})
        yield* put("cgrp-null-3", { normalizedName: "" })
        yield* put("cgrp-null-4", { name: null })
        // The server accepted all four WHILE the unique index exists: they are not duplicates to Postgres.
        expect(yield* conflictsOf(client, target(0), DEFAULT_LIMIT), "NULL keys are not a blocking set").toEqual([])
        const pairs = yield* exec(
          `INSERT INTO "${SCHEMA}"."contact_group_members" (id, type, deleted, body)
           VALUES ('cgm-null-1', 'ContactGroupMember', false, '{"contactId":"cont-9"}'::jsonb),
                  ('cgm-null-2', 'ContactGroupMember', false, '{"contactId":"cont-9"}'::jsonb)
           RETURNING id`,
        )
        expect(pairs.rowCount, "a NULL groupId is distinct from another NULL groupId").toBe(2)
        // A partially NULL key counts as NULL for the whole index, so the pair target stays clean too.
        expect(yield* conflictsOf(client, target(1), DEFAULT_LIMIT)).toEqual([])
        expect((yield* applyOn(client)).stats).toEqual({ scanned: 2, created: 0, exists: 2, skipped: 0, failed: 0 })
      }))

    it.effect("the DATABASE refuses a duplicate name, whatever its case or spacing", () =>
      Effect.gen(function* () {
        const taken = yield* refused(insertGroupSql, groupValues("cgrp-3", "key ACCOUNTS  "))
        expect(taken.code).toBe("23505")
        expect(taken.constraint, "the cube maps THIS constraint name to its 409").toBe(NAME_INDEX)
        // A different name is not a duplicate...
        yield* insertGroup("cgrp-4", "Key accounts EMEA")
        // ...and a soft-deleted group's name is free again: the index is PARTIAL on live rows.
        yield* insertGroup("cgrp-5", "Newsletter Q3")
        yield* exec(`UPDATE "${SCHEMA}"."contact_groups" SET deleted = true WHERE id = 'cgrp-5'`)
        yield* insertGroup("cgrp-6", "  newsletter q3 ")
      }))

    it.effect("the DATABASE refuses a duplicate live membership pair and frees it on removal", () =>
      Effect.gen(function* () {
        yield* insertMember("cgm-1", "cgrp-1", "cont-1")
        const taken = yield* refused(insertMemberSql, memberValues("cgm-2", "cgrp-1", "cont-1"))
        expect(taken.code).toBe("23505")
        expect(taken.constraint, "the cube treats THIS constraint name as idempotence, not conflict").toBe(PAIR_INDEX)
        // The same contact in another group, and another contact in the same group: both allowed.
        yield* insertMember("cgm-3", "cgrp-4", "cont-1")
        yield* insertMember("cgm-4", "cgrp-1", "cont-2")
        // Removal is a soft delete, and it frees the pair.
        yield* exec(`UPDATE "${SCHEMA}"."contact_group_members" SET deleted = true WHERE id = 'cgm-1'`)
        yield* insertMember("cgm-5", "cgrp-1", "cont-1")
      }))

    it.effect("refuses an index that carries the right name with a different definition", () =>
      Effect.gen(function* () {
        const client = yield* Db
        // A spec whose expected definition differs: the index in the database is then the 'wrong' one.
        const wrong = { ...target(0), def: `${target(0).def}anddeliberatelydifferent` }
        expect(yield* indexState(client, wrong)).toBe("mismatch")
        const outcome = yield* applyOne(client, wrong, DEFAULT_LIMIT)
        expect(outcome.result).toBe("mismatch")
        expect(outcome.detail).toMatch(/never drops an index/)
      }))

    it.effect("proves a wrong-key pair index is NOT ready, on the real server", () =>
      Effect.gen(function* () {
        const client = yield* Db
        // The CORRECT name on 'groupid'/'contactid': every key is (NULL, NULL), so it refuses nothing --
        // and a lowercase-everything normalizer rendered it byte-identical to the real one.
        const wrongSchema = `${SCHEMA}-wrongkey`
        yield* exec(`CREATE SCHEMA "${wrongSchema}"`)
        yield* exec(createTable("contact_group_members", wrongSchema))
        yield* exec(
          `CREATE UNIQUE INDEX "${PAIR_INDEX}" ON "${wrongSchema}"."contact_group_members" ` +
            `((body ->> 'groupid'), (body ->> 'contactid')) WHERE deleted = false`,
        )
        const spec = { ...target(1), schema: wrongSchema, def: target(1).def.replace(`${SCHEMA}.`, `${wrongSchema}.`) }

        // 1. the tool and the cube both refuse it.
        expect(yield* indexState(client, spec)).toBe("mismatch")
        const outcome = yield* applyOne(client, spec, DEFAULT_LIMIT)
        expect(outcome.result).toBe("mismatch")
        expect(outcome.detail).toMatch(/never drops an index/)

        // 2. it really is worthless: the same pair goes in twice with no complaint.
        const insertInto = (id: string) =>
          exec(`INSERT INTO "${wrongSchema}"."contact_group_members" (id, type, deleted, body) VALUES ($1, 'ContactGroupMember', false, $2)`, [
            id,
            JSON.stringify({ groupId: "cgrp-1", contactId: "cont-1" }),
          ])
        yield* insertInto("cgm-w1")
        yield* insertInto("cgm-w2")
        expect(
          yield* countIn(`SELECT count(*)::int AS n FROM "${wrongSchema}"."contact_group_members"`),
          "the wrong-key index enforces nothing -- which is why it must never read as ready",
        ).toBe(2)

        // 3. and the OLD rule could not see the difference: the regression, stated as code.
        const renderedWrong = (yield* indexdefIn(wrongSchema, PAIR_INDEX))[0]!.indexdef
        const renderedRight = (yield* indexdefIn(SCHEMA, PAIR_INDEX))[0]!.indexdef
        const kernelStyle = (d: string) => d.replace(/::text/g, "").replace(/[\s"]/g, "").toLowerCase()
        expect(kernelStyle(renderedWrong), "the lowercase-everything rule cannot tell the two apart -- that is the bug").toBe(
          kernelStyle(renderedRight).replace(`${SCHEMA}.`, `${wrongSchema}.`),
        )
        expect(normalizeIndexDef(renderedWrong)).not.toBe(normalizeIndexDef(renderedRight).replace(`${SCHEMA}.`, `${wrongSchema}.`))
        expect(normalizeIndexDef(renderedRight), "the real index still matches its rendering").toBe(target(1).def)
      }))

    it.effect("refuses the leftover of a failed CREATE INDEX CONCURRENTLY, and never rebuilds it", () =>
      Effect.gen(function* () {
        const client = yield* Db
        // A CONCURRENTLY build that hits a duplicate leaves indisvalid = false, indisready = false: it
        // enforces NOTHING, yet pg_indexes renders it like a healthy one. The tool must agree with the GATE.
        const invalidSchema = `${SCHEMA}-invalid`
        yield* exec(`CREATE SCHEMA "${invalidSchema}"`)
        yield* exec(createTable("contact_groups", invalidSchema))
        const put = (id: string, name: string) =>
          exec(`INSERT INTO "${invalidSchema}"."contact_groups" (id, type, deleted, body) VALUES ($1, 'ContactGroup', false, $2)`, [
            id,
            JSON.stringify({ name }),
          ])
        yield* put("cgrp-i1", "Twice")
        yield* put("cgrp-i2", " twice ")

        const spec = { ...target(0), schema: invalidSchema, def: target(0).def.replace(`${SCHEMA}.`, `${invalidSchema}.`) }
        // Built CONCURRENTLY on purpose: the only way to leave an invalid index behind.
        const build = yield* refused(
          `CREATE UNIQUE INDEX CONCURRENTLY "${NAME_INDEX}" ON "${invalidSchema}"."contact_groups" ${spec.on} WHERE ${spec.where}`,
        )
        expect(build.code).toBe("23505")
        const flags = yield* exec(
          `SELECT i.indisvalid, i.indisready FROM pg_index i
             JOIN pg_class ci ON ci.oid = i.indexrelid
             JOIN pg_namespace n ON n.oid = ci.relnamespace
            WHERE n.nspname = $1 AND ci.relname = $2`,
          [invalidSchema, NAME_INDEX],
        )
        expect(flags.rows).toEqual([{ indisvalid: false, indisready: false }])

        // 1. its definition is right, so a definition-only rule cannot see the problem at all.
        const rendered = (yield* indexdefIn(invalidSchema, NAME_INDEX))[0]!.indexdef
        expect(normalizeIndexDef(rendered), "an invalid index renders exactly like a healthy one").toBe(spec.def)

        // 2. the tool reads the catalog flags and refuses it, without dropping or rebuilding anything.
        expect(yield* indexState(client, spec)).toBe("invalid")
        const outcome = yield* applyOne(client, spec, DEFAULT_LIMIT)
        expect(outcome.result).toBe("invalid")
        expect(outcome.detail).toMatch(/DROP/)
        expect((yield* indexdefIn(invalidSchema, NAME_INDEX)).length, "the tool must leave the operator's index where it was").toBe(1)

        // 3. and it really enforces nothing, which is why 'invalid' may never count as ready.
        yield* put("cgrp-i3", "TWICE")
        expect(yield* countIn(`SELECT count(*)::int AS n FROM "${invalidSchema}"."contact_groups"`)).toBe(3)
        expect(allReady({ scanned: 1, created: 0, exists: 0, skipped: 0, failed: 1 })).toBe(false)
      }))

    it.effect("emits machine-readable rows for an auditor", () =>
      Effect.gen(function* () {
        const lines = planCsv(yield* planOn(yield* Db)).split("\n")
        expect(lines[0]).toBe("schema,table,index,tableExists,indexState,conflictSets,conflictRows")
        expect(lines.length).toBe(3)
        for (const line of lines.slice(1)) expect(line).toMatch(/,true,ready,0,0$/)
      }))
  })
})
