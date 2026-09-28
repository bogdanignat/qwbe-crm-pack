// The contact-group index tool, everything it decides before it opens a connection: the targets are
// rendered from the cube's declaration, a declaration it cannot render is refused, the argument guards,
// and what it may say about a server error (its class and SQLSTATE, never the driver's message, which
// for these two indexes quotes the colliding group name). No database, no environment.
import { describe, expect, it } from "@effect/vitest"
import * as Either from "effect/Either"
// The same leaf the TOOL reads, deliberately.
import { NAME_INDEX, PAIR_INDEX, SCHEMA, UNIQUE_INDEXES } from "../../cubes/crm/contact-groups/invariant.ts"
import { DEFAULT_LIMIT } from "./contact-group-indexes-help.ts"
import { fault, parseArgs } from "./contact-group-indexes-report.ts"
import { resolveSpec, SPEC_PROBLEMS, specGateError, specProblem, TARGETS } from "./contact-group-indexes-spec.ts"

const refusal = (argv: ReadonlyArray<string>) => Either.match(parseArgs(argv), { onLeft: (e) => e.message, onRight: () => "" })
const options = (argv: ReadonlyArray<string>) => Either.getOrThrow(parseArgs(argv))

describe("ensure-contact-group-indexes, rendered from the cube's declaration", () => {
  it("targets exactly the declared indexes, in declaration order, and renders nothing by hand", () => {
    expect(TARGETS.map((t) => t.index)).toEqual([NAME_INDEX, PAIR_INDEX])
    expect(TARGETS).toEqual(UNIQUE_INDEXES.map((spec) => Either.getOrThrow(resolveSpec(spec))))
    for (const [i, target] of TARGETS.entries()) {
      expect(target.schema).toBe(SCHEMA)
      expect(target.table).toBe(UNIQUE_INDEXES[i]!.table)
      expect(target.keys).toEqual(UNIQUE_INDEXES[i]!.keys)
      expect(target.where, "'rows: active' is the ONLY predicate declared").toBe("deleted = false")
    }
    // The two renderings the whole tool rests on: the expression the index is built on, and the
    // catalog form it is compared against.
    expect(TARGETS[0]!.on).toBe("(lower(btrim(body->>'name')))")
    expect(TARGETS[0]!.def).toBe(
      `createuniqueindex${NAME_INDEX}on${SCHEMA}.contact_groupsusingbtree(lower(btrim((body->>'name'))))where(deleted=false)`,
    )
    expect(TARGETS[1]!.on).toBe("((body->>'groupId'), (body->>'contactId'))")
    expect(TARGETS[1]!.def).toBe(
      `createuniqueindex${PAIR_INDEX}on${SCHEMA}.contact_group_membersusingbtree(((body->>'groupId')),((body->>'contactId')))where(deleted=false)`,
    )
  })
})

describe("ensure-contact-group-indexes, the declaration it refuses to render", () => {
  it("accepts the declaration as it actually stands -- no problems, and TARGETS rendered", () => {
    expect(SPEC_PROBLEMS, "the shipped declaration must be renderable by this tool").toEqual([])
    expect(specGateError()).toBeNull()
    expect(TARGETS.length).toBe(UNIQUE_INDEXES.length)
  })

  it("names every part of a declaration it cannot render, instead of rendering something else", () => {
    const base = UNIQUE_INDEXES[0]
    // A predicate other than the active-rows one: once silently built PARTIAL.
    expect(specProblem({ ...base, rows: "all" })).toMatch(/rows "all"/)
    expect(specProblem({ ...base, rows: undefined })).toMatch(/this tool renders only "active"/)
    // An unknown normalization: once fell into `plain`, an index on the RAW value.
    expect(specProblem({ ...base, keys: [{ body: "name", normalize: "upper" }] })).toMatch(/normalize "upper".*cannot render/s)
    // Identifiers and JSON keys are interpolated into DDL, so they are checked, not trusted.
    expect(specProblem({ ...base, index: 'contact_groups"; SELECT 1 --' })).toMatch(/index name is not a safe identifier/)
    expect(specProblem({ ...base, table: "a-b" })).toMatch(/table name is not a safe identifier/)
    expect(specProblem({ ...base, keys: [{ body: "na'me" }] })).toMatch(/not a safe JSON key/)
    expect(specProblem({ ...base, keys: [] })).toMatch(/between 1 and/)
    expect(specProblem(null)).toMatch(/not an object/)
    // `plain` and an absent `normalize` are the two this tool really does render.
    expect(specProblem({ ...base, keys: [{ body: "name", normalize: "plain" }] })).toBeNull()
    expect(specProblem({ ...base, keys: [{ body: "name" }] })).toBeNull()
  })

  it("refuses at the render boundary too, so a caller that skipped the gate cannot slip past it", () => {
    const refused = resolveSpec({ ...UNIQUE_INDEXES[0], rows: "all" })
    expect(Either.isLeft(refused)).toBe(true)
    expect(Either.match(refused, { onLeft: (e) => e.message, onRight: () => "" })).toMatch(/cannot render a unique index declaration/)
    expect(specGateError(["first problem", "second problem"])).toMatch(/first problem; second problem/)
    expect(specGateError(["p"])).toMatch(/nothing was inspected/)
  })
})

describe("ensure-contact-group-indexes, argument guards", () => {
  it("is a dry run unless BOTH --apply and --i-understand are given", () => {
    expect(options([]).apply).toBe(false)
    expect(refusal(["--apply"])).toMatch(/--i-understand/)
    expect(options(["--apply", "--i-understand"]).apply).toBe(true)
    expect(Either.match(parseArgs(["--apply"]), { onLeft: (e) => e.code, onRight: () => 0 })).toBe(2)
  })

  it("refuses an unusable limit and an unknown flag instead of guessing", () => {
    expect(refusal(["--limit=0"])).toMatch(/positive integer/)
    expect(refusal(["--limit=x"])).toMatch(/positive integer/)
    expect(refusal(["--force"])).toMatch(/unknown argument/)
    expect(options(["--limit=3"]).limit).toBe(3)
    expect(options([]).limit).toBe(DEFAULT_LIMIT)
    expect(options(["-h"]).help).toBe(true)
  })
})

describe("ensure-contact-group-indexes, what it is allowed to say about a server error", () => {
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
    expect(line).toMatch(/^Error, SQLSTATE 23505$/)
    for (const leak of ["acme", "holdings", "duplicated", "lower(", "body->>", "could not create"]) {
      expect(line.toLowerCase(), `fault() leaked ${leak}: ${line}`).not.toContain(leak.toLowerCase())
    }
  })

  it("never interpolates a code it has not shape-checked", () => {
    expect(fault({ code: "42501" })).toMatch(/SQLSTATE 42501$/)
    expect(fault({ code: "23505'; -- Acme" })).toMatch(/SQLSTATE unknown$/)
    expect(fault({ code: "23505'; -- Acme" })).not.toContain("Acme")
    expect(fault({ code: 23505 })).toMatch(/SQLSTATE unknown$/)
    expect(fault({})).toMatch(/SQLSTATE unknown$/)
    expect(fault(null)).toMatch(/SQLSTATE unknown$/)
    expect(fault(undefined)).toMatch(/SQLSTATE unknown$/)
    expect(fault("a bare string with a name in it: Acme")).toMatch(/SQLSTATE unknown$/)
    expect(fault("a bare string with a name in it: Acme")).not.toContain("Acme")
  })

  it("distinguishes a server refusal from a thrown-here failure without quoting either", () => {
    expect(fault(driverDuplicate())).toMatch(/^Error, /)
    expect(fault(new TypeError("cannot read properties of undefined (reading 'Acme')"))).toMatch(/^TypeError, /)
    expect(fault(new TypeError("...Acme..."))).not.toContain("Acme")
  })
})
