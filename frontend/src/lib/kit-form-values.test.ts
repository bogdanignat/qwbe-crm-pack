// The detail values shared by the renderers (T-1814): the shown text, the
// refusal text and the Duplicate values.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { duplicateValuesOf, fieldTextOf, refusalTextOf } from "./kit-form.ts"
import { testField as field } from "./test-fields.ts"

const noTitles = () => null

describe("fieldTextOf", () => {
  it("shows yes/no, a relation's title or id, a local timestamp, a dash for empty", () => {
    const parent = field({ name: "parent", relation: { target: "crm/organizations", entity: "Organization", summary: null } })
    const record = { flag: false, parent: "org-1", at: "2026-09-23T07:27:43.576Z", empty: "" }
    assert.equal(fieldTextOf(field({ name: "flag", type: "boolean" }), record, noTitles), "no")
    assert.equal(fieldTextOf(parent, record, noTitles), "org-1")
    assert.equal(fieldTextOf(parent, record, () => "Acme SRL"), "Acme SRL")
    assert.ok(!fieldTextOf(field({ name: "at" }), record, noTitles)?.includes("T07:27"))
    assert.equal(fieldTextOf(field({ name: "empty" }), record, noTitles), null)
  })
})

describe("refusalTextOf", () => {
  it("adds each refused field under its label", () => {
    const error = Object.assign(new Error("Validation failed"), { body: { errors: { name: "too long" } } })
    assert.equal(refusalTextOf(error, [field()]), "Validation failed (Name: too long)")
    assert.equal(refusalTextOf(new Error("Forbidden"), []), "Forbidden")
  })
})

describe("duplicateValuesOf", () => {
  const fields = [
    field({ name: "id", editable: false }),
    field({ name: "createdAt", editable: false }),
    field(),
    field({ name: "emailOptOut", type: "boolean" }),
    field({ name: "externalId" }),
    field({ name: "employees", type: "integer" }),
    field({ name: "country", custom: true }),
    field({ name: "cui", mock: true }),
    field({ name: "assignedTo" }),
  ]
  const row = {
    id: "org-1",
    createdAt: "2026-09-23T07:27:43.576Z",
    name: "Acme SRL",
    emailOptOut: false,
    externalId: "vt-1",
    employees: 42,
    cui: "99000001",
    assignedTo: { id: "u1", name: "Agent" },
    custom: { country: "Iasi" },
  }

  it("copies the editable published values as text, never the id, a mock field or a skipped name", () => {
    assert.deepEqual(duplicateValuesOf(fields, row, new Set(["externalId"])), {
      name: "Acme SRL",
      emailOptOut: "false",
      employees: "42",
      country: "Iasi",
    })
  })
})
