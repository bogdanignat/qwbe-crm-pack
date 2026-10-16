// The marker says what a field still lacks: a cube field (Mock), a runtime
// custom field (Custom), or nothing once the backend publishes it.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CUSTOM_MARKER, fieldMarkerOf, MOCK_MARKER } from "./field-marker.ts"
import { testField as field } from "./test-fields.ts"

describe("fieldMarkerOf", () => {
  it("marks a mock bound for the cube as Mock", () => {
    assert.equal(fieldMarkerOf(field({ mock: true })), MOCK_MARKER)
  })

  it("marks a mock bound to be a runtime custom field as Custom", () => {
    assert.equal(fieldMarkerOf(field({ mock: true, custom: true })), CUSTOM_MARKER)
  })

  it("marks nothing published, custom or not", () => {
    assert.equal(fieldMarkerOf(field()), null)
    assert.equal(fieldMarkerOf(field({ custom: true })), null)
  })
})
