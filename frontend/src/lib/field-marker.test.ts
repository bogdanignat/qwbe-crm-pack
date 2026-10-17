// The marker says a field is a mock the backend does not publish yet, or
// nothing once it does.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fieldMarkerOf, MOCK_MARKER } from "./field-marker.ts"
import { testField as field } from "./test-fields.ts"

describe("fieldMarkerOf", () => {
  it("marks a mock as Mock", () => {
    assert.equal(fieldMarkerOf(field({ mock: true })), MOCK_MARKER)
  })

  it("marks nothing published, custom or not", () => {
    assert.equal(fieldMarkerOf(field()), null)
    assert.equal(fieldMarkerOf(field({ custom: true })), null)
  })
})
