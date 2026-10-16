// The Contacts related list (T-1814): vtiger's columns over what the
// contacts cube publishes, and its range label.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata } from "./cube.ts"
import { contactColumnsOf, contactsRangeOf } from "./related-contacts.ts"
import { testField as field } from "./test-fields.ts"

const meta = (names: string[]): CubeMetadata => ({
  cube: "crm/contacts",
  entity: "Contact",
  version: null,
  schemaHash: "x",
  fields: names.map((name) => field({ name })),
})

const shape = (m: CubeMetadata) => contactColumnsOf(m).map((c) => [c.label, c.field?.name ?? null, c.field?.format ?? null])

describe("contactColumnsOf", () => {
  it("shows Name in place of Last/First Name until the cube publishes them, the rest as mock", () => {
    assert.deepEqual(shape(meta(["id", "name", "email", "phone"])), [
      ["Name", "name", null],
      ["Mobile", null, null],
      ["Email", "email", "email"],
      ["Office Phone", "phone", "phone"],
      ["Title", null, null],
      ["Assigned To", null, null],
    ])
  })

  it("uses vtiger's columns once the cube publishes the names", () => {
    const labels = contactColumnsOf(meta(["lastName", "firstName", "mobilePhone"])).map((c) => c.label)
    assert.deepEqual(labels, ["Last Name", "First Name", "Mobile", "Email", "Office Phone", "Title", "Assigned To"])
  })
})

describe("contactsRangeOf", () => {
  it("says the range of the page and the total", () => {
    assert.equal(contactsRangeOf(1, 10, 23), "1-10 of 23")
    assert.equal(contactsRangeOf(3, 3, 23), "21-23 of 23")
    assert.equal(contactsRangeOf(1, 0, 0), "0 of 0")
    assert.equal(contactsRangeOf(2, 10, undefined), "11-20")
  })
})
