// A select keeps a stored value its list lacks, once, first.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { selectChoicesOf } from "./select-choices.ts"

describe("selectChoicesOf", () => {
  it("is the list when the stored value is in it or empty", () => {
    assert.deepEqual(selectChoicesOf(["A", "B"], "B", "", null, undefined), ["A", "B"])
  })

  it("puts a legacy value first, once, as it is stored", () => {
    assert.deepEqual(selectChoicesOf(["A", "B"], "Testing", "Testing", "A"), ["Testing", "A", "B"])
    assert.deepEqual(selectChoicesOf([], "Old"), ["Old"])
  })
})
