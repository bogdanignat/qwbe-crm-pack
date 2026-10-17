// The values set in the mono font (T-1817).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { FieldMetadata } from "./cube.ts"
import { isMonoValue } from "./mono-value.ts"

const field = (over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name: "f",
  label: "F",
  type: "string",
  required: false,
  editable: true,
  sortable: false,
  searchable: false,
  nullable: true,
  enum: null,
  relation: null,
  custom: false,
  ...over,
})

describe("isMonoValue", () => {
  it("sets numbers, dates, phones and IBANs in mono", () => {
    assert.equal(isMonoValue(field({ type: "integer" }), 4), true)
    assert.equal(isMonoValue(field(), "2026-10-16T21:35:28.000Z"), true)
    assert.equal(isMonoValue(field({ format: "phone" }), "0232 830652"), true)
    assert.equal(isMonoValue(field({ format: "iban" }), "RO49 AAAA 1B31"), true)
  })

  it("sets codes in mono, words and names in the text font", () => {
    assert.equal(isMonoValue(field(), "ACC90001"), true)
    assert.equal(isMonoValue(field(), "99000001"), true)
    assert.equal(isMonoValue(field(), "Cluj-Napoca"), false)
    assert.equal(isMonoValue(field(), "SRL"), false)
    assert.equal(isMonoValue(field(), "T-1815 E2E Test SRL"), false)
    assert.equal(isMonoValue(field(), null), false)
  })

  it("never sets a relation in mono: it shows the linked record's name, not its id", () => {
    const relation = { target: "crm/organizations", entity: "Organization", summary: null }
    assert.equal(isMonoValue(field({ type: "integer", relation }), 42), false)
    assert.equal(isMonoValue(field({ relation }), "42"), false)
    assert.equal(isMonoValue(field({ relation }), "ORG42"), false)
  })
})
