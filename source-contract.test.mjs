// The source boundary of this pack, judged by the shared checker exported by qwbe
// (`qwbe-core/package`). The rules live in the kernel repo; this file only runs
// them here and keeps the pack-specific assertions the checker cannot know.
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { checkPackageSource } from "qwbe-core/package"

describe("CRM source package boundary", () => {
  it("keeps the shared package contract", async () => {
    const findings = await checkPackageSource(import.meta.dirname, { hierarchy: true })
    assert.deepEqual(findings, [])
  })

  it("declares one CRM parent with contacts and contracts as children", async () => {
    const [{ cube: crm }, { cube: contacts }, { cube: contracts }, { cube: organizations }, { cube: contactGroups }] =
      await Promise.all([
        import("./cubes/crm/index.ts"),
        import("./cubes/crm/contacts/index.ts"),
        import("./cubes/crm/contracts/index.ts"),
        import("./cubes/crm/organizations/index.ts"),
        import("./cubes/crm/contact-groups/index.ts"),
      ])
    assert.equal(crm.manifest.name, "crm")
    assert.equal(crm.manifest.screen, true)
    assert.equal(organizations.manifest.parent, "crm")
    assert.equal(organizations.manifest.name, "organizations")
    assert.equal(organizations.manifest.entity, "Organization")
    assert.deepEqual(contacts.manifest.dataMigration, [
      { fromCube: "contacts", toCube: "crm/contacts", fromPlugin: "crm-pack" },
    ])
    assert.deepEqual(contracts.manifest.dataMigration, [
      { fromCube: "contracts", toCube: "crm/contracts", fromPlugin: "crm-pack" },
    ])
    // One name everywhere (QWB-54, ticket 12): the cube is crm/organizations and its
    // predecessor is declared, not invented (QWB-54, ticket 14) — it IS the old crm/accounts.
    assert.deepEqual(organizations.manifest.dataMigration, [
      { fromCube: "crm/accounts", toCube: "crm/organizations", fromPlugin: "crm-pack" },
    ])
    assert.deepEqual(organizations.manifest.tables, ["organizations"])
    // QWB-54, ticket 13: the importable cubes carry externalId, published as a list filter
    // (that filter IS the import's lookup); uniqueness lives in the DATABASE, guarded by the
    // partial unique index tools/ensure-external-id-index.mjs ensures. contracts is not
    // importable (no mapping, no import writes it), so it declares no external identity.
    assert.equal(organizations.manifest.version, "1.1.0")
    assert.deepEqual(organizations.manifest.searchable, ["name", "industry", "externalId"])
    assert.equal(contacts.manifest.version, "1.3.0")
    assert.deepEqual(contacts.manifest.searchable, ["name", "email", "externalId"])
    assert.equal(contracts.manifest.searchable, undefined)
    // The contact groups are BUSINESS groupings of contacts, not the kernel's access groups:
    // their own cube, their own two tables, their own permission namespace. `dataMigration` is
    // absent because there is no predecessor, which is the honest declaration for a new cube.
    assert.equal(contactGroups.manifest.name, "contact-groups")
    assert.equal(contactGroups.manifest.parent, "crm")
    assert.equal(contactGroups.manifest.version, "1.0.0")
    assert.equal(contactGroups.manifest.entity, "ContactGroup")
    assert.deepEqual(contactGroups.manifest.tables, ["contact_groups", "contact_group_members"])
    assert.deepEqual(contactGroups.manifest.searchable, ["name"])
    assert.equal(contactGroups.manifest.dataMigration, undefined)
    // No relation is declared on purpose: a declared relation becomes a `<field>=` filter on
    // this cube's own list, and `contact_groups` has no contactId column (see index.ts).
    assert.equal(contactGroups.manifest.relations, undefined)
    // The invariant is DECLARED, so the kernel installs and enforces it: exact names (they are the
    // matcher keys a 23505 reports), exact key order, exact normalization, the one predicate.
    assert.deepEqual(contactGroups.manifest.uniqueIndexes, [
      {
        table: "contact_groups",
        index: "contact_groups_name_key",
        keys: [{ body: "name", normalize: "lower-btrim" }],
        rows: "active",
      },
      {
        table: "contact_group_members",
        index: "contact_group_members_pair_key",
        keys: [{ body: "groupId" }, { body: "contactId" }],
        rows: "active",
      },
    ])
    // And `usesBatch` is ABSENT, which is not a detail: the raw batch path calls neither
    // ensureTable nor the write gate, so it would write around the indexes above. The kernel
    // refuses a manifest holding both -- this pins the pack's side of that contract.
    assert.equal(contactGroups.manifest.usesBatch, undefined)
    assert.ok(!JSON.stringify(contactGroups.manifest).includes("usesBatch"))
    assert.deepEqual(
      contactGroups.manifest.permissions.map((p) => p.name),
      ["crm/contact-groups:read", "crm/contact-groups:write"],
    )
  })
})
