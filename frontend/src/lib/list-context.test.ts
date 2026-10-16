// The previous / next record of a detail page, from the list it was opened from.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { neighborsOf, parseListContext } from "./list-context.ts"

describe("neighborsOf", () => {
  const ids = ["org_mock_001", "a", "b"]

  it("gives the records before and after, none past either end", () => {
    assert.deepEqual(neighborsOf(ids, "a"), { previous: "org_mock_001", next: "b" })
    assert.deepEqual(neighborsOf(ids, "org_mock_001"), { previous: null, next: "a" })
    assert.deepEqual(neighborsOf(ids, "b"), { previous: "a", next: null })
  })

  it("gives nothing for a record the list did not show", () => {
    assert.equal(neighborsOf(ids, "zzz"), null)
  })
})

describe("parseListContext", () => {
  it("reads the stored ids, and nothing from a missing or broken value", () => {
    assert.deepEqual(parseListContext('["a","b"]'), ["a", "b"])
    assert.deepEqual(parseListContext(null), [])
    assert.deepEqual(parseListContext("{oops"), [])
    assert.deepEqual(parseListContext('[1,"a"]'), ["a"])
  })
})
