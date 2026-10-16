// A detail page laid out as vtiger lays it out: titled blocks of label/value
// rows, two fields per row (left, right), or one wide field. The page names
// the fields; labels, types and editability still come from the metadata.
//
// Nothing published is lost: a field no block names joins the first block
// (static) or a "Custom fields" block (runtime custom), two per row, so a
// field added tomorrow shows without a frontend change.

import type { FieldMetadata } from "./cube.ts"

// One row by field names: [left, right], or [wide] for a full-width field.
// null leaves a cell empty on purpose.
export type FieldRowSpec = readonly (string | null)[]
export type FieldBlockSpec = { title: string; rows: readonly FieldRowSpec[] }

export type FieldRow = readonly (FieldMetadata | null)[]
export type FieldBlock = { title: string; rows: FieldRow[] }

export const CUSTOM_BLOCK_TITLE = "Custom fields"

export function fieldBlocksOf(
  fields: readonly FieldMetadata[],
  specs: readonly FieldBlockSpec[],
  hidden: ReadonlySet<string> = new Set(),
): FieldBlock[] {
  const byName = new Map(fields.filter((f) => !hidden.has(f.name)).map((f) => [f.name, f]))
  const placed = new Set<string>()
  const take = (name: string | null): FieldMetadata | null => {
    const field = name === null ? undefined : byName.get(name)
    if (!field || placed.has(field.name)) return null
    placed.add(field.name)
    return field
  }

  const blocks: FieldBlock[] = specs.map((spec) => ({
    title: spec.title,
    // A row whose fields are all unpublished disappears; a half-published
    // row keeps its empty cell, so billing stays left and shipping right.
    rows: spec.rows.map((row) => row.map(take)).filter((row) => row.some((f) => f !== null)),
  }))

  const rest = [...byName.values()].filter((f) => !placed.has(f.name))
  const leftovers = pairsOf(rest.filter((f) => !f.custom))
  if (leftovers.length > 0 && blocks.length > 0) blocks[0].rows.push(...leftovers)
  const custom = pairsOf(rest.filter((f) => f.custom))
  if (custom.length > 0) blocks.push({ title: CUSTOM_BLOCK_TITLE, rows: custom })

  return blocks.filter((block) => block.rows.length > 0)
}

// Fields two per row, in order; an odd last one keeps an empty right cell.
export function pairsOf(fields: readonly FieldMetadata[]): FieldRow[] {
  const rows: FieldRow[] = []
  for (let i = 0; i < fields.length; i += 2) rows.push([fields[i], fields[i + 1] ?? null])
  return rows
}

// How a block is read, top to bottom, in the DOM as on screen: a run of
// two-field rows as two columns (all the left fields, then all the right
// ones, empty cells kept so each field stays on its row), a wide row alone.
// A run longer than `maxRows` continues in a new section below.
export type GridSection =
  | { kind: "wide"; field: FieldMetadata | null }
  | { kind: "columns"; left: (FieldMetadata | null)[]; right: (FieldMetadata | null)[] }

export function gridSectionsOf(rows: readonly FieldRow[], maxRows: number): GridSection[] {
  const sections: GridSection[] = []
  for (const row of rows) {
    if (row.length === 1) {
      sections.push({ kind: "wide", field: row[0] })
      continue
    }
    const last = sections.at(-1)
    if (last?.kind === "columns" && last.left.length < maxRows) {
      last.left.push(row[0])
      last.right.push(row[1] ?? null)
    } else {
      sections.push({ kind: "columns", left: [row[0]], right: [row[1] ?? null] })
    }
  }
  return sections
}
