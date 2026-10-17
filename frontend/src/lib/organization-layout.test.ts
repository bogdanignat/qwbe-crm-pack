// The Organizations layout follows vtiger (spec §3.2, VTIGER_PLACEMENT): every
// mock field sits in its vtiger block, in vtiger's sequence, never in a
// leftover block; the meta fields are hidden.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata } from "./cube.ts"
import { fieldBlocksOf } from "./field-blocks.ts"
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
// Block 1's fields in vtiger's sequence (spec §3.2), the dropped ones left out.
const VTIGER_ORDER = [
  "createdAt", "modifiedAt", "name", "legalForm", "vatPayer", "organizationType", "cui", "rating",
  "tradeRegisterNo", "customerCategory", "assignedTo", "phone", "otherPhone", "ownership", "mobilePhone",
  "annualRevenue", "fax", "employees", "caenCode", "email", "website", "industry", "emailOptOut",
  "industrySpec", "organizationNo",
]
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

  it("close block 1 up two per row in vtiger's sequence, the only empty cell at the end", () => {
    const names = ORGANIZATION_BLOCKS[0].rows.flat()
    assert.deepEqual(names, [...VTIGER_ORDER, null])
  })

  it("hide Id, Type, Deleted, External Id and Last Modified By", () => {
    for (const name of ["id", "type", "deleted", "externalId", "modifiedBy"]) assert.equal(blockOf(name), undefined, name)
  })

  it("show billing only in the Address block, in vtiger's order", () => {
    assert.deepEqual(blocks[1].rows.flat().map((f) => f?.name ?? null), [
      "billingStreet", "billingCity", "billingState", "billingCode", "billingCountry", null,
    ])
  })
})
