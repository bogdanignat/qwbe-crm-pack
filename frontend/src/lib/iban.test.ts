// The IBAN in groups of four (T-1814).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { ibanGroupsOf } from "./iban.ts"

describe("ibanGroupsOf", () => {
  it("splits into groups of four, the last one shorter", () => {
    assert.deepEqual(ibanGroupsOf("RO00EXMP0000000000000001"), ["RO00", "EXMP", "0000", "0000", "0000", "0001"])
    assert.deepEqual(ibanGroupsOf("DE89370400440532013000"), ["DE89", "3704", "0044", "0532", "0130", "00"])
  })

  it("regroups a value stored with spaces and is empty for an empty value", () => {
    assert.deepEqual(ibanGroupsOf("RO49 AAAA 1B31"), ["RO49", "AAAA", "1B31"])
    assert.deepEqual(ibanGroupsOf(""), [])
  })
})
