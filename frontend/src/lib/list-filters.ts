// The chips under a list's toolbar: one per active search or filter, each
// removable on its own, so the reader always sees what narrows the list.

import type { FieldMetadata } from "./cube.ts"

export type FilterChip = { key: string; label: string; value: string }

// "q" is the quick search; every other key is an exact filter field.
export const SEARCH_CHIP = "q"

export function filterChipsOf(q: string, filters: Readonly<Record<string, string>>, fields: readonly FieldMetadata[]): FilterChip[] {
  const search = q.trim() === "" ? [] : [{ key: SEARCH_CHIP, label: "Search", value: q.trim() }]
  const exact = fields.flatMap((f) => (filters[f.name] ? [{ key: f.name, label: f.label, value: filters[f.name] }] : []))
  return [...search, ...exact]
}
