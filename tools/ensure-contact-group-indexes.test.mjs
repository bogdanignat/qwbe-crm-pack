// Tests for the contact-group unique-index tool, against a REAL PostgreSQL server.
//
// Why a real server and not a double: the whole point of these two indexes is that Postgres --
// not the application -- is the arbiter of uniqueness, and the cube's write gate compares the
// rendered `indexdef` against a constant. A test with a fake client would prove nothing about
// either. So a throwaway database is created (`qwbe_cgidx_<rand>`, same recipe as
// ensure-external-id-index.test.mjs), the cube's own schema and tables are created in it exactly
// as the kernel's pg store creates them, and the tool is run against it.
//
// What is proven:
//   1. absent tables are REPORTED, never silently "succeeded" -- an index quietly skipped would
//      leave the cube without its guarantee;
//   2. live duplicates BLOCK their own target, are reported as counts and row ids only (never
//      names -- those are business data), and are never repaired by the tool;
//   3. the index is created once and the second run reports "exists" (idempotent);
//   4. the definition RENDERED from the cube's declaration is exactly what PostgreSQL writes into
//      the catalog -- this is what keeps the tool's renderer honest against the kernel's, since the
//      cube's write gate compares the kernel's rendering of the same declaration;
//   5. the DATABASE refuses a duplicate name (case- and space-insensitive) and a duplicate live
//      membership pair, with the constraint names the cube maps to its domain errors;
//   6. a soft delete frees both the name and the pair;
//   7. an index carrying the right NAME with a different definition is refused, not accepted;
//   8. an INVALID index -- the leftover of a failed CREATE INDEX CONCURRENTLY, whose definition is
//      character-for-character right and which enforces nothing -- is refused too, and never
//      dropped or rebuilt;
//   9. the argument guards: --apply is refused without --i-understand;
//  10. rows whose KEY IS NULL are not duplicates -- NULLs are distinct in a unique index, so
//      reporting them as a blocking set would send an operator reconciling rows the index does not
//      care about, and would report `blocked` for an index that builds cleanly;
//
// WHAT IS NOT HERE, AND WHY. Items 11 (the declaration gate) and 12 (the INSTALLED layout), the
// renderer's own assertions and the argument guards need no server at all, and they used to sit in
// this file below the real-server suites -- where the `requireDbUrl()` call BELOW, at module scope,
// made them unreachable: a top-level throw is an import failure, so on a checkout with no database
// those suites were not skipped, they were never collected. They live in
// tools/ensure-contact-group-indexes.spec.test.mjs now, which has nothing at module scope that can
// refuse to load, and both files are in `npm test`.
//
// Needs QWBE_DATABASE_URL (or QWBE_PG_PASSWORD) pointing at a server where the connecting role
// may CREATE DATABASE. Nothing outside the throwaway database is touched. `requireDbUrl()` is
// called at module scope on purpose: a suite that silently passed without a server would be worse
// than one that refuses to import.

import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, describe, it } from "node:test"
import pg from "pg"
import { requireDbUrl } from "./db-url.mjs"
import { dropThrowawayDb } from "./drop-throwaway-db.mjs"
// The same leaf the TOOL reads, deliberately -- importing the cube's service module here would
// hide the one thing the installed-layout test below proves.
import { NAME_INDEX, PAIR_INDEX, SCHEMA } from "../cubes/crm/contact-groups/invariant.ts"
import {
  DEFAULT_LIMIT,
  TARGETS,
  allReady,
  applyOn,
  applyOne,
  conflictsOf,
  indexState,
  normalizeIndexDef,
  planCsv,
  planOn,
  tableExists,
} from "./ensure-contact-group-indexes.mjs"

// Kept only because `dirname(fileURLToPath(...))` is how this file finds its own directory; the
// layout-rebuilding helpers left with their suites (see the spec file named in the header).
const HERE = dirname(fileURLToPath(import.meta.url))

const admin = new pg.Pool({ connectionString: requireDbUrl().toString(), max: 1 })
const dbName = `qwbe_cgidx_${randomBytes(4).toString("hex")}`
if (!dbName.startsWith("qwbe_cgidx_")) throw new Error("refusing: throwaway database name guard")

let pool
let client

/** The table shape the kernel's pg store creates for every cube table (core/src/pg/setup.ts).
 *  Copied rather than imported because the tool must work against what the SERVER holds. */
const createTable = (table) =>
  `CREATE TABLE "${SCHEMA}"."${table}" (
     id text PRIMARY KEY,
     type text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     deleted boolean NOT NULL DEFAULT false,
     version integer NOT NULL DEFAULT 1,
     body jsonb NOT NULL
   )`

const insertGroup = (id, name, deleted = false) =>
  client.query(`INSERT INTO "${SCHEMA}"."contact_groups" (id, type, deleted, body) VALUES ($1, 'ContactGroup', $2, $3)`, [
    id,
    deleted,
    JSON.stringify({ name, normalizedName: name.trim().toLowerCase() }),
  ])

const insertMember = (id, groupId, contactId, deleted = false) =>
  client.query(
    `INSERT INTO "${SCHEMA}"."contact_group_members" (id, type, deleted, body) VALUES ($1, 'ContactGroupMember', $2, $3)`,
    [id, deleted, JSON.stringify({ groupId, contactId })],
  )

before(async () => {
  await admin.query(`CREATE DATABASE "${dbName}"`)
  const url = requireDbUrl()
  url.pathname = `/${dbName}`
  pool = new pg.Pool({ connectionString: url.toString(), max: 1 })
  pool.on("error", () => {}) // a late FATAL from the server must never crash the file
  client = await pool.connect()
})

after(async () => {
  client?.release()
  await pool?.end()
  await dropThrowawayDb(admin, dbName).catch(() => {})
  await admin.end()
})

describe("ensure-contact-group-indexes, against a real server", () => {
  it("reports absent tables and creates nothing before the kernel has made them", async () => {
    const targets = await planOn(client)
    assert.equal(targets.length, 2)
    for (const t of targets) {
      assert.equal(t.tableExists, false)
      assert.equal(t.indexState, "missing")
      assert.deepEqual(t.conflicts, [])
    }
    const { stats, details } = await applyOn(client)
    // A table the kernel has not created yet is SKIPPED, not failed: the tool did not try and
    // nothing went wrong -- but the guarantee is not installed, so the run is still not a success.
    assert.deepEqual(stats, { scanned: 2, created: 0, exists: 0, skipped: 2, failed: 0 })
    assert.equal(allReady(stats), false, "a skipped target must never read as 'installed'")
    for (const d of details) {
      assert.equal(d.result, "absent-table")
      assert.match(d.detail, /does not exist yet/)
    }
  })

  it("blocks a target whose live rows already duplicate the key, and repairs nothing", async () => {
    await client.query(`CREATE SCHEMA "${SCHEMA}"`)
    await client.query(createTable("contact_groups"))
    await client.query(createTable("contact_group_members"))
    // Two live groups whose names differ only in case and surrounding space: one key, two rows.
    await insertGroup("cgrp-1", "Key accounts")
    await insertGroup("cgrp-2", "  KEY ACCOUNTS ")

    assert.equal(await tableExists(client, SCHEMA, "contact_groups"), true)
    const conflicts = await conflictsOf(client, TARGETS[0], DEFAULT_LIMIT)
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].rows, 2)
    assert.deepEqual(conflicts[0].ids, ["cgrp-1", "cgrp-2"])
    // Counts and row ids only: a group NAME is business data and must not reach the report.
    assert.ok(!JSON.stringify(conflicts).toLowerCase().includes("key accounts"), JSON.stringify(conflicts))

    const { stats, details } = await applyOn(client)
    assert.equal(stats.created, 1, "the membership index has nothing blocking it and must be created")
    assert.equal(stats.failed, 1)
    const blocked = details.find((d) => d.spec.index === NAME_INDEX)
    assert.equal(blocked.result, "blocked")
    assert.match(blocked.detail, /reconciled first/)
    // Nothing was repaired: both rows are still live, still named as they were.
    const rows = await client.query(`SELECT count(*)::int AS n FROM "${SCHEMA}"."contact_groups" WHERE deleted = false`)
    assert.equal(rows.rows[0].n, 2)
    assert.equal(await indexState(client, TARGETS[0]), "missing")
  })

  it("creates the index once the duplicate is gone, and renders exactly the definition the cube expects", async () => {
    // The operator's decision, not the tool's: one of the two is retired.
    await client.query(`UPDATE "${SCHEMA}"."contact_groups" SET deleted = true WHERE id = 'cgrp-2'`)
    const { stats } = await applyOn(client)
    assert.deepEqual(stats, { scanned: 2, created: 1, exists: 1, skipped: 0, failed: 0 })

    for (const spec of TARGETS) {
      const r = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
        spec.schema,
        spec.index,
      ])
      assert.equal(r.rowCount, 1, `${spec.index} was not created`)
      // THE assertion this whole file exists for: the definition rendered from the cube's
      // DECLARATION is what PostgreSQL actually renders. The kernel renders the same declaration
      // for its write gate, so this is also what proves the two renderers cannot drift apart.
      assert.equal(normalizeIndexDef(r.rows[0].indexdef), spec.def)
      assert.match(r.rows[0].indexdef, /CREATE UNIQUE INDEX/)
      assert.match(r.rows[0].indexdef, /deleted = false/)
    }
  })

  it("is idempotent: a second run creates nothing and reports both as existing", async () => {
    const { stats } = await applyOn(client)
    assert.deepEqual(stats, { scanned: 2, created: 0, exists: 2, skipped: 0, failed: 0 })
    const targets = await planOn(client)
    for (const t of targets) assert.equal(t.indexState, "ready")
  })

  it("does not call rows with a NULL key duplicates -- the index does not either", async () => {
    // Postgres treats NULLs in a unique index as DISTINCT (nothing here renders NULLS NOT
    // DISTINCT), so any number of rows whose key expression is NULL coexist and CREATE UNIQUE
    // INDEX over them succeeds. A key is NULL when the body field is absent or JSON null, and
    // `lower(btrim(NULL))` is NULL as well. Counting them made the tool report `blocked` on an
    // index that builds cleanly, and sent the operator reconciling rows the index ignores.
    const put = (id, body) =>
      client.query(
        `INSERT INTO "${SCHEMA}"."contact_groups" (id, type, deleted, body) VALUES ($1, 'ContactGroup', false, $2)`,
        [id, JSON.stringify(body)],
      )
    // Three live rows with no name at all, and one with an explicit JSON null: four NULL keys.
    await put("cgrp-null-1", {})
    await put("cgrp-null-2", {})
    await put("cgrp-null-3", { normalizedName: "" })
    await put("cgrp-null-4", { name: null })
    // The server accepted all four WHILE the unique index exists -- the proof that they are not
    // duplicates to Postgres, which is what the tool must agree with.
    assert.deepEqual(await conflictsOf(client, TARGETS[0], DEFAULT_LIMIT), [], "NULL keys are not a blocking set")
    const pairs = (await client.query(
      `INSERT INTO "${SCHEMA}"."contact_group_members" (id, type, deleted, body)
       VALUES ('cgm-null-1', 'ContactGroupMember', false, '{"contactId":"cont-9"}'::jsonb),
              ('cgm-null-2', 'ContactGroupMember', false, '{"contactId":"cont-9"}'::jsonb)
       RETURNING id`,
    )).rowCount
    assert.equal(pairs, 2, "a NULL groupId is distinct from another NULL groupId")
    // A partially NULL key counts as NULL for the whole index, so the pair target stays clean too.
    assert.deepEqual(await conflictsOf(client, TARGETS[1], DEFAULT_LIMIT), [])

    // And the run over a database holding them is still a clean, idempotent success.
    const { stats } = await applyOn(client)
    assert.deepEqual(stats, { scanned: 2, created: 0, exists: 2, skipped: 0, failed: 0 })
  })

  it("the DATABASE refuses a duplicate name, whatever its case or spacing", async () => {
    const taken = await insertGroup("cgrp-3", "key ACCOUNTS  ").then(
      () => null,
      (e) => e,
    )
    assert.ok(taken, "the server accepted a duplicate name")
    assert.equal(taken.code, "23505")
    assert.equal(taken.constraint, NAME_INDEX, "the cube maps THIS constraint name to its 409")
    // A different name is not a duplicate...
    await insertGroup("cgrp-4", "Key accounts EMEA")
    // ...and a name a soft-deleted group used to hold is free again: the index is PARTIAL on
    // live rows, which is exactly what makes a retired group's name reusable.
    await insertGroup("cgrp-5", "Newsletter Q3")
    await client.query(`UPDATE "${SCHEMA}"."contact_groups" SET deleted = true WHERE id = 'cgrp-5'`)
    await insertGroup("cgrp-6", "  newsletter q3 ")
  })

  it("the DATABASE refuses a duplicate live membership pair and frees it on removal", async () => {
    await insertMember("cgm-1", "cgrp-1", "cont-1")
    const taken = await insertMember("cgm-2", "cgrp-1", "cont-1").then(
      () => null,
      (e) => e,
    )
    assert.ok(taken, "the server accepted a duplicate membership pair")
    assert.equal(taken.code, "23505")
    assert.equal(taken.constraint, PAIR_INDEX, "the cube treats THIS constraint name as idempotence, not conflict")

    // The same contact in another group, and another contact in the same group: both allowed.
    await insertMember("cgm-3", "cgrp-4", "cont-1")
    await insertMember("cgm-4", "cgrp-1", "cont-2")
    // Removal is a soft delete, and it frees the pair.
    await client.query(`UPDATE "${SCHEMA}"."contact_group_members" SET deleted = true WHERE id = 'cgm-1'`)
    await insertMember("cgm-5", "cgrp-1", "cont-1")
  })

  it("refuses an index that carries the right name with a different definition", async () => {
    // Simulated by asking about a spec whose expected definition differs: the tool compares
    // definitions, so the index in the database is the one that is 'wrong'.
    const wrong = { ...TARGETS[0], def: `${TARGETS[0].def}anddeliberatelydifferent` }
    assert.equal(await indexState(client, wrong), "mismatch")
    const outcome = await applyOne(client, wrong, DEFAULT_LIMIT)
    assert.equal(outcome.result, "mismatch")
    assert.match(outcome.detail, /never drops an index/)
  })

  it("proves a wrong-key pair index is NOT ready, on the real server", async () => {
    // The finding this pins, reproduced end to end: an index carrying the CORRECT name, built on
    // 'groupid'/'contactid' instead of 'groupId'/'contactId'. Every row's key is then (NULL, NULL),
    // NULLs are distinct in a btree, so the index refuses nothing at all -- and the old
    // lowercase-everything normalizer rendered it byte-identical to the real one, so both the
    // cube's write gate and this tool called it "ready".
    const wrongSchema = `${SCHEMA}-wrongkey`
    await client.query(`CREATE SCHEMA "${wrongSchema}"`)
    await client.query(createTable("contact_group_members").replace(`"${SCHEMA}"`, `"${wrongSchema}"`))
    await client.query(
      `CREATE UNIQUE INDEX "${PAIR_INDEX}" ON "${wrongSchema}"."contact_group_members" ` +
        `((body ->> 'groupid'), (body ->> 'contactid')) WHERE deleted = false`,
    )
    const spec = {
      ...TARGETS[1],
      schema: wrongSchema,
      def: TARGETS[1].def.replace(`${SCHEMA}.`, `${wrongSchema}.`),
    }

    // 1. the tool and the cube both refuse it.
    assert.equal(await indexState(client, spec), "mismatch")
    const outcome = await applyOne(client, spec, DEFAULT_LIMIT)
    assert.equal(outcome.result, "mismatch")
    assert.match(outcome.detail, /never drops an index/)

    // 2. it really is worthless: the same pair goes in twice with no complaint.
    const insertInto = (id) =>
      client.query(
        `INSERT INTO "${wrongSchema}"."contact_group_members" (id, type, deleted, body) ` +
          `VALUES ($1, 'ContactGroupMember', false, $2)`,
        [id, JSON.stringify({ groupId: "cgrp-1", contactId: "cont-1" })],
      )
    await insertInto("cgm-w1")
    await insertInto("cgm-w2")
    const n = await client.query(`SELECT count(*)::int AS n FROM "${wrongSchema}"."contact_group_members"`)
    assert.equal(n.rows[0].n, 2, "the wrong-key index enforces nothing -- which is why it must never read as ready")

    // 3. and the OLD rule could not see the difference: this is the regression, stated as code.
    const renderedWrong = (
      await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
        wrongSchema,
        PAIR_INDEX,
      ])
    ).rows[0].indexdef
    const renderedRight = (
      await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
        SCHEMA,
        PAIR_INDEX,
      ])
    ).rows[0].indexdef
    const kernelStyle = (d) => d.replace(/::text/g, "").replace(/[\s"]/g, "").toLowerCase()
    assert.equal(
      kernelStyle(renderedWrong),
      kernelStyle(renderedRight).replace(`${SCHEMA}.`, `${wrongSchema}.`),
      "the lowercase-everything rule cannot tell the two apart -- that is the bug",
    )
    assert.notEqual(normalizeIndexDef(renderedWrong), normalizeIndexDef(renderedRight).replace(`${SCHEMA}.`, `${wrongSchema}.`))
    assert.equal(normalizeIndexDef(renderedRight), TARGETS[1].def, "the real index still matches its rendering")
  })

  it("refuses the leftover of a failed CREATE INDEX CONCURRENTLY, and never rebuilds it", async () => {
    // The second half of the same finding: an INVALID index. A CREATE INDEX CONCURRENTLY that hits
    // a duplicate leaves the catalog entry behind with indisvalid = false, indisready = false --
    // it enforces NOTHING, yet pg_indexes renders it character-for-character like a healthy one.
    // A definition-only check (the pg_indexes view has no validity column) calls it ready; the
    // kernel's write gate reads pg_index and refuses. This tool must agree with the GATE.
    const invalidSchema = `${SCHEMA}-invalid`
    await client.query(`CREATE SCHEMA "${invalidSchema}"`)
    await client.query(createTable("contact_groups").replace(`"${SCHEMA}"`, `"${invalidSchema}"`))
    const put = (id, name) =>
      client.query(
        `INSERT INTO "${invalidSchema}"."contact_groups" (id, type, deleted, body) ` +
          `VALUES ($1, 'ContactGroup', false, $2)`,
        [id, JSON.stringify({ name })],
      )
    await put("cgrp-i1", "Twice")
    await put("cgrp-i2", " twice ")

    const spec = {
      ...TARGETS[0],
      schema: invalidSchema,
      def: TARGETS[0].def.replace(`${SCHEMA}.`, `${invalidSchema}.`),
    }
    // Built CONCURRENTLY on purpose: that is the only way to leave an invalid index behind.
    await assert.rejects(
      () =>
        client.query(
          `CREATE UNIQUE INDEX CONCURRENTLY "${NAME_INDEX}" ON "${invalidSchema}"."contact_groups" ` +
            `${spec.on} WHERE ${spec.where}`,
        ),
      (error) => error.code === "23505",
    )
    const flags = await client.query(
      `SELECT i.indisvalid, i.indisready FROM pg_index i
         JOIN pg_class ci ON ci.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = ci.relnamespace
        WHERE n.nspname = $1 AND ci.relname = $2`,
      [invalidSchema, NAME_INDEX],
    )
    assert.deepEqual(flags.rows, [{ indisvalid: false, indisready: false }])

    // 1. its definition is right, so a definition-only rule cannot see the problem at all.
    const rendered = (
      await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
        invalidSchema,
        NAME_INDEX,
      ])
    ).rows[0].indexdef
    assert.equal(normalizeIndexDef(rendered), spec.def, "an invalid index renders exactly like a healthy one")

    // 2. the tool reads the catalog flags and refuses it, without dropping or rebuilding anything.
    assert.equal(await indexState(client, spec), "invalid")
    const outcome = await applyOne(client, spec, DEFAULT_LIMIT)
    assert.equal(outcome.result, "invalid")
    assert.match(outcome.detail, /DROP/)
    const still = await client.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
      invalidSchema,
      NAME_INDEX,
    ])
    assert.equal(still.rows[0].n, 1, "the tool must leave the operator's index exactly where it was")

    // 3. and it really enforces nothing, which is why 'invalid' may never count as ready.
    await put("cgrp-i3", "TWICE")
    const n = await client.query(`SELECT count(*)::int AS n FROM "${invalidSchema}"."contact_groups"`)
    assert.equal(n.rows[0].n, 3)
    assert.equal(allReady({ scanned: 1, created: 0, exists: 0, skipped: 0, failed: 1 }), false)
  })

  it("emits machine-readable rows for an auditor", async () => {
    const csv = planCsv(await planOn(client))
    const lines = csv.split("\n")
    assert.equal(lines[0], "schema,table,index,tableExists,indexState,conflictSets,conflictRows")
    assert.equal(lines.length, 3)
    for (const line of lines.slice(1)) assert.match(line, /,true,ready,0,0$/)
  })
})
