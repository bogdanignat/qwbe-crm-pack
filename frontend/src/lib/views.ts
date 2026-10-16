// Typed adapter for the kernel `views` cube (QWB-62 stage F1), generic over
// every target cube: no CRM entity name appears here.
//
// Mirrors lib/sharing.ts: typed wrappers over the published routes, all calls
// through the same-origin proxy, injected `doFetch` for tests, never throws
// (`SharingResult` with status 0 = network). Sharing itself is NOT here: the
// view picker mounts the existing SharingPanel with `levels`/`customActions`
// (VIEW_ACTIONS below), and lib/sharing.ts always sends an explicit actions
// array, so the server's TOTAL default is never reached from this UI.
//
// `applyView` is the second half of view validation, run against the LIVE
// metadata of the target cube on every apply: the kernel cannot check field
// existence (it imports no other cube), so unknown columns/filters/sort are
// dropped here with an explicit warning -- never sent to the target cube.
// Pinned `fixedFilters` ALWAYS win over a view's filters: a view can neither
// override, nor unpin, nor hide a pinned filter.

import {
  apiFetch,
  errorBody,
  errorMessage,
  type CubeMetadata,
  type ListControls,
  type ListParams,
} from "./cube.ts"

// The cube and entity the kernel views cube publishes (core/src/cubes/views/index.ts).
export const VIEWS_CUBE = "views"
export const VIEW_ENTITY_TYPE = "SavedView"

// The only actions the SharingPanel's custom checkbox set offers for a view:
// read, plus edit when the owner explicitly co-edits. delete/transfer/create
// are never offered, and `share` is inert on a grant (requireShare ignores
// it), so it is excluded too.
export const VIEW_ACTIONS = ["read", "edit"] as const

// The page sizes every list offers; the first is the default (vtiger's 50 is
// among them). qwbe's own cap is 200 (MAX_LIMIT), so all are allowed.
export const PAGE_SIZES = [25, 50, 100] as const

// How many views one picker asks for. ponytail: one page of 200 (the kernel
// MAX_LIMIT); a user with more saved views for one cube needs paging here.
export const VIEWS_PAGE_LIMIT = 200

// One saved view row as the kernel returns it (SavedView schema). `config` is
// the re-encoded JSON string; decoding is the adapter's job (parseViewConfig).
export type SavedViewRow = {
  id: string
  targetCube: string
  name: string
  config: string
  createdAt: string
  updatedAt: string
  updatedBy: string
}

// The config vocabulary the kernel validates at write (view-config.ts
// ViewConfigSchema). Reserved query names constrain FILTER KEYS only.
export type ViewConfig = {
  columns?: string[]
  filters?: Record<string, string>
  q?: string
  sortBy?: string
  descending?: boolean
  pageSize?: number
}

export type SharingResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string }

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// One path segment, or null for a value that cannot name one (empty, or a
// bare "." / ".." the browser would fold before the request).
function oneSegment(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed === "." || trimmed === "..") return null
  return encodeURIComponent(trimmed)
}

export function viewsListPath(targetCube?: string): string {
  if (targetCube === undefined) return "/api/qwbe/views"
  return `/api/qwbe/views?targetCube=${encodeURIComponent(targetCube)}&limit=${VIEWS_PAGE_LIMIT}`
}

// The permissions cube's own per-actor visibility page for the views cube:
// for every view the caller may see, the SOURCE of that access and the
// actions it carries. This is the canonical ownership signal (the view row
// carries no ownerId, and updatedBy is provenance, never authority).
export function viewAccessPath(offset = 0): string {
  return `/api/qwbe/permissions/entities/${VIEWS_CUBE}?limit=${VIEWS_PAGE_LIMIT}&offset=${offset}`
}

export function viewPath(viewId: string): string | null {
  const id = oneSegment(viewId)
  return id ? `/api/qwbe/views/${id}` : null
}

// ---------------------------------------------------------------------------
// Stored config: decode with a boundary check, never trust the JSON string
// ---------------------------------------------------------------------------

// Decodes the stored `config` string of a view row. Returns null for a corrupt
// or wrong-typed document (an older or broken writer): the caller falls back
// to the default view -- a broken stored config must never throw in render.
export function parseViewConfig(row: Pick<SavedViewRow, "config">): ViewConfig | null {
  let raw: unknown
  try {
    raw = JSON.parse(row.config)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const config: ViewConfig = {}
  if (r.columns !== undefined) {
    if (!Array.isArray(r.columns) || r.columns.some((c) => typeof c !== "string")) return null
    config.columns = r.columns as string[]
  }
  if (r.filters !== undefined) {
    if (typeof r.filters !== "object" || r.filters === null || Array.isArray(r.filters)) return null
    const filters: Record<string, string> = {}
    for (const [key, value] of Object.entries(r.filters as Record<string, unknown>)) {
      if (typeof value !== "string") return null
      filters[key] = value
    }
    config.filters = filters
  }
  if (r.q !== undefined) {
    if (typeof r.q !== "string") return null
    config.q = r.q
  }
  if (r.sortBy !== undefined) {
    if (typeof r.sortBy !== "string") return null
    config.sortBy = r.sortBy
  }
  if (r.descending !== undefined) {
    if (typeof r.descending !== "boolean") return null
    config.descending = r.descending
  }
  if (r.pageSize !== undefined) {
    if (typeof r.pageSize !== "number") return null
    config.pageSize = r.pageSize
  }
  return config
}

// ---------------------------------------------------------------------------
// CRUD: same result shape as lib/sharing.ts, same error extraction
// ---------------------------------------------------------------------------

async function refusal(response: Response): Promise<{ ok: false; status: number; message: string }> {
  return { ok: false, status: response.status, message: errorMessage(await errorBody(response)) }
}

async function call<T>(
  path: string | null,
  init: RequestInit | undefined,
  doFetch: typeof fetch,
): Promise<SharingResult<T>> {
  if (!path) return { ok: false, status: 400, message: "invalid view id" }
  try {
    const response = await doFetch(path, init)
    if (!response.ok) return refusal(response)
    return { ok: true, value: (await response.json()) as T }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
}

// One page of the caller's own + granted views, optionally for one target
// cube. `total` is optional so an older kernel cannot push the caller into
// silent truncation (same rule as sharing.ts).
export type ViewPage = {
  rows: SavedViewRow[]
  total?: number
  offset: number
  limit: number
}

export async function listViews(
  targetCube: string,
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<ViewPage>> {
  return call<ViewPage>(viewsListPath(targetCube), undefined, doFetch)
}

// The config is sent as a plain object; the kernel validates and re-encodes it
// (view-config.ts) and answers 400 with its own message on refusal.
export async function createView(opts: {
  targetCube: string
  name: string
  config: ViewConfig
  doFetch?: typeof fetch
}): Promise<SharingResult<SavedViewRow>> {
  const targetCube = opts.targetCube.trim()
  const name = opts.name.trim()
  if (targetCube === "") return { ok: false, status: 400, message: "choose a cube" }
  if (name === "") return { ok: false, status: 400, message: "the view name cannot be empty" }
  return call<SavedViewRow>(
    viewsListPath(),
    jsonInit("POST", { targetCube, name, config: opts.config }),
    opts.doFetch ?? apiFetch,
  )
}

// `targetCube` is immutable on the kernel (ViewPatch has no such key), so the
// patch payload does not carry it either.
export async function updateView(
  viewId: string,
  patch: { name?: string; config?: ViewConfig },
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<SavedViewRow>> {
  return call<SavedViewRow>(viewPath(viewId), jsonInit("PATCH", patch), doFetch)
}

export async function deleteView(
  viewId: string,
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<SavedViewRow>> {
  return call<SavedViewRow>(viewPath(viewId), { method: "DELETE" }, doFetch)
}

// The latest stored row, fetched on every apply: a shared view may have been
// edited (or revoked: 403/404) since the picker listed it.
export async function fetchView(
  viewId: string,
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<SavedViewRow>> {
  return call<SavedViewRow>(viewPath(viewId), undefined, doFetch)
}

// ---------------------------------------------------------------------------
// Access: what the caller may do with each view, from the permissions cube
// ---------------------------------------------------------------------------

export type ViewAccess = { source: string; actions: string[] }

// Keyed by view id. A refused or failed call is reported as such (so the UI
// can say why management is hidden) and grants NOTHING: the caller treats it
// as an empty map, every right reads false, and the server stays the real
// gate. Holding the views route permission alone is never entity authority.
export async function fetchViewAccess(
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<Record<string, ViewAccess>>> {
  const access: Record<string, ViewAccess> = {}
  let offset = 0
  try {
    while (true) {
      const response = await doFetch(viewAccessPath(offset))
      if (!response.ok) return refusal(response)
      const page = (await response.json()) as {
        rows: Array<{ entityId: string; access: ViewAccess }>
        total?: number
      }
      for (const row of page.rows) access[row.entityId] = row.access
      offset += page.rows.length
      if (page.rows.length === 0 || page.total === undefined || offset >= page.total) {
        return { ok: true, value: access }
      }
    }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

export type ViewRights = { edit: boolean; delete: boolean; share: boolean }

// Sharing needs owner, cube admin or superadmin (requireShare); a grantee,
// even with every action, cannot re-share. "creator" is only ever reported
// for a cube admin, so it shares too.
const SHARE_SOURCES = new Set(["owner", "creator", "cube-admin", "superadmin"])

export function viewRights(access: ViewAccess | undefined): ViewRights {
  if (!access) return { edit: false, delete: false, share: false }
  return {
    edit: access.actions.includes("edit"),
    delete: access.actions.includes("delete"),
    share: SHARE_SOURCES.has(access.source),
  }
}

// ---------------------------------------------------------------------------
// The config a list's current state describes (what "Save" stores)
// ---------------------------------------------------------------------------

export type ListState = {
  columns: string[]
  // The chosen exact filters, keyed by field name; "" means "all".
  filters: Record<string, string>
  q: string
  sortBy?: string
  descending: boolean
  pageSize: number
}

// Pinned keys never enter a stored view (they belong to the caller, not the
// view); empty filter values and an empty q are omitted rather than stored.
export function configFromState(
  state: ListState,
  fixedFilters: Readonly<Record<string, string>> = {},
): ViewConfig {
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== "" && !(key in fixedFilters)) filters[key] = value
  }
  const config: ViewConfig = { columns: [...state.columns], filters, pageSize: state.pageSize }
  if (state.q.trim() !== "") config.q = state.q
  if (state.sortBy !== undefined) {
    config.sortBy = state.sortBy
    config.descending = state.descending
  }
  return config
}

// ---------------------------------------------------------------------------
// applyView: the pure sanitizer, run on every apply against live metadata
// ---------------------------------------------------------------------------

export type AppliedView = {
  // Field names for the columns render, in view order, or null when the view
  // carries no column list (the caller keeps its default column set).
  columns: string[] | null
  // The query parameters to merge into the next list request. Pinned
  // fixedFilters are ALREADY merged in here -- they always win.
  params: ListParams
  // The page size the list should render (snapped and clamped, not the raw
  // stored value).
  pageSize: number
  // Human-readable notices for everything the view asked for that the live
  // metadata no longer honours. Never empty-string entries.
  warnings: string[]
}

// Pure: no fetch, no storage, no React. `controls` comes from
// listControlsOf(fields, meta.list, fixedFilters), so it already excludes
// reserved query names and pinned keys from its filter list.
export function applyView(
  config: ViewConfig,
  meta: CubeMetadata,
  controls: ListControls,
  fixedFilters: Readonly<Record<string, string>> = {},
): AppliedView {
  const warnings: string[] = []
  const fieldNames = new Set(meta.fields.map((f) => f.name))
  const filterNames = new Set(controls.filters.map((f) => f.name))
  const pinned = new Set(Object.keys(fixedFilters))
  // The title field (first required, the row-link column cube.ts renders).
  const titleField = meta.fields.find((f) => f.required)

  // 1. Columns: unknown names dropped with a warning, view order kept, and the
  //    title column always retained so a row never loses its navigation.
  let columns: string[] | null = null
  if (config.columns !== undefined) {
    const kept: string[] = []
    for (const name of config.columns) {
      if (fieldNames.has(name)) {
        if (!kept.includes(name)) kept.push(name)
      } else {
        warnings.push(`column "${name}" no longer exists in this list`)
      }
    }
    if (titleField && !kept.includes(titleField.name)) kept.unshift(titleField.name)
    columns = kept
  }

  // 2. Filters: unknown keys warned, pinned keys silently overridden (fixed
  //    filters ALWAYS win), then fixedFilters merged last.
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.filters ?? {})) {
    if (pinned.has(key)) continue
    if (filterNames.has(key)) filters[key] = value
    else warnings.push(`filter "${key}" is not available in this list`)
  }
  Object.assign(filters, fixedFilters)

  // 3. q only when the cube publishes a search scan.
  let q: string | undefined
  if (config.q !== undefined && config.q !== "") {
    if (controls.search) q = config.q
    else warnings.push('this list has no search, the view text "q" was dropped')
  }

  // 4. sortBy only inside the published sort list; descending goes with it.
  let sortBy: string | undefined
  let descending: boolean | undefined
  const sortList = meta.list?.sort
  if (config.sortBy !== undefined) {
    if (sortList && sortList.includes(config.sortBy)) {
      sortBy = config.sortBy
      descending = config.descending === true
    } else {
      warnings.push(`sort by "${config.sortBy}" is not available in this list`)
    }
  }

  // 5. pageSize snapped to the nearest offered size, then clamped to the
  //    published cap. A changed value is reported, not silent.
  let pageSize = meta.list?.defaultPageSize ?? PAGE_SIZES[0]
  if (config.pageSize !== undefined && Number.isFinite(config.pageSize)) {
    const snapped = PAGE_SIZES.reduce((best, size) =>
      Math.abs(size - config.pageSize!) < Math.abs(best - config.pageSize!) ? size : best,
    )
    const max = meta.list?.maxPageSize ?? PAGE_SIZES[PAGE_SIZES.length - 1]
    pageSize = Math.min(snapped, Math.max(max, 1))
    if (pageSize !== config.pageSize) {
      warnings.push(`page size ${config.pageSize} was adjusted to ${pageSize}`)
    }
  }

  return {
    columns,
    params: { filters, q, sortBy, descending, offset: 0 },
    pageSize,
    warnings,
  }
}
