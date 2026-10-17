// The detail values shared by the renderers (T-1814): the shown text, the
// refusal split by field and the Duplicate values.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CHECK_FIELDS, duplicateValuesOf, fieldTextOf, refusalOfError, shownRefusalOf } from "./kit-form.ts"
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

describe("refusalOfError", () => {
  it("reads qwbe's message and the per-field issues of an HttpError", () => {
    const error = Object.assign(new Error("Validation failed"), { body: { errors: { name: "too long" } } })
    assert.deepEqual(refusalOfError(error), { message: "Validation failed", errors: { name: "too long" } })
  })

  it("has no field issue when the error has no body (ra-core HttpError, body null) or is no Error", () => {
    const error = Object.assign(new Error("Forbidden"), { body: null })
    assert.deepEqual(refusalOfError(error), { message: "Forbidden", errors: {} })
    assert.deepEqual(refusalOfError("offline"), { message: "offline", errors: {} })
  })
})

describe("shownRefusalOf", () => {
  const name = field({ name: "name", label: "Organization Name" })
  const email = field({ name: "email", label: "Email" })
  const cui = field({ name: "cui", label: "CUI" })
  const fields = [name, email, cui]

  it("puts every issue on a rendered input under it, in the form's order, and asks to check them", () => {
    const shown = shownRefusalOf({ message: "Validation failed", errors: { email: "bad", name: "short" } }, [name, email], fields)
    assert.deepEqual(shown, { message: CHECK_FIELDS, fieldErrors: { name: "short", email: "bad" } })
    assert.deepEqual(Object.keys(shown.fieldErrors), ["name", "email"])
  })

  it("keeps qwbe's message when no issue has a usable path", () => {
    assert.deepEqual(shownRefusalOf({ message: "Forbidden", errors: {} }, [name], fields), { message: "Forbidden", fieldErrors: {} })
  })

  it("names an issue on a field the form does not render by its label, never as a field error", () => {
    const shown = shownRefusalOf({ message: "Validation failed", errors: { name: "short", cui: "taken", ghost: "x" } }, [name], fields)
    assert.deepEqual(shown, { message: "Validation failed (CUI: taken; ghost: x)", fieldErrors: { name: "short" } })
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
