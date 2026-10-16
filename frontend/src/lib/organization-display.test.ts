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
  it("labels the published rating Company status and leaves the rest", () => {
    const labels = withOrganizationDisplay(meta("crm/organizations")).fields.map((f) => f.label)
    assert.deepEqual(labels, ["Name", "Company status", "Phone", "Website"])
  })

  it("formats phone, email and website as links, unless the backend publishes a format", () => {
    const published = meta("crm/organizations")
    published.fields[3] = { ...published.fields[3], format: "email" }
    const formats = withOrganizationDisplay(published).fields.map((f) => f.format)
    assert.deepEqual(formats, [undefined, undefined, "phone", "email"])
  })

  it("leaves every other cube untouched", () => {
    const contacts = meta("crm/contacts")
    assert.equal(withOrganizationDisplay(contacts), contacts)
  })
})
