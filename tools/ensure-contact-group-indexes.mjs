#!/usr/bin/env node
// The two unique indexes crm/contact-groups DECLARES, seen from the operator's side: what the
// database actually holds, what blocks the invariant, and a bounded, transactional way to install
// it on a running system.
//
// WHY THIS STILL EXISTS, now that the kernel installs these itself. The kernel renders and creates
// a declared unique index as the table's OWNER, inside `ensureTable`, on the first touch of each
// table (core/src/pg/setup.ts) -- so an ordinary install needs nothing from this tool, and a dry
// run over a healthy database reports "ready, nothing to do". But that installer is memoized per
// table per database and it swallows a failure PER INDEX on purpose: live rows that already
// duplicate the key make CREATE UNIQUE INDEX fail, the cube then mounts with reads working and
// writes refused, and NOTHING tries again until the process restarts. The same hole opens when an
// index is dropped or replaced on a live system, and when an interrupted CREATE INDEX CONCURRENTLY
// leaves an INVALID index behind that enforces nothing.
//
// This tool is the only thing that closes those states without a restart:
//   * it reports WHAT blocks each index, as counts and row ids, so the operator can decide;
//   * it installs the index in its own transaction behind SHARE ROW EXCLUSIVE, after re-counting
//     the duplicates INSIDE that lock -- the kernel's installer takes no such lock, and a stale
//     dry run must never authorize a write;
//   * the cube's write gate re-reads the catalog before every write, so the very next request
//     succeeds with no restart.
// It is not a second implementation of the invariant: the SPECS come from the cube's own
// declaration (cubes/crm/contact-groups/service.ts `UNIQUE_INDEXES`, the same array the manifest
// hands the kernel), and the DDL and the expected catalog definition are rendered from those keys
// here. No SDK internals are imported: `qwbe-core` publishes the declaration's TYPE, not its
// renderer, and this file must run standalone against a database with no kernel in the process.
//
// SAFETY
//   * dry run is the DEFAULT; --apply alone is refused, it needs --i-understand too
//   * no row is ever created, updated or deleted, and no index is ever dropped or rebuilt
//   * conflicts are recomputed INSIDE the apply transaction, behind SHARE ROW EXCLUSIVE, so a
//     stale dry run cannot authorize a write and no writer can slip a duplicate in between the
//     check and the DDL; reads are never blocked
//   * duplicates are REPORTED, never repaired: deciding what a duplicate should be called is an
//     operator's call, not a tool's
//   * an index that already carries the right name with the WRONG definition, or with the right
//     definition but marked INVALID, is reported as a failure and never accepted -- IF NOT EXISTS
//     is name-based, and `pg_get_indexdef` renders an invalid index exactly like a real one
//   * idempotent: run it again and it creates nothing and reports "exists"
//   * no row values are printed -- counts and row ids only; group names are business data. A
//     server error is reduced to its SQLSTATE and error class (`fault`), never its message:
//     PostgreSQL quotes the colliding key in a 23505, so the message IS a group name
//
// USAGE
//   QWBE_DATABASE_URL=postgres://... node tools/ensure-contact-group-indexes.mjs
//   QWBE_DATABASE_URL=postgres://... node tools/ensure-contact-group-indexes.mjs --apply --i-understand
//
// EXIT CODES  0 both indexes enforcing  ·  1 anything less (missing, blocked, mismatched, invalid,
//             absent table, or an execution failure) -- a dry run over a not-yet-installed index
//             exits 1 too, so a scripted preflight cannot read "the tool ran" as "the invariant
//             holds"  ·  2 bad input

import pg from "pg"
// The DECLARATION only, from the cube's runtime-neutral leaf: it imports nothing but TYPES, so
// nothing of `effect` or `qwbe-core` is loaded here. That is a hard requirement, not tidiness --
// in an installed layout `qwbe-core` resolves inside `node_modules`, where node refuses to strip
// types from a `.ts` file, so importing the cube's service module made this tool die on its import
// line in precisely the incident it exists for (see cubes/crm/contact-groups/invariant.ts).
import { SCHEMA, UNIQUE_INDEXES } from "../cubes/crm/contact-groups/invariant.ts"
import { dbUrl } from "./db-url.mjs"

const qi = (identifier) => `"` + identifier.replace(/"/g, `""`) + `"`

export const DEFAULT_LIMIT = 50

/**
 * A server error reduced to its SQLSTATE and its class, and NOTHING of its message.
 *
 * This tool promises in its header that no row value is ever printed, and a driver message breaks
 * that promise in the one place it matters most: PostgreSQL spells out the colliding key in the
 * error for a failed unique build -- `Key (lower(btrim((body->>'name'::text))))=(ada) is
 * duplicated` -- so printing `e.message` prints a group NAME, which is business data, into an
 * operator log or a CI transcript. `e.detail` and `e.where` carry it too.
 *
 * The SQLSTATE is enough to act on (23505 duplicate key, 42501 insufficient privilege, 53300 too
 * many connections, 57014 cancelled) and it is a closed alphabet, so it is safe to interpolate: the
 * shape test is what makes it safe, not the driver's good behaviour. The class is the error's
 * CONSTRUCTOR name, not its text -- `DatabaseError`, `AggregateError` -- which distinguishes "the
 * server said no" from "this tool threw" without quoting either.
 *
 * Same rule and same regex as the kernel's `sqlstate` (core/src/pg/setup.ts), deliberately: the two
 * diagnostics an operator reads about these indexes must sanitize identically.
 */
export const fault = (e) => {
  const code = e === null || typeof e !== "object" ? undefined : e.code
  const sqlstate = typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code) ? code : "unknown"
  const cls = typeof e?.constructor?.name === "string" && /^[A-Za-z]{1,40}$/.test(e.constructor.name)
    ? e.constructor.name
    : "unknown"
  return `${cls}, SQLSTATE ${sqlstate}`
}

/** The only predicate a declaration may carry (`rows: "active"`). */
const ACTIVE_ROWS = "deleted = false"

// --- the declaration this renderer can actually render ------------------------------------
//
// WHY THIS GATE EXISTS. The cube's declaration is the kernel's contract, and the kernel's renderer
// (core/src/pg-index/unique-index.ts) is free to grow: another predicate than `rows: "active"`,
// another normalization than `lower-btrim`. THIS renderer cannot grow by itself, and its two
// failure modes were both silent:
//
//   * an unknown `normalize` fell into the `plain` branch, so the tool created an index on the RAW
//     value, read it back, compared it against its OWN rendering of the same wrong thing, and
//     reported `created` with exit 0 -- while the kernel's gate, rendering the declaration
//     correctly, refused every write forever. A green operator tool over a permanently shut cube.
//   * `spec.rows` was never read at all, so a future `rows: "all"` would have been built as a
//     PARTIAL index, silently keeping `WHERE deleted = false`.
//
// So the declaration is CHECKED before anything is rendered, and a declaration this file cannot
// render is bad input: exit 2, naming what it does not understand. Upgrading the tool is then a
// deliberate act -- a branch here, and a test against a real server that the catalog agrees.
//
// The shapes are the kernel's `assertRenderable` restated (they cannot be imported: see the import
// note above), which also makes this the interpolation guard for the DDL below -- every string that
// reaches `CREATE UNIQUE INDEX` as an identifier or a quoted literal has passed these.

/** Index and table names: a plain lowercase SQL slug, inside Postgres's 63-byte limit. */
const SAFE_RELATION = /^[a-z][a-z0-9_]{0,62}$/
/** A body field key. Letters, digits and underscore only, so the rendered single-quoted literal
 *  can hold no quote and no backslash. CASE IS PART OF THE KEY: rows carry `groupId`, and
 *  `body->>'groupid'` is NULL on every one of them. */
const SAFE_BODY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,62}$/
/** The schema is DERIVED from the cube name (`schemaName`), so it is that alphabet plus `-`. */
const SAFE_SCHEMA = /^[a-z][a-z0-9-]{0,62}$/
/** More keys than this is not a uniqueness rule, it is a mistake. The kernel's limit. */
const MAX_KEYS = 8
/** Every normalization this file can render. `undefined` means `plain`. */
const RENDERABLE = new Set([undefined, "plain", "lower-btrim"])

/**
 * What this tool cannot render about one declared spec, as a sentence, or `null` when it can.
 * Called on every spec BEFORE `resolveSpec` renders anything.
 */
export const specProblem = (spec) => {
  const where = `${spec?.index ?? "?"} on ${spec?.table ?? "?"}`
  if (!spec || typeof spec !== "object") return `a declaration is not an object`
  if (typeof spec.index !== "string" || !SAFE_RELATION.test(spec.index)) {
    return `${where}: the index name is not a safe identifier`
  }
  if (typeof spec.table !== "string" || !SAFE_RELATION.test(spec.table)) {
    return `${where}: the table name is not a safe identifier`
  }
  if (!SAFE_SCHEMA.test(SCHEMA)) return `${where}: the derived schema ${JSON.stringify(SCHEMA)} is not a cube schema`
  if (spec.rows !== "active") {
    return `${where}: rows ${JSON.stringify(spec.rows)} -- this tool renders only "active" (WHERE ${ACTIVE_ROWS})`
  }
  if (!Array.isArray(spec.keys) || spec.keys.length === 0 || spec.keys.length > MAX_KEYS) {
    return `${where}: the key list must hold between 1 and ${MAX_KEYS} entries`
  }
  for (const key of spec.keys) {
    if (!key || typeof key !== "object" || typeof key.body !== "string" || !SAFE_BODY_KEY.test(key.body)) {
      return `${where}: a key's \`body\` field is not a safe JSON key`
    }
    if (!RENDERABLE.has(key.normalize)) {
      return `${where}: key ${JSON.stringify(key.body)} declares normalize ${JSON.stringify(key.normalize)}, ` +
        `which this tool cannot render (known: plain, lower-btrim)`
    }
  }
  return null
}

/** Everything the declaration asks for that this file cannot render. Empty is the healthy state,
 *  and the only one in which `TARGETS` below is rendered at all. */
export const SPEC_PROBLEMS = UNIQUE_INDEXES.map(specProblem).filter((problem) => problem !== null)

/** The operator's sentence for a declaration this tool does not understand, or `null`. Exit 2:
 *  bad input, not a database state -- nothing was inspected and nothing may be inferred. */
export const specGateError = (problems = SPEC_PROBLEMS) =>
  problems.length === 0
    ? null
    : `refusing to render the cube's declaration: ${problems.join("; ")}. ` +
      `This tool renders the SQL for crm/contact-groups' declared unique indexes itself and the ` +
      `declaration has moved past it -- teach it the new shape (and test it against a real ` +
      `server) before running it; nothing was inspected.`

/** One key as it goes into CREATE UNIQUE INDEX. Mirrors `keySql` (core/src/pg-index/unique-index.ts).
 *  `specProblem` has already refused any normalization other than the two branches below, so the
 *  `plain` branch is `plain`, never "something unrecognised". */
const keySql = (key) => (key.normalize === "lower-btrim" ? `lower(btrim(body->>'${key.body}'))` : `(body->>'${key.body}')`)

/**
 * The same key as `pg_get_indexdef` renders it, already normalized. The asymmetry is Postgres's:
 * an expression key is wrapped in its own parentheses inside the key list, a function call is not.
 * Measured on PostgreSQL 16, and the test asserts it again on a real server on every run -- which
 * is what keeps this renderer honest against the kernel's, since the two must agree byte for byte
 * or the cube's gate and this tool would disagree about the same index.
 */
const keyDef = (key) => (key.normalize === "lower-btrim" ? `lower(btrim((body->>'${key.body}')))` : `((body->>'${key.body}'))`)

/**
 * One declaration resolved for this pack's schema: the schema is DERIVED from the cube name, never
 * declared, and both SQL strings are rendered from the keys. Nothing here is written by hand.
 */
export const resolveSpec = (spec) => {
  const problem = specProblem(spec)
  // Defence in depth, at the render boundary: the gate in `main` is a module away, and a future
  // caller that skipped it would interpolate an unchecked declaration into owner-level DDL.
  if (problem !== null) throw new RangeError(`cannot render a unique index declaration: ${problem}`)
  return {
    schema: SCHEMA,
    table: spec.table,
    index: spec.index,
    keys: spec.keys,
    on: `(${spec.keys.map(keySql).join(", ")})`,
    where: ACTIVE_ROWS,
    def:
      `createuniqueindex${spec.index}on${SCHEMA}.${spec.table}` +
      `usingbtree(${spec.keys.map(keyDef).join(",")})where(deleted=false)`,
  }
}

/** The cube's declaration, resolved, in declaration order -- so a broken database always reports
 *  the same index first. EMPTY when `SPEC_PROBLEMS` is not: importing this module may never throw,
 *  and `main` refuses with exit 2 before a single target is used. */
export const TARGETS = SPEC_PROBLEMS.length === 0 ? UNIQUE_INDEXES.map(resolveSpec) : []

/**
 * Whitespace, quoting and `::text` casts are Postgres's formatting, not the definition -- but
 * SINGLE-QUOTED LITERALS are the definition, so they are left exactly as the catalog renders them.
 * Folding them would be a hole, not a convenience: an index built on `body->>'groupid'` instead of
 * `'groupId'` is NULL for every row, NULLs are distinct in a unique index, and it enforces nothing
 * -- yet a lowercase-everything rule renders it identical to the real one. The kernel's
 * `normalizeIndexDef` splits the same way; the pair-index test below proves the two agree on a
 * real server.
 */
export const normalizeIndexDef = (def) =>
  def
    .split(/('(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/::text/g, "")
            .replace(/[\s"]/g, "")
            .toLowerCase(),
    )
    .join("")

/** The DDL for one resolved spec. `IF NOT EXISTS` is NAME-based, which is exactly why the
 *  definition is checked separately. */
export const indexSql = (s) =>
  `CREATE UNIQUE INDEX IF NOT EXISTS ${qi(s.index)} ON ${qi(s.schema)}.${qi(s.table)} ${s.on} WHERE ${s.where}`

/**
 * The duplicate query per target, rendered from the declared keys so it cannot describe a
 * different key than the index does. Finding what BLOCKS an index is a tool's job, not a domain
 * rule, which is why this lives here and not in the cube. The grouping key is selected to group
 * by and deliberately NOT returned: names are business data.
 *
 * ROWS WITH A NULL KEY ARE NOT DUPLICATES, and that is Postgres's rule, not a convenience: in a
 * unique index NULLs are DISTINCT from each other (the kernel renders no `NULLS NOT DISTINCT`), so
 * any number of rows whose key expression is NULL coexist happily -- `CREATE UNIQUE INDEX` over
 * them succeeds. A key is NULL exactly when the body field is absent or JSON null, and
 * `lower(btrim(NULL))` is NULL too. Counting them as a blocking set made the tool report `blocked`
 * on an index that would have been created cleanly, and sent the operator reconciling rows the
 * index does not care about -- so every key is required NOT NULL here, per key, matching what the
 * index actually enforces.
 */
const duplicatesSql = (spec) => {
  const keyExpr = (k) => (k.normalize === "lower-btrim" ? `lower(btrim(body ->> '${k.body}'))` : `body ->> '${k.body}'`)
  const notNull = spec.keys.map((k) => ` AND (body ->> '${k.body}') IS NOT NULL`).join("")
  return `SELECT count(*)::int AS n, array_agg(id ORDER BY created_at, id) AS ids
     FROM ${qi(spec.schema)}.${qi(spec.table)}
    WHERE ${spec.where}${notNull}
    GROUP BY ${spec.keys.map(keyExpr).join(", ")}
   HAVING count(*) > 1
    ORDER BY 1 DESC
    LIMIT $1`
}

export const tableExists = async (client, schema, table) => {
  const r = await client.query(`SELECT to_regclass($1) AS t`, [`${qi(schema)}.${qi(table)}`])
  return r.rows[0].t !== null
}

/**
 * "ready", "mismatch" (present, wrong definition), "invalid" (present, right definition, but the
 * catalog says it enforces nothing) or "missing".
 *
 * Read through `pg_index`, NOT the `pg_indexes` view, and this is not a detail: a failed CREATE
 * INDEX CONCURRENTLY leaves the index behind with `indisvalid = false`, and `pg_get_indexdef`
 * renders it character for character like the real one -- so the view cannot tell them apart and a
 * duplicate then inserts cleanly. The kernel's write gate checks the same two flags
 * (`requireUniqueIndex`, core/src/pg/setup.ts); a tool that reported "ready" where the gate refuses
 * would send an operator looking in the wrong place.
 */
export const indexState = async (client, spec) => {
  const r = await client.query(
    `SELECT pg_get_indexdef(x.indexrelid) AS indexdef, x.indisvalid AS valid, x.indisready AS ready
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relname = $2 AND i.relname = $3`,
    [spec.schema, spec.table, spec.index],
  )
  if (r.rowCount === 0) return "missing"
  const row = r.rows[0]
  if (normalizeIndexDef(row.indexdef) !== spec.def) return "mismatch"
  return row.valid && row.ready ? "ready" : "invalid"
}

/** Rows that would make CREATE UNIQUE INDEX fail: at most `limit` duplicate sets, as counts and
 *  row ids. */
export const conflictsOf = async (client, spec, limit) => {
  const r = await client.query(duplicatesSql(spec), [limit])
  return r.rows.map((row) => ({ rows: row.n, ids: row.ids }))
}

/** The read path: what is there, what is missing, what blocks it. Writes nothing. */
export const planOn = async (client, limit = DEFAULT_LIMIT) => {
  const targets = []
  for (const spec of TARGETS) {
    const present = await tableExists(client, spec.schema, spec.table)
    const state = present ? await indexState(client, spec) : "missing"
    const conflicts = present ? await conflictsOf(client, spec, limit) : []
    targets.push({ spec, tableExists: present, indexState: state, conflicts })
  }
  return targets
}

/**
 * The write path, one transaction PER TARGET (a missing table on one must not roll the other
 * back). The plan is recomputed inside the transaction behind SHARE ROW EXCLUSIVE, and the created
 * index is read back and compared -- definition AND validity -- before the COMMIT.
 *
 * Partial-failure policy: a target that fails rolls back only itself and is counted in `failed`;
 * the run continues so the report covers every target, and the exit code is 1.
 */
export const applyOne = async (client, spec, limit) => {
  if (!(await tableExists(client, spec.schema, spec.table))) {
    return { result: "absent-table", detail: `table ${spec.schema}.${spec.table} does not exist yet` }
  }
  const before = await indexState(client, spec)
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
  await client.query("BEGIN")
  try {
    // Writes wait, reads do not. This closes the window between "no duplicates" and the DDL.
    await client.query(`LOCK TABLE ${qi(spec.schema)}.${qi(spec.table)} IN SHARE ROW EXCLUSIVE MODE`)
    const conflicts = await conflictsOf(client, spec, limit)
    if (conflicts.length > 0) {
      await client.query("ROLLBACK")
      return { result: "blocked", detail: `${conflicts.length} duplicate set(s) must be reconciled first`, conflicts }
    }
    await client.query(indexSql(spec))
    const after = await indexState(client, spec)
    if (after !== "ready") {
      await client.query("ROLLBACK")
      return { result: "failed", detail: `index ${spec.index} was created but reads back as "${after}"` }
    }
    await client.query("COMMIT")
    return { result: "created" }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  }
}

/**
 * The counters, and what each of them PROMISES -- an operator reads these numbers instead of the
 * prose, so a wrong bucket is a wrong guarantee:
 *
 *   created  the index did not exist, was created, and read back as matching AND valid;
 *   exists   it was already there, its definition matches and the catalog says it enforces (not:
 *            "a thing with that name");
 *   skipped  the tool deliberately did not try, because the table does not exist yet -- the
 *            kernel makes tables on first use, so this is a sequencing step, not a fault, but the
 *            guarantee is NOT installed (see the exit code below);
 *   failed   the tool tried and could not, or refused on purpose: live duplicates block the
 *            target, a same-named index carries a different definition or is marked invalid, or
 *            the server errored.
 *
 * `created + exists === scanned` is the ONLY state in which both invariants are enforced. Anything
 * else exits 1 -- an absent table used to be counted as `failed`, which made a legitimate exit 1
 * unreadable, and counting it as a success would have been a lie in the other direction.
 */
export const applyOn = async (client, limit = DEFAULT_LIMIT) => {
  const stats = { scanned: 0, created: 0, exists: 0, skipped: 0, failed: 0 }
  const details = []
  for (const spec of TARGETS) {
    stats.scanned += 1
    let outcome
    try {
      outcome = await applyOne(client, spec, limit)
    } catch (e) {
      // The SQLSTATE and the error class, never the message: a 23505 from a failed unique build
      // quotes the colliding key, i.e. a group name. See `fault`.
      outcome = { result: "failed", detail: `the server refused this target (${fault(e)})` }
    }
    if (outcome.result === "created") stats.created += 1
    else if (outcome.result === "exists") stats.exists += 1
    else if (outcome.result === "absent-table") stats.skipped += 1
    else stats.failed += 1
    details.push({ spec, ...outcome })
  }
  return { stats, details }
}

/** True only when every target is enforcing. Used for the exit code so no caller has to
 *  re-derive the rule from the counters. */
export const allReady = (stats) => stats.created + stats.exists === stats.scanned

export const HELP = `ensure-contact-group-indexes -- report and repair the unique indexes crm/contact-groups declares

  Scope       the two indexes the cube declares in \`manifest.uniqueIndexes\`, in its own schema:
                contact_groups.contact_groups_name_key
                  UNIQUE ((lower(btrim(body->>'name')))) WHERE deleted = false
                contact_group_members.contact_group_members_pair_key
                  UNIQUE ((body->>'groupId'), (body->>'contactId')) WHERE deleted = false
              Both are PARTIAL on live rows: a soft-deleted group frees its name and a removed
              membership can be added again. The specs are READ from the cube's declaration and
              the SQL is rendered from them, so this tool and the running cube cannot disagree.
  When you need it
              The KERNEL installs both indexes itself, as the table's owner, the first time it
              touches each table -- an ordinary install needs nothing here and a dry run will say
              "nothing to do". You need this tool when that installer could not finish or its
              result was undone, because it runs once per table per process and never retries:
                * live rows already duplicated the key, so CREATE UNIQUE INDEX failed. The cube
                  then serves reads and REFUSES writes, and nothing retries until a restart.
                  Reconcile the duplicates this reports, then --apply: the cube's gate re-reads
                  the catalog on every write, so the next request succeeds with no restart.
                * an index was dropped or replaced on a live system.
                * an interrupted CREATE INDEX CONCURRENTLY left an INVALID index behind. It
                  renders identically to the real one and enforces nothing; this reports it as
                  invalid and never touches it -- dropping it is the operator's deliberate act.
  Side effects  with --apply: CREATE UNIQUE INDEX, nothing else. No row is created, updated or
              deleted; no index is ever dropped or rebuilt. Each target is its own transaction,
              behind SHARE ROW EXCLUSIVE with the duplicates re-counted inside the lock; reads
              are never blocked.
  Guards      the cube's declaration is checked BEFORE anything is rendered: a normalization or a
              predicate this tool cannot render is refused with exit 2, never guessed (guessing
              would create an index the kernel's gate then refuses forever).
              Dry run by default. --apply is refused without --i-understand. Duplicate rows are
              reported and block their own target -- they are never repaired here. An index
              carrying the right name with the wrong definition, or the right definition while
              the catalog marks it invalid, is reported and never accepted.
  Order on a fresh install
              1. install the pack (settings:install-from) and restart the kernel
              2. ordinary use: the first request that touches a table creates it AND its index
              3. this tool, dry run, to VERIFY:  node tools/ensure-contact-group-indexes.mjs
                 (exit 0 and "nothing to do" is the healthy answer)
              4. only if step 3 reports work to do: reconcile what it names, then
                   node tools/ensure-contact-group-indexes.mjs --apply --i-understand
              Until both indexes are ready the cube REFUSES writes (loudly, 500) and serves
              reads, so the repair is always possible while the gate is shut.

  --apply            create the missing indexes (default: report only)
  --i-understand     required with --apply
  --limit=N          examine at most N duplicate sets per target (default ${DEFAULT_LIMIT})
  --csv              machine-readable rows on stdout instead of prose
  --help             this text

  Connection  QWBE_DATABASE_URL, or QWBE_PG_PASSWORD (plus optional QWBE_PG_HOST/PORT/USER),
              as the database owner -- creating an index needs it. No password default, nothing
              is guessed, and the connection string is never printed.

  Safe first step:
    QWBE_DATABASE_URL=... node tools/ensure-contact-group-indexes.mjs

  Exit codes  0 both indexes enforcing (created or already matching and valid)
              1 anything less: missing, blocked by duplicates, same name with a different
                definition, present but invalid, table not created yet, or an execution failure
                -- a dry run over a missing index exits 1 as well, so a preflight script cannot
                mistake "ran" for "installed"
              2 bad input: an unknown flag, a bad --limit, no connection in the environment, or a
                cube DECLARATION this tool cannot render (an unknown normalization, a predicate
                other than the active-rows one, an unsafe identifier). Nothing is inspected in
                that case -- teach the renderer the new shape first`

export const parseArgs = (argv) => {
  const opts = { help: false, apply: false, understood: false, csv: false, limit: DEFAULT_LIMIT }
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true
    else if (arg === "--apply") opts.apply = true
    else if (arg === "--i-understand") opts.understood = true
    else if (arg === "--csv") opts.csv = true
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length))
      if (!Number.isInteger(n) || n < 1) return { error: `--limit must be a positive integer, got "${arg}"` }
      opts.limit = n
    } else return { error: `unknown argument "${arg}" (try --help)` }
  }
  if (opts.apply && !opts.understood) return { error: "--apply also needs --i-understand; refusing to write" }
  return { opts }
}

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

export const planCsv = (targets) =>
  [
    "schema,table,index,tableExists,indexState,conflictSets,conflictRows",
    ...targets.map((t) =>
      [
        t.spec.schema,
        t.spec.table,
        t.spec.index,
        t.tableExists,
        t.indexState,
        t.conflicts.length,
        t.conflicts.reduce((n, c) => n + c.rows, 0),
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n")

const main = async () => {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error) {
    console.error(parsed.error)
    return 2
  }
  const { opts } = parsed
  if (opts.help) {
    console.log(HELP)
    return 0
  }
  // The DECLARATION is validated before anything is rendered or any connection is opened: a spec
  // this tool cannot render is bad input (exit 2), and inspecting a database with a renderer that
  // does not match the running kernel's would produce a confident, wrong report.
  const unrenderable = specGateError()
  if (unrenderable) {
    console.error(unrenderable)
    return 2
  }
  const url = dbUrl()
  if (!url) {
    console.error(
      "refusing to guess the database: set QWBE_DATABASE_URL, or QWBE_PG_PASSWORD (plus optional QWBE_PG_HOST/PORT/USER)",
    )
    return 2
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  const client = await pool.connect()
  try {
    const targets = await planOn(client, opts.limit)
    if (opts.csv) console.log(planCsv(targets))
    else {
      for (const t of targets) {
        const conflicts = t.conflicts.reduce((n, c) => n + c.rows, 0)
        console.log(
          `${t.spec.schema}.${t.spec.table}: table ${t.tableExists ? "present" : "ABSENT"}, ` +
            `index ${t.spec.index} ${t.indexState}` +
            (conflicts > 0 ? `, ${t.conflicts.length} duplicate set(s) covering ${conflicts} rows` : ""),
        )
        for (const c of t.conflicts) console.log(`    ${c.rows} rows: ${c.ids.join(" ")}`)
        if (!t.tableExists) {
          console.log(
            `    the kernel creates the table AND its index on first use: one authorized ` +
              `GET /contact-groups?limit=1 creates the groups table, then rerun (see --help)`,
          )
        }
      }
    }
    if (!opts.apply) {
      const todo = targets.filter((t) => t.indexState !== "ready")
      // A dry run that exits 0 while an index is missing reads as "healthy" to a scripted
      // preflight. The state, not the fact that the tool ran, decides the code.
      if (todo.length === 0) {
        console.log("nothing to do -- both indexes are ready")
        return 0
      }
      console.log("dry run -- rerun with --apply --i-understand")
      return 1
    }
    const { stats, details } = await applyOn(client, opts.limit)
    for (const d of details) if (d.detail) console.error(`${d.spec.schema}.${d.spec.table}: ${d.detail}`)
    console.log(
      `scanned ${stats.scanned} created ${stats.created} exists ${stats.exists} ` +
        `skipped ${stats.skipped} failed ${stats.failed}`,
    )
    // No fake guarantee: the run is a success only when EVERY target is enforcing. A skipped
    // target (table not created yet) is a legitimate, recoverable state and still exits 1,
    // naming what is not protected, because the cube's writes stay refused until it is.
    if (allReady(stats)) {
      console.log("both unique indexes are installed and match the cube's declaration")
      return 0
    }
    const unready = details.filter((d) => d.result !== "created" && d.result !== "exists")
    console.error(
      `NOT enforced: ${unready.map((d) => `${d.spec.schema}.${d.spec.index} (${d.result})`).join(", ")}. ` +
        `crm/contact-groups keeps refusing writes until this run reports created/exists for both.`,
    )
    return 1
  } finally {
    client.release()
    await pool.end()
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  process.exitCode = await main().catch((err) => {
    // The last line this tool can print, and the one that used to leak: anything thrown out of
    // `main` -- a connection failure, a cancelled statement, a 23505 from a build -- arrived here as
    // a driver message quoting whatever row it was about. Only the class and the SQLSTATE.
    console.error(`ensure-contact-group-indexes could not finish (${fault(err)})`)
    return 1
  })
}
