// The contact-group index tool's PURE tests: everything it decides before it opens a connection.
//
// WHY THIS IS ITS OWN FILE. The sibling, ensure-contact-group-indexes.test.mjs, needs a real
// PostgreSQL server -- that is the whole point of it -- and it calls `requireDbUrl()` at TOP LEVEL
// to build the admin pool. A top-level throw is an IMPORT failure, so on a checkout with no
// database every test in that file is lost, including the ones that never wanted a database: the
// declaration gate, the renderer, the argument guards, and the two layout tests whose assertion is
// an exit CODE from a spawned node. Those four suites are the ones a developer runs most often and
// the ones CI can run without provisioning anything, so they live here, where nothing at module
// scope can refuse to load.
//
// What is proven here (the numbering follows the sibling's list):
//   11. a declaration this tool cannot render is refused -- exit 2, before anything is rendered and
//       before a connection is opened -- instead of being silently rendered as something else;
//   12. the tool runs in an INSTALLED layout, where `qwbe-core` sits in node_modules and node
//       refuses to strip its types, which is the layout of the incident the tool exists for;
//    9. the argument guards: --apply is refused without --i-understand;
//       and the rendering itself: TARGETS come from the cube's declaration, never from a list here;
//   13. what the tool is allowed to SAY about a server error -- its class and its SQLSTATE, never
//       the driver's message, which for these two indexes quotes the colliding group name.
//
// Needs no database and no environment. The two spawning tests deliberately replace the child's
// environment rather than inheriting it, so an ambient QWBE_DATABASE_URL cannot turn a test that
// should have refused into one that dials a real server.
//
// Run:  node --test tools/ensure-contact-group-indexes.spec.test.mjs

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
// The same leaf the TOOL reads, deliberately -- importing the cube's service module here would
// hide the one thing the installed-layout test below proves.
import { NAME_INDEX, PAIR_INDEX, SCHEMA, UNIQUE_INDEXES } from "../cubes/crm/contact-groups/invariant.ts"
import {
  DEFAULT_LIMIT,
  SPEC_PROBLEMS,
  TARGETS,
  fault,
  parseArgs,
  resolveSpec,
  specGateError,
  specProblem,
} from "./ensure-contact-group-indexes.mjs"

// --- where this checkout actually is, for the tests that rebuild a layout -------------------
//
// Derived from this file's own URL, never from `process.cwd()`: the node test runner may be
// started from anywhere, and a wrong root would silently build an EMPTY layout that "passes".
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const CUBE_DIR = join(ROOT, "cubes/crm/contact-groups")
const REPO_NODE_MODULES = join(ROOT, "node_modules")
/** The core checkout, through the dependency link this pack already has. */
const CORE = realpathSync(join(REPO_NODE_MODULES, "qwbe-core"))

/**
 * Run node inside a built layout and report it, never throwing on a non-zero exit -- the exit CODE
 * is the assertion in both tests below.
 *
 * The environment is replaced rather than inherited: an ambient QWBE_DATABASE_URL from the shell
 * running the suite would otherwise let a tool that should have refused go on to dial a real
 * database. `overrides` puts back exactly what a case wants, and `""` removes a variable.
 */
const runNode = (cwd, argv, overrides = {}) => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: "" }
  for (const [k, v] of Object.entries(overrides)) if (v !== "") env[k] = v
  const r = spawnSync(process.execPath, argv, { cwd, env, encoding: "utf8", timeout: 120_000 })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("ensure-contact-group-indexes, rendered from the cube's declaration", () => {
  it("targets exactly the declared indexes, in declaration order, and renders nothing by hand", () => {
    // The tool owns no list of its own: it resolves `manifest.uniqueIndexes`. A spec added to or
    // removed from the cube reaches the tool with no edit here, and the names, key order and
    // normalization can never drift from what the kernel enforces.
    assert.deepEqual(
      TARGETS.map((t) => t.index),
      [NAME_INDEX, PAIR_INDEX],
    )
    assert.deepEqual(TARGETS, UNIQUE_INDEXES.map(resolveSpec))
    for (const [i, target] of TARGETS.entries()) {
      assert.equal(target.schema, SCHEMA)
      assert.equal(target.table, UNIQUE_INDEXES[i].table)
      assert.deepEqual(target.keys, UNIQUE_INDEXES[i].keys)
      assert.equal(target.where, "deleted = false", "'rows: active' is the ONLY predicate declared")
    }
    // The two renderings the whole tool rests on, spelled out once: the expression the index is
    // built on, and the catalog form it is compared against.
    assert.equal(TARGETS[0].on, "(lower(btrim(body->>'name')))")
    assert.equal(TARGETS[0].def, `createuniqueindex${NAME_INDEX}on${SCHEMA}.contact_groupsusingbtree(lower(btrim((body->>'name'))))where(deleted=false)`)
    assert.equal(TARGETS[1].on, "((body->>'groupId'), (body->>'contactId'))")
    assert.equal(
      TARGETS[1].def,
      `createuniqueindex${PAIR_INDEX}on${SCHEMA}.contact_group_membersusingbtree(((body->>'groupId')),((body->>'contactId')))where(deleted=false)`,
    )
  })
})

describe("ensure-contact-group-indexes, the declaration it refuses to render", () => {
  // Item 11. The tool renders owner-level DDL from the cube's declaration with its OWN renderer,
  // a second implementation of the kernel's. The declaration is therefore INPUT, and a shape this
  // renderer does not know is bad input -- exit 2, before anything is rendered and before a
  // connection is opened. The failure this closes is silent and expensive: an unknown
  // `normalize` used to fall into the `plain` branch and an unknown `spec.rows` was never read at
  // all, so the tool would have built an index the kernel's gate then rejected forever, while
  // reporting `created` and exiting 0.

  it("accepts the declaration as it actually stands -- no problems, and TARGETS rendered", () => {
    assert.deepEqual(SPEC_PROBLEMS, [], "the shipped declaration must be renderable by this tool")
    assert.equal(specGateError(), null)
    assert.equal(TARGETS.length, UNIQUE_INDEXES.length)
  })

  it("names every part of a declaration it cannot render, instead of rendering something else", () => {
    const base = UNIQUE_INDEXES[0]
    // A predicate other than the active-rows one: silently ignored before, so the index was built
    // PARTIAL when the declaration asked for every row.
    assert.match(specProblem({ ...base, rows: "all" }), /rows "all"/)
    assert.match(specProblem({ ...base, rows: undefined }), /this tool renders only "active"/)
    // An unknown normalization: fell into the `plain` branch before, i.e. an index on the RAW
    // value while the kernel expected a normalized one -- same name, different definition.
    assert.match(
      specProblem({ ...base, keys: [{ body: "name", normalize: "upper" }] }),
      /normalize "upper".*cannot render/s,
    )
    // Identifiers and JSON keys are interpolated into DDL, so they are checked, not trusted.
    assert.match(specProblem({ ...base, index: 'contact_groups"; SELECT 1 --' }), /index name is not a safe identifier/)
    assert.match(specProblem({ ...base, table: "a-b" }), /table name is not a safe identifier/)
    assert.match(specProblem({ ...base, keys: [{ body: "na'me" }] }), /not a safe JSON key/)
    assert.match(specProblem({ ...base, keys: [] }), /between 1 and/)
    assert.match(specProblem(null), /not an object/)
    // `plain` and an absent `normalize` are the two this tool really does render.
    assert.equal(specProblem({ ...base, keys: [{ body: "name", normalize: "plain" }] }), null)
    assert.equal(specProblem({ ...base, keys: [{ body: "name" }] }), null)
  })

  it("refuses at the render boundary too, so a caller that skipped the gate cannot slip past it", () => {
    // `main` checks `specGateError` first, but `resolveSpec` is exported and a future caller could
    // reach it directly -- with an unchecked declaration interpolated into owner-level DDL.
    assert.throws(() => resolveSpec({ ...UNIQUE_INDEXES[0], rows: "all" }), /cannot render a unique index declaration/)
    assert.match(specGateError(["first problem", "second problem"]), /first problem; second problem/)
    assert.match(specGateError(["p"]), /nothing was inspected/)
  })

  it("exits 2 on an unrenderable declaration, without opening a connection", () => {
    // End to end, in a copy of the tool whose leaf declares a predicate it cannot render. The
    // database URL is deliberately unreachable: exit 2 with the declaration's sentence proves the
    // gate ran BEFORE any connection, since a connection attempt would have failed differently.
    const dir = mkdtempSync(join(tmpdir(), "cgidx-spec-"))
    try {
      mkdirSync(join(dir, "tools"), { recursive: true })
      mkdirSync(join(dir, "cubes/crm/contact-groups"), { recursive: true })
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", type: "module", private: true }))
      for (const f of ["ensure-contact-group-indexes.mjs", "db-url.mjs"]) {
        cpSync(join(HERE, f), join(dir, "tools", f))
      }
      // The same invariant, with the one thing this tool refuses to guess.
      writeFileSync(
        join(dir, "cubes/crm/contact-groups/invariant.ts"),
        `export const CUBE = "crm/contact-groups"\n` +
          `export const SCHEMA = CUBE.replace(/\\//g, "--")\n` +
          `export const UNIQUE_INDEXES = [{ table: "contact_groups", index: "${NAME_INDEX}", ` +
          `keys: [{ body: "name", normalize: "lower-btrim" }], rows: "all" }]\n`,
      )
      mkdirSync(join(dir, "node_modules"), { recursive: true })
      symlinkSync(join(REPO_NODE_MODULES, "pg"), join(dir, "node_modules/pg"))
      const run = runNode(dir, ["tools/ensure-contact-group-indexes.mjs"], {
        QWBE_DATABASE_URL: "postgres://nobody:nobody@127.0.0.1:1/nope",
      })
      assert.equal(run.status, 2, run.stderr + run.stdout)
      assert.match(run.stderr, /refusing to render the cube's declaration/)
      assert.match(run.stderr, /rows "all"/)
      assert.doesNotMatch(run.stderr, /ECONNREFUSED|nope/, "it must refuse before it dials the database")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("ensure-contact-group-indexes, in an INSTALLED layout", () => {
  // Item 12, and the reason invariant.ts exists at all. In a real install `qwbe-core` sits INSIDE
  // node_modules, and node's strip-only mode refuses to strip types from a `.ts` file there
  // (core/package.json `_exportsComment`). The tool used to import service.ts, which imports
  // `qwbe-core/errors` as a VALUE -- so the tool died on its own import line, in precisely the
  // incident it exists for. invariant.ts is a LEAF whose only `qwbe-core` import is `import type`,
  // erased outright, so nothing under node_modules is ever loaded.
  //
  // The layout is built with a COPY of qwbe-core/src, not a symlink: node resolves a symlinked
  // dependency to its real path, which is outside node_modules, and the restriction would not
  // apply -- the bug would not reproduce and the test would prove nothing.

  const build = () => {
    const dir = mkdtempSync(join(tmpdir(), "cgidx-installed-"))
    mkdirSync(join(dir, "tools"), { recursive: true })
    mkdirSync(join(dir, "cubes/crm/contact-groups"), { recursive: true })
    mkdirSync(join(dir, "node_modules/qwbe-core"), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", type: "module", private: true }))
    for (const f of ["ensure-contact-group-indexes.mjs", "db-url.mjs"]) cpSync(join(HERE, f), join(dir, "tools", f))
    cpSync(CUBE_DIR, join(dir, "cubes/crm/contact-groups"), { recursive: true, dereference: true })
    cpSync(join(CORE, "package.json"), join(dir, "node_modules/qwbe-core/package.json"))
    cpSync(join(CORE, "src"), join(dir, "node_modules/qwbe-core/src"), { recursive: true, dereference: true })
    symlinkSync(join(REPO_NODE_MODULES, "pg"), join(dir, "node_modules/pg"))
    symlinkSync(join(REPO_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
    return dir
  }

  it("runs with qwbe-core inside node_modules -- where importing the cube's service would die", function () {
    let dir
    try {
      dir = build()
    } catch (err) {
      // The core checkout is not where this test expects it (a packed install, a partial clone).
      // Skipping is honest; asserting on a layout that was never built is not.
      return this.skip(`could not build the installed layout: ${err.message}`)
    }
    try {
      // The counterfactual FIRST: this is the failure the leaf was introduced to remove, and
      // without it a passing tool proves nothing about the layout.
      writeFileSync(
        join(dir, "tools/probe-service.mjs"),
        `import { NAME_INDEX } from "../cubes/crm/contact-groups/service.ts"\nconsole.log(NAME_INDEX)\n`,
      )
      const viaService = runNode(dir, ["tools/probe-service.mjs"])
      assert.equal(viaService.status, 1, "importing service.ts under node_modules must still fail here")
      assert.match(viaService.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/)
      assert.match(viaService.stderr, /node_modules\/qwbe-core/)

      // The tool itself, reading the SAME invariant through the type-only leaf, loads and runs.
      const help = runNode(dir, ["tools/ensure-contact-group-indexes.mjs", "--help"])
      assert.equal(help.status, 0, help.stderr)
      assert.match(help.stdout, /ensure-contact-group-indexes/)

      // ...and it is the real tool, not a stub: the declaration gate runs and the missing URL is
      // reported as bad input, both of which happen after the import graph has fully loaded.
      const noUrl = runNode(dir, ["tools/ensure-contact-group-indexes.mjs"], { QWBE_DATABASE_URL: "" })
      assert.equal(noUrl.status, 2, noUrl.stderr)
      assert.match(noUrl.stderr, /refusing to guess the database/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("ensure-contact-group-indexes, argument guards", () => {
  it("is a dry run unless BOTH --apply and --i-understand are given", () => {
    assert.equal(parseArgs([]).opts.apply, false)
    assert.match(parseArgs(["--apply"]).error, /--i-understand/)
    assert.equal(parseArgs(["--apply", "--i-understand"]).opts.apply, true)
  })

  it("refuses an unusable limit and an unknown flag instead of guessing", () => {
    assert.match(parseArgs(["--limit=0"]).error, /positive integer/)
    assert.match(parseArgs(["--limit=x"]).error, /positive integer/)
    assert.match(parseArgs(["--force"]).error, /unknown argument/)
    assert.equal(parseArgs(["--limit=3"]).opts.limit, 3)
    assert.equal(parseArgs([]).opts.limit, DEFAULT_LIMIT)
  })
})

describe("ensure-contact-group-indexes, what it is allowed to say about a server error", () => {
  // The header promises "no row values are printed". A driver message breaks that promise in the
  // one place it matters most: PostgreSQL quotes the colliding key in a 23505, so for THESE indexes
  // the message IS a group name -- business data, in an operator log or a CI transcript. Every path
  // that used to print `e.message` prints `fault(e)` instead.

  /** A 23505 exactly as `pg` hands it over from a failed unique build, key and all. */
  const driverDuplicate = () =>
    Object.assign(new Error(`could not create unique index "contact_groups_name_key"`), {
      code: "23505",
      detail: `Key (lower(btrim((body->>'name'::text))))=(acme holdings) is duplicated.`,
      table: "contact_groups",
      severity: "ERROR",
    })

  it("reduces a server error to its class and SQLSTATE, and quotes nothing of it", () => {
    const line = fault(driverDuplicate())
    assert.match(line, /^Error, SQLSTATE 23505$/)
    for (const leak of ["acme", "holdings", "duplicated", "lower(", "body->>", "could not create"]) {
      assert.ok(!line.toLowerCase().includes(leak.toLowerCase()), `fault() leaked ${leak}: ${line}`)
    }
  })

  it("never interpolates a code it has not shape-checked", () => {
    // The shape test is what makes the interpolation safe, not the driver's good behaviour: the
    // SQLSTATE is interpolated into an operator line, so anything that is not five characters of its
    // own alphabet becomes `unknown` rather than being passed through.
    assert.match(fault({ code: "42501" }), /SQLSTATE 42501$/)
    assert.match(fault({ code: "23505'; -- Acme" }), /SQLSTATE unknown$/)
    assert.ok(!fault({ code: "23505'; -- Acme" }).includes("Acme"))
    assert.match(fault({ code: 23505 }), /SQLSTATE unknown$/)
    assert.match(fault({}), /SQLSTATE unknown$/)
    assert.match(fault(null), /SQLSTATE unknown$/)
    assert.match(fault(undefined), /SQLSTATE unknown$/)
    assert.match(fault("a bare string with a name in it: Acme"), /SQLSTATE unknown$/)
    assert.ok(!fault("a bare string with a name in it: Acme").includes("Acme"))
  })

  it("distinguishes a server refusal from a thrown-here failure without quoting either", () => {
    assert.match(fault(driverDuplicate()), /^Error, /)
    assert.match(fault(new TypeError("cannot read properties of undefined (reading 'Acme')")), /^TypeError, /)
    assert.ok(!fault(new TypeError("...Acme...")).includes("Acme"))
  })
})
