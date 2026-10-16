// The vtiger detail layout (T-1814): named blocks of label/value rows, and
// nothing published lost.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fieldBlocksOf, gridSectionsOf, pairsOf, type FieldBlock, type GridSection } from "./field-blocks.ts"
import { testField as field } from "./test-fields.ts"

const names = (blocks: FieldBlock[]) =>
  blocks.map((b) => ({ title: b.title, rows: b.rows.map((row) => row.map((f) => f?.name ?? null)) }))

const SPECS = [
  { title: "Main", rows: [["a", "b"], ["c", "gone"], ["gone", "gone2"]] },
  { title: "Notes", rows: [["note"]] },
]

describe("fieldBlocksOf", () => {
  it("places fields by name, keeps a half row's empty cell, drops an empty row", () => {
    const fields = ["a", "b", "c", "note"].map((name) => field({ name }))
    assert.deepEqual(names(fieldBlocksOf(fields, SPECS)), [
      { title: "Main", rows: [["a", "b"], ["c", null]] },
      { title: "Notes", rows: [["note"]] },
    ])
  })

  it("hides the names it is told to and drops a block left empty", () => {
    const fields = ["a", "b", "note"].map((name) => field({ name }))
    const blocks = fieldBlocksOf(fields, SPECS, new Set(["note"]))
    assert.deepEqual(names(blocks), [{ title: "Main", rows: [["a", "b"]] }])
  })

  it("adds unnamed static fields to the first block and custom ones to their own block", () => {
    const fields = [field({ name: "a" }), field({ name: "x" }), field({ name: "y", custom: true })]
    assert.deepEqual(names(fieldBlocksOf(fields, SPECS)), [
      { title: "Main", rows: [["a", null], ["x", null]] },
      { title: "Custom fields", rows: [["y", null]] },
    ])
  })
})

describe("pairsOf", () => {
  it("puts two fields per row", () => {
    const rows = pairsOf(["a", "b", "c"].map((name) => field({ name })))
    assert.deepEqual(rows.map((r) => r.map((f) => f?.name ?? null)), [["a", "b"], ["c", null]])
  })
})

describe("gridSectionsOf", () => {
  const f = (name: string) => field({ name })
  const sectionNames = (sections: GridSection[]) =>
    sections.map((s) =>
      s.kind === "wide"
        ? s.field?.name
        : { left: s.left.map((x) => x?.name ?? null), right: s.right.map((x) => x?.name ?? null) },
    )

  it("reads a run of rows column by column, empty cells kept on their row", () => {
    const rows = [[f("street"), f("shipStreet")], [f("city"), null], [null, f("shipCode")]]
    assert.deepEqual(sectionNames(gridSectionsOf(rows, 24)), [
      { left: ["street", "city", null], right: ["shipStreet", null, "shipCode"] },
    ])
  })

  it("keeps a wide row alone, between the runs around it", () => {
    const rows = [[f("a"), f("b")], [f("note")], [f("c"), f("d")]]
    assert.deepEqual(sectionNames(gridSectionsOf(rows, 24)), [
      { left: ["a"], right: ["b"] },
      "note",
      { left: ["c"], right: ["d"] },
    ])
  })

  it("continues a run longer than maxRows in a new section", () => {
    const rows = [[f("a"), f("b")], [f("c"), f("d")], [f("e"), f("g")]]
    assert.deepEqual(sectionNames(gridSectionsOf(rows, 2)), [
      { left: ["a", "c"], right: ["b", "d"] },
      { left: ["e"], right: ["g"] },
    ])
  })
})
