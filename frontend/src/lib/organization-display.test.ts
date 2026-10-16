// The organization UI labels (T-1811): a UI decision on real fields that must
// hold with or without the mockup layer.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata, FieldMetadata } from "./cube.ts"
import { withOrganizationDisplay } from "./organization-display.ts"

const field = (name: string, label: string): FieldMetadata => ({
  name,
  label,
  type: "string",
  required: false,
  editable: true,
  sortable: false,
  searchable: false,
  nullable: true,
  enum: null,
  relation: null,
  custom: false,
})

const meta = (cube: string): CubeMetadata => ({
  cube,
  entity: null,
  version: null,
  schemaHash: "x",
  fields: [field("name", "Name"), field("rating", "Rating"), field("phone", "Phone"), field("website", "Website")],
})

describe("withOrganizationDisplay", () => {
  it("uses vtiger's labels (Organization Name, Company status) and leaves the rest", () => {
    const labels = withOrganizationDisplay(meta("crm/organizations")).fields.map((f) => f.label)
    assert.deepEqual(labels, ["Organization Name", "Company status", "Phone", "Website"])
  })

  it("uses vtiger's en_us labels for the address and the creation time", () => {
    const published = meta("crm/organizations")
    published.fields = [field("billingStreet", "Billing Street"), field("billingCode", "Billing Code"), field("createdAt", "Created At")]
    const labels = withOrganizationDisplay(published).fields.map((f) => f.label)
    assert.deepEqual(labels, ["Billing Address", "Billing Postal Code", "Created Time"])
  })

  it("names the currency of the two amounts: EUR, the single currency for now", () => {
    const amounts = meta("crm/organizations")
    amounts.fields = [field("annualRevenue", "Annual Revenue"), field("turnoverEur", "Account Turnover (€)")]
    const labels = withOrganizationDisplay(amounts).fields.map((f) => f.label)
    assert.deepEqual(labels, ["Annual Revenue (EUR)", "Account Turnover (EUR)"])
  })

  it("formats phone, email and website as links, unless the backend publishes a format", () => {
    const published = meta("crm/organizations")
    published.fields[3] = { ...published.fields[3], format: "email" }
    const formats = withOrganizationDisplay(published).fields.map((f) => f.format)
    assert.deepEqual(formats, [undefined, undefined, "phone", "email"])
  })

  it("offers vtiger's picklists for Type, Industry and Company status, unless the backend publishes an enum", () => {
    const published = meta("crm/organizations")
    published.fields = [field("industry", "Industry"), field("organizationType", "Type"), field("ownership", "Ownership")]
    published.fields[1] = { ...published.fields[1], enum: ["Published"] }
    const [industry, type, ownership] = withOrganizationDisplay(published).fields
    assert.ok((industry.enum ?? []).length > 10)
    assert.deepEqual(type.enum, ["Published"])
    assert.equal(ownership.enum, null)
    const [rating] = withOrganizationDisplay({ ...meta("crm/organizations"), fields: [field("rating", "Rating")] }).fields
    assert.deepEqual(rating.enum?.slice(0, 2), ["Activ", "Inactiv"])
  })

  it("leaves every other cube untouched", () => {
    const contacts = meta("crm/contacts")
    assert.equal(withOrganizationDisplay(contacts), contacts)
  })
})
