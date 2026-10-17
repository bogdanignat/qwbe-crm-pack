// The company status lights (T-1817).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { companyStatusToneOf } from "./status-tone.ts"

describe("companyStatusToneOf", () => {
  it("lights an active company as running and a closing one as an alert", () => {
    assert.equal(companyStatusToneOf("Activ"), "ok")
    assert.equal(companyStatusToneOf("Restructurare"), "warn")
    assert.equal(companyStatusToneOf("Insolventa"), "alert")
    assert.equal(companyStatusToneOf("Inactiv"), "idle")
  })

  it("leaves an unknown value idle, an inherited object key included", () => {
    assert.equal(companyStatusToneOf("Necunoscut"), "idle")
    assert.equal(companyStatusToneOf("constructor"), "idle")
  })
})
