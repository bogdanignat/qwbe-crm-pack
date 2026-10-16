// The global search behind the command palette (T-1812).
//
// One list request per searchable page of the registry (lib/app-pages.ts) through
// the list contract's `q`: a case-insensitive PREFIX match over the fields the cube
// declares under `list.search`, ORed together. The demo organizations of the
// mockup layer are matched here the same way and marked, because the backend does
// not have them. What a real search over every module needs is in
// docs/plan/organizations-backend.md §7.

import { APP_PAGES } from "./app-pages.ts"
import { apiFetch, listApiPath, relationMeta, rowHref, titleOf, type CubeMetadata, type PageOf, type Row } from "./cube.ts"
import { ORGANIZATIONS_CUBE } from "./organization-display.ts"
import { DEMO_ORGANIZATIONS } from "../mock/organizations/index.ts"

export type SearchModule = { cube: string; label: string; demoRows?: Row[] }

const DEMO_ROWS: Record<string, Row[]> = { [ORGANIZATIONS_CUBE]: DEMO_ORGANIZATIONS }

// The searchable pages, in menu order.
export const SEARCH_MODULES: SearchModule[] = APP_PAGES.flatMap((page) =>
  page.search && page.cube ? [{ cube: page.cube, label: page.label, demoRows: DEMO_ROWS[page.cube] }] : [],
)

export const SEARCH_LIMIT = 5

export type SearchHit = { id: string; title: string; href: string; demo: boolean }

// One module's answer: its hits, or the sentence saying why it has none.
export type SearchGroup = { label: string; hits: SearchHit[]; error: string | null }

// `signal` cancels the list requests of a search the user has typed past.
export type SearchOptions = { doFetch?: typeof fetch; signal?: AbortSignal }

// Whether a row matches `q` the way the list contract does.
export function matchesPrefix(row: Row, fields: readonly string[], q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (needle === "") return false
  return fields.some((field) => String(row[field] ?? "").toLowerCase().startsWith(needle))
}

function hitsOf(module: SearchModule, meta: CubeMetadata, rows: Row[], demo: boolean): SearchHit[] {
  return rows.flatMap((row) => {
    const id = String(row.id)
    const href = rowHref(module.cube, id)
    return href ? [{ id, title: titleOf(meta, row), href, demo }] : []
  })
}

// The rows of one `q` page, or null for a refusal, a network error, an abort or a
// body that is not a page.
async function pageRowsOf(module: SearchModule, q: string, { doFetch = apiFetch, signal }: SearchOptions): Promise<Row[] | null> {
  try {
    const response = await doFetch(listApiPath(module.cube, { q, limit: SEARCH_LIMIT }), { signal })
    if (!response.ok) return null
    const page = (await response.json()) as PageOf<Row>
    return Array.isArray(page?.rows) ? page.rows : null
  } catch {
    return null
  }
}

// Never rejects: every failure becomes the group's sentence.
export async function searchModule(module: SearchModule, q: string, options: SearchOptions = {}): Promise<SearchGroup> {
  const group = (hits: SearchHit[], error: string | null = null) => ({ label: module.label, hits, error })
  const meta = await relationMeta(module.cube, options.doFetch)
  if (!meta) return group([], "Search unavailable.")
  // Without published search fields a kernel ignores `q` and would answer the
  // first page of everything as if it matched.
  const fields = meta.list?.search ?? []
  if (fields.length === 0) return group([], "This module is not searchable.")
  const rows = await pageRowsOf(module, q.trim(), options)
  if (!rows) return group([], "Search failed.")
  const demo = (module.demoRows ?? []).filter((row) => matchesPrefix(row, fields, q))
  return group([...hitsOf(module, meta, demo, true), ...hitsOf(module, meta, rows, false)])
}

// Every module's group, in menu order; the palette leaves out the empty ones.
export function searchAll(q: string, options: SearchOptions = {}): Promise<SearchGroup[]> {
  return Promise.all(SEARCH_MODULES.map((module) => searchModule(module, q, options)))
}
