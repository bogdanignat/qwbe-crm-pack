// Dates and times in the app's fixed locale and time zone (ro-RO,
// Europe/Bucharest), never raw ISO (T-1814).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { displayTextOf } from "./cube.ts"
import { formatDateTime, isIsoDateTime } from "./date-time.ts"
import { formatAt } from "./echo.ts"

describe("isIsoDateTime", () => {
  it("accepts a complete timestamp with a zone", () => {
    assert.ok(isIsoDateTime("2026-09-23T07:27:43.576Z"))
    assert.ok(isIsoDateTime("2019-03-14T09:12:00+02:00"))
  })

  it("leaves dates, free text and other types alone", () => {
    for (const value of ["2026-09-23", "2026-09-23T07:27", "J99/0001/2020", "2026-13-45T99:99:00Z", 42, null]) {
      assert.equal(isIsoDateTime(value), false, String(value))
    }
  })
})

describe("formatDateTime", () => {
  it("shows ro-RO date and time in Bucharest, whatever the machine's locale and zone", () => {
    assert.equal(formatDateTime("2025-11-02T15:40:00Z"), "02.11.2025, 17:40")
    assert.equal(formatDateTime("2026-10-16T16:21:33Z"), "16.10.2026, 19:21")
    assert.equal(formatDateTime("2026-10-16T16:21:33Z", { seconds: true }), "16.10.2026, 19:21:33")
    assert.equal(formatDateTime("not a date"), "not a date")
  })

  it("is what the activity feed shows too", () => {
    assert.equal(formatAt("2026-10-16T16:21:33Z"), "16.10.2026, 19:21:33")
  })
})

describe("displayTextOf", () => {
  it("formats a timestamp and keeps any other value's text", () => {
    assert.equal(displayTextOf("2026-09-23T07:27:43.576Z"), "23.09.2026, 10:27")
    assert.equal(displayTextOf("HINT ONE ZERO"), "HINT ONE ZERO")
    assert.equal(displayTextOf({ id: "u1", name: "Agent Vanzari 1" }), "Agent Vanzari 1")
  })
})
