// The Organizations list defaults: vtiger's "All" columns plus CUI and
// Billing State, every one a field the list has (published or mock).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata } from "./cube.ts"
import { filterChipsOf } from "./list-filters.ts"
import { ORGANIZATION_LIST_COLUMNS, ORGANIZATION_LIST_UNLISTED, organizationEditHref } from "./organization-list.ts"
import { withOrganizationDisplay } from "./organization-display.ts"
import { testField as field } from "./test-fields.ts"
import { withMockFields } from "../mock/organizations/index.ts"

const PUBLISHED = ["id", "name", "organizationNo", "phone", "website", "billingCity", "industry"]
const meta: CubeMetadata = {
  cube: "crm/organizations",
  entity: "Organization",
  version: null,
  schemaHash: "x",
  fields: PUBLISHED.map((name) => field({ name })),
}

describe("ORGANIZATION_LIST_COLUMNS", () => {
  const fields = withOrganizationDisplay(withMockFields(meta)).fields

  it("are all fields of the list, none a future custom field", () => {
    for (const name of ORGANIZATION_LIST_COLUMNS) {
      const f = fields.find((x) => x.name === name)
      assert.ok(f, name)
      assert.equal(f.custom, false, name)
    }
  })

  it("offer the shipping address in the column picker, not by default", () => {
    for (const name of ["shippingStreet", "shippingCity", "shippingState", "shippingCode", "shippingCountry"]) {
      assert.ok(fields.some((f) => f.name === name), name)
      assert.equal((ORGANIZATION_LIST_COLUMNS as readonly string[]).includes(name), false, name)
      assert.equal(ORGANIZATION_LIST_UNLISTED.has(name), false, name)
    }
  })

  it("leave out Ownership and both Sectors, by default and in the column picker", () => {
    for (const name of ["ownership", "billingSector", "shippingSector"]) {
      assert.equal((ORGANIZATION_LIST_COLUMNS as readonly string[]).includes(name), false, name)
      assert.equal(ORGANIZATION_LIST_UNLISTED.has(name), true, name)
    }
  })

  it("use the detail page's vtiger labels", () => {
    const label = (name: string) => fields.find((f) => f.name === name)?.label
    assert.equal(label("name"), "Organization Name")
    assert.equal(label("billingState"), "Billing State")
  })
})

describe("organizationEditHref", () => {
  it("opens the detail page in edit mode, the id encoded", () => {
    assert.equal(organizationEditHref("org/1"), "/organizations/org%2F1?edit=all")
  })
})

describe("filterChipsOf", () => {
  it("shows the search first, then each active filter by its label", () => {
    const fields = [field({ name: "name", label: "Organization Name" }), field({ name: "industry", label: "Industry" })]
    assert.deepEqual(filterChipsOf(" exem ", { industry: "Agricultura", name: "" }, fields), [
      { key: "q", label: "Search", value: "exem" },
      { key: "industry", label: "Industry", value: "Agricultura" },
    ])
    assert.deepEqual(filterChipsOf("", {}, fields), [])
  })
})
