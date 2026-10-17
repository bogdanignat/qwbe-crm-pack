// Batched relation resolution for the generic list.
//
// qwbe's list contract
// takes `ids=a,b,c` and sizes the batch by the ids themselves
// (qwbe core/src/kernel/list.ts: `ids=` is a batch, not a page), so one
// request per DISTINCT TARGET CUBE resolves every relation cell on the page.
//
// Pure derivation only: the fetch lives in the hook (use-relation-titles) and
// the components. Everything here is testable without a DOM or a backend.

import {
  cubeApiPath,
  customValueOf,
  titleOf,
  type CubeMetadata,
  type FieldMetadata,
  type Row,
} from "./cube.ts"

// One relation value the page must resolve: the target cube and the opaque id.
export type RelationRef = { target: string; id: string }

/**
 * Every relation value on a page, deduplicated, in first-seen order.
 *
 * A row's relation value lives wherever the backend keeps it (top level for a
 * static field, the `custom` sub-object for a runtime field), so the same
 * customValueOf the cells render with reads it here. Absent, null and empty
 * values contribute nothing -- an unset relation is not a cell to resolve.
 */
export function relationRefsOf(
  rows: ReadonlyArray<Row>,
  fields: ReadonlyArray<FieldMetadata>,
): RelationRef[] {
  const seen = new Set<string>()
  const refs: RelationRef[] = []
  for (const row of rows) {
    for (const field of fields) {
      const target = field.relation?.target
      if (!target) continue
      const value = customValueOf(row, field)
      if (value === null || value === undefined) continue
      const id = String(value)
      if (id === "") continue
      const key = `${target}|${id}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ target, id })
    }
  }
  return refs
}

/**
 * The ONE list request that resolves a batch of ids on one target cube.
 *
 * No `limit` is sent: qwbe sizes an ids batch by the ids themselves, so the
 * response returns exactly the rows asked for (capped at qwbe's MAX_LIMIT,
 * which no page of this app exceeds -- the page-size picker stops at 200).
 */
export function batchListApiPath(target: string, ids: ReadonlyArray<string>): string {
  const unique = [...new Set(ids)]
  const q = new URLSearchParams()
  q.set("ids", unique.join(","))
  return `${cubeApiPath(target)}?${q.toString()}`
}

/**
 * The typeahead search request for one target cube: `q` scans exactly the
 * fields the target's manifest declares searchable (qwbe
 * core/src/metadata/declarations.ts), `limit` keeps the suggestion list small.
 * An empty text means "no search": the first rows, capped by the same limit.
 */
export function relationSearchApiPath(
  target: string,
  text: string,
  limit: number,
): string {
  const q = new URLSearchParams()
  if (text.trim() !== "") q.set("q", text.trim())
  q.set("limit", String(limit))
  return `${cubeApiPath(target)}?${q.toString()}`
}

/**
 * id -> title for one response page, through the target cube's own metadata
 * (titleOf: the first required field, falling back to the id). A row the
 * response did not return (deleted between list and batch) is simply absent,
 * and the caller falls back to the raw id.
 */
export function titlesOfPage(
  meta: CubeMetadata,
  rows: ReadonlyArray<Row>,
): Record<string, string> {
  const titles: Record<string, string> = {}
  for (const row of rows) {
    if (row.id === undefined || row.id === null) continue
    titles[String(row.id)] = titleOf(meta, row)
  }
  return titles
}
