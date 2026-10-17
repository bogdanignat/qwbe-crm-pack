// The Organizations layout follows vtiger (spec §3.2, VTIGER_PLACEMENT): every
// mock field sits in its vtiger block, in vtiger's sequence, never in a
// leftover block; the meta fields are hidden; the Sector shows for Bucharest
// only.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata } from "./cube.ts"
import { fieldBlocksOf } from "./field-blocks.ts"
import { isBucharest, ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN, organizationLayoutOf } from "./organization-layout.ts"
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
const layoutFor = (billingState?: unknown, shippingState?: unknown) => {
  const { blocks, hidden } = organizationLayoutOf({ billingState, shippingState })
  return fieldBlocksOf(withMockFields(meta).fields, blocks, hidden)
}
const blocks = layoutFor()
const bucharest = layoutFor("Bucuresti", "Bucuresti")
// Block 1's fields in vtiger's sequence (spec §3.2), the dropped ones left out.
const VTIGER_ORDER = [
  "createdAt", "modifiedAt", "name", "legalForm", "vatPayer", "organizationType", "cui", "rating",
  "tradeRegisterNo", "customerCategory", "assignedTo", "phone", "otherPhone", "mobilePhone",
  "annualRevenue", "fax", "employees", "caenCode", "email", "website", "industry", "emailOptOut",
  "industrySpec", "organizationNo",
]
const blockOf = (name: string, shown = blocks) => shown.find((b) => b.rows.some((row) => row.some((f) => f?.name === name)))?.title

describe("ORGANIZATION_BLOCKS", () => {
  it("are vtiger's three blocks, in order, with no leftover block", () => {
    assert.deepEqual(blocks.map((b) => b.title), ["Organization Information", "Address Information", "Description Information"])
  })

  it("put every shown mock field in the block VTIGER_PLACEMENT gives it", () => {
    const { hidden } = organizationLayoutOf({ billingState: "Bucuresti", shippingState: "Bucuresti" })
    for (const f of MOCK_FIELDS.filter((f) => !hidden.has(f.name))) {
      assert.equal(blockOf(f.name, bucharest), VTIGER_PLACEMENT[f.name].block, f.name)
    }
  })

  it("read the mock fields in vtiger's sequence, left to right, top to bottom", () => {
    for (const spec of [...ORGANIZATION_BLOCKS, ...organizationLayoutOf({ billingState: "Bucuresti", shippingState: "RO-B" }).blocks]) {
      const sequences = spec.rows.flat().flatMap((name) => (name && VTIGER_PLACEMENT[name] ? [VTIGER_PLACEMENT[name].sequence] : []))
      assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b), spec.title)
    }
  })

  it("close block 1 up two per row in vtiger's sequence, with no empty cell", () => {
    const names = ORGANIZATION_BLOCKS[0].rows.flat()
    assert.deepEqual(names, VTIGER_ORDER)
  })

  it("hide Id, Type, Deleted, External Id, Last Modified By and the published Ownership", () => {
    for (const name of ["id", "type", "deleted", "externalId", "modifiedBy", "ownership"]) assert.equal(blockOf(name), undefined, name)
  })

  it("pair billing (left) with shipping (right), field by field, as vtiger", () => {
    assert.deepEqual(blocks[1].rows.map((row) => row.map((f) => f?.name ?? null)), [
      ["billingStreet", "shippingStreet"],
      ["billingCity", "shippingCity"],
      ["billingState", "shippingState"],
      ["billingCode", "shippingCode"],
      ["billingCountry", "shippingCountry"],
    ])
  })

  it("never place a Sector outside Bucharest, in any block, even laid out with the bare constants", () => {
    const sectorIn = (shown: typeof blocks) =>
      shown.some((b) => b.rows.some((row) => row.some((f) => f?.name === "billingSector" || f?.name === "shippingSector")))
    for (const county of ["Cluj", "Ilfov", "Bucuresti Sector 3", "", null, undefined]) {
      assert.equal(sectorIn(layoutFor(county, county)), false, String(county))
    }
    assert.equal(sectorIn(fieldBlocksOf(withMockFields(meta).fields, ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN)), false)
    assert.equal(blockOf("billingSector", bucharest), "Address Information")
    assert.equal(blockOf("shippingSector", bucharest), "Address Information")
  })

  it("end the Address block with each Bucharest side's Sector, the other cell empty, never a hole mid-block", () => {
    const lastRow = (shown: typeof blocks) => shown[1].rows.at(-1)?.map((f) => f?.name ?? null)
    assert.deepEqual(lastRow(layoutFor("Bucuresti", "Cluj")), ["billingSector", null])
    assert.deepEqual(lastRow(layoutFor("Cluj", "București")), [null, "shippingSector"])
    assert.deepEqual(lastRow(layoutFor("RO-B", "Municipiul Bucuresti")), ["billingSector", "shippingSector"])
    for (const shown of [layoutFor("Bucuresti"), layoutFor(undefined, "Bucuresti")]) {
      assert.ok(shown[1].rows.slice(0, -1).every((row) => row.every((f) => f !== null)))
    }
  })
})

describe("isBucharest", () => {
  it("matches Bucharest whatever the case, diacritics or Municipiul prefix, and its ISO code", () => {
    for (const county of ["Bucuresti", "București", "Bucureşti", "BUCURESTI", " bucurești ", "Municipiul București", "RO-B", "ro-b"]) {
      assert.equal(isBucharest(county), true, county)
    }
  })

  it("matches no other county, nothing empty and no non-text value", () => {
    for (const county of ["Cluj", "Ilfov", "RO-IF", "Bucuresti Sector 3", "", null, undefined, 3]) {
      assert.equal(isBucharest(county), false, String(county))
    }
  })
})
