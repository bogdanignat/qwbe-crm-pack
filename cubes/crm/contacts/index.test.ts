// Compile-time contract tests for the contacts cube (QWB-30, criterion 12).
//
// What is proven here, without a server: the cube is a valid `defineCube` product (manifest
// sane, handlers exactly matching endpoints — checked by the kernel's own validators), the
// domain decisions are visible in the manifest and schemas, and handlers enforce permissions
// and 404 on the typed seam. Runtime HTTP proof lives in probes/crm.mjs.
//
// Run from the Qwbe layout (plugin installed at core/plugins/crm-pack/cubes/crm):
//   cd <qwbe>/core && node --test plugins/crm-pack/cubes/crm/contacts/index.test.ts

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Cause, Effect, Exit } from "effect"
import { type CubeTools, validateCubeParts } from "qwbe-core/cube"
import { CurrentUser, requirePermission } from "qwbe-core/auth"
import type { Forbidden, NotFound } from "qwbe-core/errors"
import { cube } from "./index.ts"

const parts = cube.create({} as CubeTools)

const admin = {
  id: "u1",
  username: "admin",
  roles: ["admin"],
  permissions: ["crm/contacts:read", "crm/contacts:write"],
  sessionId: "s1",
}
const reader = {
  id: "u2",
  username: "reader",
  roles: ["reader"],
  permissions: ["crm/contacts:read"],
  sessionId: "s2",
}

describe("contacts cube contract", () => {
  it("manifest declares exactly its own identity", () => {
    assert.equal(cube.manifest.name, "contacts")
    assert.equal(cube.manifest.parent, "crm")
    assert.deepEqual(cube.manifest.tables, ["contacts"])
    assert.equal(cube.manifest.entity, "Contact")
    assert.equal(cube.manifest.requiresAuth, true)
  })

  it("handlers match endpoints one-to-one (kernel validator)", () => {
    assert.doesNotThrow(() => validateCubeParts("contacts", parts))
  })

  it("permissions are namespaced to this cube", () => {
    for (const p of cube.manifest.permissions ?? []) {
      assert.ok(p.name.startsWith("crm/contacts:"), p.name)
    }
    assert.deepEqual(
      (cube.manifest.permissions ?? []).map((p) => p.name),
      ["crm/contacts:read", "crm/contacts:write"],
    )
  })

  it("publishes only its own event", () => {
    assert.deepEqual(cube.manifest.publishes, ["crm/contacts.created"])
  })

  it("declares the organizationId relation and the externalId filter (QWB-47, tickets 12, 13)", () => {
    // The one truth of the contact-to-organization relation is organizationId; the manifest
    // DECLARES its target so the metadata endpoint can resolve ids to names. A declared
    // target is metadata, not an import: no code couples the cubes, there is still no
    // related-list endpoint, no copied field. The filter on the list is the derived contact
    // list of an organization. The target's cube name IS the declared relation target, so
    // the word "organizations" appears here by declaration only.
    // Ticket 13 adds exactly one more list declaration: externalId, the identity the import
    // looks a contact up by before it creates one (uniqueness lives in the DATABASE --
    // tools/db/ensure-external-id-index.ts; the cube's role cannot create indexes). Ticket 14
    // widens the list with name and email: the same declaration drives `?q=` and the UI's
    // filter controls, and searching a person by their name is the everyday case.
    assert.deepEqual(cube.manifest.relations, { organizationId: { target: "crm/organizations" } })
    assert.deepEqual(cube.manifest.searchable, ["name", "email", "externalId"])
    assert.equal(cube.manifest.version, "1.3.0")
    const source = JSON.stringify(cube.manifest)
    for (const word of ["companyId", "erp", "contactIds"]) {
      assert.ok(!source.includes(word), word)
    }
  })

  it("the patch lets a contact move or unlink, and fails NotFound for a missing id", async () => {
    // organizationId is write-once nowhere: PATCH /contacts/:id moves a contact to another
    // organization or unlinks it (organizationId null) — the foreign key is the truth, so it
    // must be correctable.
    const rows: Record<string, unknown> = {
      cont_1: { id: "cont_1", type: "Contact", name: "Ada", email: "a@e.com", phone: null, company: null, organizationId: "org_1" },
    }
    const tools = {
      store: {
        byId: (_t: string, id: string) => Effect.succeed(rows[id]),
        update: (_t: string, id: string, patch: Record<string, unknown>) =>
          Effect.succeed({ ...(rows[id] as object), ...patch }),
      },
      bus: { publish: () => Effect.void },
    } as unknown as CubeTools
    const update = cube.create(tools).handlers.update
    const run = (payload: Record<string, unknown>) =>
      Effect.runPromiseExit(
        update({ path: { id: "cont_1" }, payload } as Parameters<typeof update>[0]).pipe(
          Effect.provideService(CurrentUser, admin),
        ) as Effect.Effect<unknown, Forbidden | NotFound>,
      )
    const moved = (await run({ organizationId: "org_2" })) as { _tag: string; value?: unknown }
    assert.equal(moved._tag, "Success")
    assert.equal((moved.value as { organizationId: string }).organizationId, "org_2")
    const unlinked = (await run({ organizationId: null })) as { _tag: string; value?: unknown }
    assert.equal((unlinked.value as { organizationId: string | null }).organizationId, null)
    const missing = await Effect.runPromiseExit(
      update({ path: { id: "cont_none" }, payload: { name: "x" } } as Parameters<typeof update>[0]).pipe(
        Effect.provideService(CurrentUser, admin),
      ) as Effect.Effect<unknown, Forbidden | NotFound>,
    )
    const failure = Cause.failureOption((missing as Exclude<typeof missing, { _tag: "Success" }>).cause)
    assert.ok(failure._tag === "Some" && failure.value._tag === "NotFound")
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
      get({ path: { id: "cont_none" } } as Parameters<typeof get>[0]).pipe(
        Effect.provideService(CurrentUser, admin),
      ) as Effect.Effect<unknown, Forbidden | NotFound>,
    )
    assert.ok(Exit.isFailure(result))
    const failure = Cause.failureOption(result.cause)
    assert.ok(failure._tag === "Some" && failure.value._tag === "NotFound")
  })

  it("requirePermission refuses a caller without contacts:write", async () => {
    // The kernel seam every write handler passes through — checked directly, with the same
    // context the auth cube provides in production.
    const exit = await Effect.runPromiseExit(
      requirePermission("crm/contacts:write").pipe(Effect.provideService(CurrentUser, reader)),
    )
    assert.ok(Exit.isFailure(exit))
    const failure = Cause.failureOption(exit.cause)
    assert.ok(failure._tag === "Some" && failure.value._tag === "Forbidden")
  })
})
