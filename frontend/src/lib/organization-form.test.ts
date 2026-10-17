// The organization form: the detail's blocks without the timestamps, and no
// mock field in any create, Duplicate or edit body.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata, Row } from "./cube.ts"
import { changedPayloadOf, duplicateValuesOf } from "./kit-form.ts"
import { withOrganizationDisplay } from "./organization-display.ts"
import { createBodyOf, editableFieldsOf, formBlocksOf, formDefaultsOf, type FormValues } from "./organization-form.ts"
import { testField as field } from "./test-fields.ts"
import { editedFieldError, fieldError } from "./validators.ts"
import { MOCK_FIELDS, withMockFields } from "../mock/organizations/index.ts"

const PUBLISHED = [
  "id", "type", "createdAt", "deleted", "name", "externalId", "organizationNo", "phone", "email", "website",
  "organizationType", "industry", "rating", "ownership", "employees", "emailOptOut", "billingStreet",
  "billingCity", "billingCode", "billingCountry", "description",
]
const READ_ONLY = new Set(["id", "type", "createdAt", "deleted"])
const TYPES: Record<string, string> = { deleted: "boolean", emailOptOut: "boolean", employees: "integer" }
const meta: CubeMetadata = {
  cube: "crm/organizations",
  entity: "Organization",
  version: null,
  schemaHash: "x",
  fields: PUBLISHED.map((name) => field({ name, type: TYPES[name] ?? "string", editable: !READ_ONLY.has(name), required: name === "name" })),
}
const fields = withMockFields(meta).fields
const blocks = formBlocksOf(fields)
const editable = editableFieldsOf(blocks)
const MOCK_NAMES = MOCK_FIELDS.map((f) => f.name)
// Every field filled, the mock ones included, as a careless caller might pass.
const everything = Object.fromEntries(fields.map((f) => [f.name, f.type === "boolean" ? true : "1"]))

const assertNoMock = (body: Record<string, unknown>) => {
  for (const name of MOCK_NAMES) assert.equal(name in body, false, name)
}

describe("formBlocksOf", () => {
  it("keeps the detail's three blocks, without Created and Modified Time", () => {
    assert.deepEqual(blocks.map((b) => b.title), ["Organization Information", "Address Information", "Description Information"])
    const names = blocks.flatMap((b) => b.rows.flat()).map((f) => f?.name)
    assert.equal(names.includes("createdAt"), false)
    assert.equal(names.includes("modifiedAt"), false)
    assert.equal(names.includes("cui"), true)
  })

  it("shows the Sector only in a Bucharest organization's Address block, never on create", () => {
    const placesOf = (shown: ReturnType<typeof formBlocksOf>) =>
      shown.flatMap((b) => (b.rows.some((row) => row.some((f) => f?.name === "billingSector")) ? [b.title] : []))
    assert.deepEqual(placesOf(blocks), [])
    assert.deepEqual(placesOf(formBlocksOf(fields, "Cluj")), [])
    assert.deepEqual(placesOf(formBlocksOf(fields, "București")), ["Address Information"])
  })

  it("edits the published editable fields only", () => {
    assert.equal(editable.some((f) => f.mock), false)
    assert.ok(editable.some((f) => f.name === "billingCity"))
  })

  it("hides the published Ownership: not shown, not edited, not sent from the form's values", () => {
    assert.equal(blocks.some((b) => b.rows.flat().some((f) => f?.name === "ownership")), false)
    assert.equal("ownership" in formDefaultsOf(editable), false)
    assert.equal("ownership" in createBodyOf(fields, { ...formDefaultsOf(editable), name: "Ada" }), false)
  })
})

describe("mock fields never travel", () => {
  it("in a create body", () => {
    const body = createBodyOf(fields, everything)
    assertNoMock(body)
    assert.equal(body.name, "1")
    assert.equal(body.emailOptOut, true)
  })

  it("in a Duplicate, from the copied values to the create body", () => {
    const row: Row = { id: "o1", ...everything, custom: Object.fromEntries(MOCK_NAMES.map((n) => [n, "x"])) }
    const copied = duplicateValuesOf(fields, row, new Set(["externalId", "organizationNo"]))
    assertNoMock(copied)
    assertNoMock(createBodyOf(fields, formDefaultsOf(editable, copied)))
  })

  it("in an Edit all body", () => {
    const payload = changedPayloadOf(fields, {}, everything)
    assertNoMock(payload)
    assert.equal(payload.billingCity, "1")
  })
})

describe("formDefaultsOf", () => {
  it("starts empty, or from Duplicate's text values, booleans as booleans", () => {
    const some = editable.filter((f) => f.name === "name" || f.name === "emailOptOut")
    assert.deepEqual(formDefaultsOf(some), { name: "", emailOptOut: false })
    assert.deepEqual(formDefaultsOf(some, { name: "Copy SRL", emailOptOut: "true" }), { name: "Copy SRL", emailOptOut: true })
  })
})

describe("the billing address, required on every save", () => {
  const shown = withOrganizationDisplay({ ...meta, fields }).fields
  const inputs = editableFieldsOf(formBlocksOf(shown))
  const street = inputs.find((f) => f.name === "billingStreet")!

  it("is refused empty on create", () => {
    assert.equal(fieldError(street, ""), "Billing Address is required")
  })

  it("does not block an edit elsewhere on an older organization that has none", () => {
    const initial: FormValues = { ...formDefaultsOf(inputs), name: "Old SRL", billingCity: "Arad" }
    const values: FormValues = { ...initial, name: "Old SRL Renamed" }
    for (const f of inputs) assert.equal(editedFieldError(f, values[f.name], initial[f.name]), null, f.name)
    assert.deepEqual(changedPayloadOf(inputs, initial, values), { name: "Old SRL Renamed" })
  })

  it("is refused when the edit empties it", () => {
    assert.equal(editedFieldError(street, " ", "Str. Veche 1"), "Billing Address is required")
  })
})
