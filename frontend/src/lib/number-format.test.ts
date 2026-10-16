// Thousand separators in the app's fixed locale, ro-RO (T-1814).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fieldDisplayTextOf } from "./cube.ts"
import { formatNumber } from "./number-format.ts"
import { testField as field } from "./test-fields.ts"

describe("formatNumber", () => {
  it("groups thousands with a dot and keeps decimals after a comma", () => {
    assert.equal(formatNumber(850000), "850.000")
    assert.equal(formatNumber(42), "42")
    assert.equal(formatNumber(1234.5), "1.234,5")
  })
})

describe("fieldDisplayTextOf", () => {
  it("formats the value of a numeric field, never a number kept in a text field", () => {
    assert.equal(fieldDisplayTextOf(field({ type: "integer" }), 850000), "850.000")
    assert.equal(fieldDisplayTextOf(field({ type: "number" }), 1234.5), "1.234,5")
    assert.equal(fieldDisplayTextOf(field({ type: "string" }), 99000001), "99000001")
    assert.equal(fieldDisplayTextOf(field({ type: "integer" }), "n/a"), "n/a")
  })
})
