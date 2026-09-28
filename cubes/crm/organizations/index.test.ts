// Compile-time contract tests for the organizations cube (QWB-47, renamed QWB-54 ticket 12).
//
// What is proven here, without a server: the cube is a valid `defineCube` product (manifest
// sane, handlers exactly matching endpoints — checked by the kernel's own validators), the
// domain decisions are visible in the manifest and schemas, and handlers enforce permissions
// and 404 on the typed seam. Runtime HTTP proof lives in probes/crm.mjs.
//
// Run from the Qwbe layout (plugin installed at core/plugins/crm-pack/cubes/crm):
//   cd <qwbe>/core && node --test plugins/crm-pack/cubes/crm/organizations/index.test.ts

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { type CubeTools, validateCubeParts } from "qwbe-core/cube"
import { CurrentUser, requirePermission } from "qwbe-core/auth"
import { OrganizationCreate, OrganizationPatch } from "./schema.ts"
import type { Forbidden, NotFound } from "qwbe-core/errors"
import { cube } from "./index.ts"

const parts = cube.create({} as CubeTools)

const admin = {
  id: "u1",
  username: "admin",
  roles: ["admin"],
  permissions: ["crm/organizations:read", "crm/organizations:write"],
  sessionId: "s1",
}
const reader = {
  id: "u2",
  username: "reader",
  roles: ["reader"],
  permissions: ["crm/organizations:read"],
  sessionId: "s2",
}

describe("organizations cube contract", () => {
  it("manifest declares exactly its own identity", () => {
    assert.equal(cube.manifest.name, "organizations")
    assert.equal(cube.manifest.parent, "crm")
    assert.deepEqual(cube.manifest.tables, ["organizations"])
    assert.equal(cube.manifest.entity, "Organization")
    assert.equal(cube.manifest.requiresAuth, true)
  })

  it("handlers match endpoints one-to-one (kernel validator)", () => {
    assert.doesNotThrow(() => validateCubeParts("organizations", parts))
  })

  it("permissions are namespaced to this cube", () => {
    for (const p of cube.manifest.permissions ?? []) {
      assert.ok(p.name.startsWith("crm/organizations:"), p.name)
    }
    assert.deepEqual(
      (cube.manifest.permissions ?? []).map((p) => p.name),
      ["crm/organizations:read", "crm/organizations:write"],
    )
  })

  it("publishes only its own event", () => {
    assert.deepEqual(cube.manifest.publishes, ["crm/organizations.created"])
  })

  it("declares its predecessor honestly (QWB-54, tickets 12 and 14)", () => {
    // The manifest once claimed a migration from a cube that never existed, invented to pass
    // a hierarchy gate; ticket 12 then removed it together with the lie "no predecessor".
    // Both were wrong: this cube IS the old crm/accounts, renamed. The declaration names it,
    // and the kernel's ledger -- not the claim -- decides whether crm/accounts really belonged
    // to crm-pack (checked at boot; the schema is renamed, never copied).
    assert.deepEqual(cube.manifest.dataMigration, [
      { fromCube: "crm/accounts", toCube: "crm/organizations", fromPlugin: "crm-pack" },
    ])
  })

  it("owns exactly its own table", () => {
    // One table, one owner: the table is the cube's own name, so it can never collide with
    // the table the platform's builtin credential cube owns (DuplicateTableError at boot
    // otherwise).
    assert.deepEqual(cube.manifest.tables, ["organizations"])
  })

  it("does not import the contacts cube or hold the relation on this side", () => {
    // The relation's truth is Contact.organizationId. This cube holds no contact list and
    // names no sibling: no related-list endpoint, no copied field, no cross-cube anything.
    const source = JSON.stringify(cube.manifest)
    for (const word of ["crm/contacts", "contactIds", "contactId"]) assert.ok(!source.includes(word), word)
  })

  it("get fails NotFound for a missing id, with a store that has nothing", async () => {
    const tools = {
      store: {
        byId: () => Effect.succeed(undefined),
      },
      bus: { publish: () => Effect.void },
    } as unknown as CubeTools
    const get = cube.create(tools).handlers.get
    const result = await Effect.runPromiseExit(
      get({ path: { id: "org_none" } } as Parameters<typeof get>[0]).pipe(
        Effect.provideService(CurrentUser, admin),
      ) as Effect.Effect<unknown, Forbidden | NotFound>,
    )
    assert.ok(Exit.isFailure(result))
    const failure = Cause.failureOption(result.cause)
    assert.ok(failure._tag === "Some" && failure.value._tag === "NotFound")
  })

  it("update fails NotFound for a missing id", async () => {
    const tools = {
      store: {
        byId: () => Effect.succeed(undefined),
        update: () => Effect.succeed(undefined),
      },
      bus: { publish: () => Effect.void },
    } as unknown as CubeTools
    const update = cube.create(tools).handlers.update
    const result = await Effect.runPromiseExit(
      update({ path: { id: "org_none" }, payload: { name: "x" } } as Parameters<typeof update>[0]).pipe(
        Effect.provideService(CurrentUser, admin),
      ) as Effect.Effect<unknown, Forbidden | NotFound>,
    )
    assert.ok(Exit.isFailure(result))
    const failure = Cause.failureOption(result.cause)
    assert.ok(failure._tag === "Some" && failure.value._tag === "NotFound")
  })

  it("summaryById returns title and the two detail keys (links route)", async () => {
    // The acceptance point behind /links/{entity}/{id}: the organization summary carries one
    // human title and the two detail lines, or nothing for a missing id.
    const row = {
      id: "org_1",
      type: "Organization",
      name: "Ada Industries SRL",
      industry: "manufacturing",
      billingCity: "Iasi",
    }
    const tools = {
      store: {
        byId: (_t: string, id: string) => Effect.succeed(id === "org_1" ? row : undefined),
      },
      bus: { publish: () => Effect.void },
    } as unknown as CubeTools
    const parts = cube.create(tools)
    const summaryById = parts.relational!.summaryById!
    const hit = await Effect.runPromise(summaryById("org_1"))
    assert.equal(hit?.title, "Ada Industries SRL")
    assert.deepEqual(
      hit?.details.map((d) => d.key),
      ["industry", "city"],
    )
    const miss = await Effect.runPromise(summaryById("org_none"))
    assert.equal(miss, undefined)
  })

  it("carries the external identity the import deduplicates on (QWB-54, ticket 13)", () => {
    // externalId ("vtiger:<crmid>") is on the row schema (nullable: rows created by hand
    // have no source system), defaulted on create, and published as a list filter -- that
    // filter IS the import's lookup before create. Uniqueness lives in the DATABASE: the
    // partial unique index is ensured by tools/db/ensure-external-id-index.ts, because a
    // plugin cube's role holds DML only and cannot create indexes.
    assert.equal(cube.manifest.version, "1.1.0")
    assert.ok(cube.manifest.searchable?.includes("externalId"))
    const decode = Schema.decodeUnknownEither(OrganizationCreate)
    const created = decode({ name: "Ada Industries SRL" })
    assert.ok(created._tag === "Right")
    if (created._tag === "Right") assert.equal(created.right.externalId, null)
  })

  it("the patch schema refuses the meta fields and bad values", () => {
    // `deleted` is refused: there is no delete endpoint in this ticket, and a patched-away
    // organization would orphan its contacts (the rule for deletion lives in README.md).
    // `name` is the required title, so blank is refused; a negative headcount is refused.
    const decode = Schema.decodeUnknownEither(OrganizationPatch)
    assert.ok(decode({ deleted: true })._tag === "Left")
    assert.ok(decode({ name: "   " })._tag === "Left")
    assert.ok(decode({ employees: -3 })._tag === "Left")
    assert.ok(decode({ employees: 3 })._tag === "Right")
    assert.ok(decode({})._tag === "Right")
  })

  it("requirePermission refuses a caller without organizations:write", async () => {
    // The kernel seam every write handler passes through — checked directly, with the same
    // context the auth cube provides in production.
    const exit = await Effect.runPromiseExit(
      requirePermission("crm/organizations:write").pipe(Effect.provideService(CurrentUser, reader)),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = Cause.failureOption(exit.cause)
    assert.ok(failure._tag === "Some" && failure.value._tag === "Forbidden")
  })
})
