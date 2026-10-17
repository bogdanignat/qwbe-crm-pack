// The source boundary of this pack, judged by the shared checker exported by qwbe
// (`qwbe-core/package`). The rules live in the kernel repo; this file only runs
// them here and keeps the pack-specific assertions the checker cannot know.
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { fileURLToPath } from "node:url"
import { checkPackageSource } from "qwbe-core/package"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))

it.effect("keeps the shared package contract", () =>
  Effect.gen(function* () {
    const findings = yield* Effect.promise(() => checkPackageSource(repoRoot, { hierarchy: true }))
    expect(findings).toEqual([])
  }),
)

it.effect("declares one CRM parent with contacts and contracts as children", () =>
  Effect.gen(function* () {
    const [crm, contacts, contracts, organizations] = yield* Effect.all([
      Effect.promise(() => import("../../cubes/crm/index.ts")),
      Effect.promise(() => import("../../cubes/crm/contacts/index.ts")),
      Effect.promise(() => import("../../cubes/crm/contracts/index.ts")),
      Effect.promise(() => import("../../cubes/crm/organizations/index.ts")),
    ])
    expect(crm.cube.manifest.name).toBe("crm")
    expect(crm.cube.manifest.screen).toBe(true)
    expect(organizations.cube.manifest.parent).toBe("crm")
    expect(organizations.cube.manifest.name).toBe("organizations")
    expect(organizations.cube.manifest.entity).toBe("Organization")
    expect(contacts.cube.manifest.dataMigration).toEqual([
      { fromCube: "contacts", toCube: "crm/contacts", fromPlugin: "crm-pack" },
    ])
    expect(contracts.cube.manifest.dataMigration).toEqual([
      { fromCube: "contracts", toCube: "crm/contracts", fromPlugin: "crm-pack" },
    ])
    // One name everywhere (QWB-54, ticket 12): the cube is crm/organizations and its
    // predecessor is declared, not invented (QWB-54, ticket 14) — it IS the old crm/accounts.
    expect(organizations.cube.manifest.dataMigration).toEqual([
      { fromCube: "crm/accounts", toCube: "crm/organizations", fromPlugin: "crm-pack" },
    ])
    expect(organizations.cube.manifest.tables).toEqual(["organizations"])
    // QWB-54, ticket 13: the importable cubes carry externalId, published as a list filter
    // (that filter IS the import's lookup); uniqueness lives in the DATABASE, guarded by the
    // partial unique index tools/db/ensure-external-id-index.ts ensures. contracts is not
    // importable (no mapping, no import writes it), so it declares no external identity.
    expect(organizations.cube.manifest.version).toBe("1.1.0")
    expect(organizations.cube.manifest.searchable).toEqual(["name", "industry", "externalId"])
    expect(contacts.cube.manifest.version).toBe("1.3.0")
    expect(contacts.cube.manifest.searchable).toEqual(["name", "email", "externalId"])
    expect(contracts.cube.manifest.searchable).toBeUndefined()
  }),
)