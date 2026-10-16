// The Organizations layout follows vtiger (spec §3.2, VTIGER_PLACEMENT): every
// mock field sits in its vtiger block, in vtiger's sequence, never in a
// leftover block; the meta fields are hidden.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata } from "./cube.ts"
import { CUSTOM_BLOCK_TITLE, fieldBlocksOf } from "./field-blocks.ts"
import { ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN } from "./organization-layout.ts"
import { testField as field } from "./test-fields.ts"
import { MOCK_FIELDS, VTIGER_PLACEMENT, withMockFields } from "../mock/organizations/index.ts"

// The fields the cube publishes today.
const PUBLISHED = [
  "id", "type", "createdAt", "deleted", "name", "externalId", "organizationNo", "phone", "email", "website",
  "organizationType", "industry", "rating", "ownership", "employees", "emailOptOut", "billingStreet",
  "billingCity", "billingCode", "billingCountry", "description",
]
const meta: CubeMetadata = {
  cube: "crm/organizations",
  entity: "Organization",
  version: null,
  schemaHash: "x",
  fields: PUBLISHED.map((name) => field({ name })),
}
const blocks = fieldBlocksOf(withMockFields(meta).fields, ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN)
const blockOf = (name: string) => blocks.find((b) => b.rows.some((row) => row.some((f) => f?.name === name)))?.title

describe("ORGANIZATION_BLOCKS", () => {
  it("are vtiger's three blocks, in order, with no leftover block", () => {
    assert.deepEqual(blocks.map((b) => b.title), ["Organization Information", "Address Information", "Description Information"])
  })

  it("put every shown mock field in the block VTIGER_PLACEMENT gives it", () => {
    for (const f of MOCK_FIELDS.filter((f) => !ORGANIZATION_HIDDEN.has(f.name))) {
      assert.equal(blockOf(f.name), VTIGER_PLACEMENT[f.name].block, f.name)
    }
  })

  it("read the mock fields in vtiger's sequence, left to right, top to bottom", () => {
    for (const spec of ORGANIZATION_BLOCKS) {
      const sequences = spec.rows.flat().flatMap((name) => (name && VTIGER_PLACEMENT[name] ? [VTIGER_PLACEMENT[name].sequence] : []))
      assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b), spec.title)
    }
  })

  it("hide Id, Type, Deleted, External Id and Last Modified By, and end block 1 as vtiger does", () => {
    for (const name of ["id", "type", "deleted", "externalId", "modifiedBy"]) assert.equal(blockOf(name), undefined, name)
    assert.deepEqual(blocks[0].rows.at(-1)?.map((f) => f?.name ?? null), ["industrySpec", "organizationNo"])
  })

  it("keep billing on the left and shipping on the right", () => {
    for (const [left, right] of blocks[1].rows) {
      assert.ok(left?.name.startsWith("billing") && right?.name.startsWith("shipping"), `${left?.name} ${right?.name}`)
    }
  })

  // Bogdan's split (backend.md §1): these become runtime custom fields. Once
  // the backend publishes them (custom: true, no mock), the layout still
  // names them, so they stay in their vtiger blocks, not in "Custom fields".
  it("keep the future runtime custom fields in their vtiger blocks once they are real", () => {
    const future = MOCK_FIELDS.filter((f) => f.custom).map((f) => f.name)
    assert.deepEqual([...future].sort(), [
      "billingPoBox", "notifyOwner", "otherFax", "otherIndustry", "otherIndustrySpec", "parentOrganizationId",
      "productCategory", "shippingPoBox", "tickerSymbol",
    ])
    const real = { ...meta, fields: [...meta.fields, ...future.map((name) => field({ name, custom: true }))] }
    const realBlocks = fieldBlocksOf(withMockFields(real).fields, ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN)
    assert.equal(realBlocks.some((b) => b.title === CUSTOM_BLOCK_TITLE), false)
    for (const name of future) {
      const block = realBlocks.find((b) => b.rows.some((row) => row.some((f) => f?.name === name)))
      assert.equal(block?.title, VTIGER_PLACEMENT[name].block, name)
      const placed = block?.rows.flat().find((f) => f?.name === name)
      assert.equal(placed?.mock, undefined, `${name} is the published field, not the mock`)
    }
  })
})
