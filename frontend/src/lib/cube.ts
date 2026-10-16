// Metadata-driven list and detail logic for the CRM frontend.
//
// The one design rule: adding a field to a cube must appear in the list without a
// line of frontend code. Everything here reads the published cube metadata
// (GET /catalog/{cube}/metadata) and the cube's own list endpoint; no module in
// this frontend names a field of a specific cube.
//
// All qwbe calls go through the server-side proxy (/api/qwbe/...), so the token
// stays in the httpOnly cookie and never reaches browser-visible code.

import { APP_PAGES } from "./app-pages.ts"

// The published field metadata (qwbe core/src/metadata/schemas.ts).
export type FieldMetadata = {
  name: string
  label: string
  type: string
  required: boolean
  editable: boolean
  sortable: boolean
  searchable: boolean
  nullable: boolean
  enum: string[] | null
  relation: { target: string; entity: string; summary: string | null } | null
  // True when the field is a runtime-defined custom field. Its value
  // lives in the row's reserved `custom` sub-object, not at the row's top level.
  custom: boolean
  // True for a field the backend does not publish yet, merged in from the
  // mockup layer (src/mock). Shown marked, never edited, never sent.
  mock?: boolean
  // How a text value is shown: a mailto:, tel: or http link. qwbe does not
  // publish it yet; the mock and the organization page supply it.
  format?: FieldFormat
}

export type FieldFormat = "email" | "phone" | "url"

// The list query contract a cube publishes (qwbe core/src/metadata/schemas.ts
// ListContract): what its list route actually honours. `search` names the fields
// `q=` scans (PREFIX match, ORed together); `filters` names the fields accepted
// as `<field>=<value>` EXACT match, relations always among them.
export type ListContractMetadata = {
  params: string[]
  maxPageSize: number
  defaultPageSize: number
  search: string[]
  filters: string[]
  sort: string[]
}

export type CubeMetadata = {
  cube: string
  entity: string | null
  version: string | null
  schemaHash: string
  // The published list contract. Optional in the type only so a response from a
  // kernel that publishes nothing here still parses; every UI control derives
  // from it when present (see listControlsOf).
  list?: ListContractMetadata | null
  fields: FieldMetadata[]
}

// A page as the qwbe list contract returns it (PageOf). `total` is optional here
// because the UI must survive a response without it: paging then falls back to
// what the current page proves (offset + rows.length), and the "of N" count is
// dropped instead of disabling Next forever.
export type PageOf<T> = {
  rows: T[]
  total?: number
  offset: number
  limit: number
}

export type Row = Record<string, unknown>

// The value of one field in one row, wherever the backend stores it. A custom
// field's value travels in the row's `custom` sub-object (qwbe
// core/src/custom-values.ts); a static field's value sits at the top level.
// A row carrying an ORPHAN custom value (one whose definition was deleted)
// never matches a published field, so this simply never asks for it.
export function customValueOf(row: Row, field: FieldMetadata): unknown {
  if (!field.custom) return row[field.name]
  const custom = row.custom
  return custom && typeof custom === "object" ? (custom as Row)[field.name] : undefined
}

// The control a cell edits with, derived from the field's metadata alone --
// never from a list of field names. A `select` (metadata `enum`) edits as a
// select, a custom boolean as a checkbox, everything else as a text input.
export type RenderKind = "select" | "checkbox" | "text"

export function renderKindOf(field: FieldMetadata): RenderKind {
  if (field.enum && field.enum.length > 0) return "select"
  if (field.custom && field.type === "boolean") return "checkbox"
  return "text"
}

// Whether the signed-in user may define custom fields. qwbe's /auth/me
// publishes the effective permission list; defining rides on the
// customfields:write permission (the customfields pack's own manifest). A user
// without it gets no panel at all -- and a direct API call answers 403.
export function canDefineFields(permissions: ReadonlyArray<string>): boolean {
  return permissions.includes("customfields:write")
}

// The query-string keys qwbe's list contract owns. A cube field with one of
// these names must never be sent as a bare filter key, or it would override
// paging. `q` and `ids` are reserved for the same reason: qwbe's list contract
// reads them itself (q scans the searchable fields, ids fetches a batch), so a
// field of one of those names must not arrive as a bare filter key either.
// The fixed half of qwbe's list query (core/src/metadata/declarations.ts
// ListParams -- the same keys the published contract lists under `params`). A
// cube field with one of these names must never be sent as a bare filter key:
// it would override paging, sorting or the q/ids scans.
const RESERVED_QUERY_KEYS = new Set([
  "offset",
  "limit",
  "sortBy",
  "descending",
  "page",
  "pageSize",
  "sort",
  "q",
  "ids",
])

export type ListParams = {
  offset?: number
  limit?: number
  sortBy?: string
  descending?: boolean
  // Field filters (server-side exact equality, e.g. organizationId on contacts). Keys are
  // field NAMES from the metadata, never hard-coded per entity here.
  filters?: Record<string, string>
  // Prefix search over the cube's declared search fields, as qwbe's list route
  // reads `q` itself. First-class, never smuggled through `filters`.
  q?: string
}

// The single first path segment a cube serves under. qwbe mounts a child cube
// ("crm/organizations") at "/<leaf>" (core/src/kernel/routes.ts routePrefixOf; a leaf
// that collides with a standalone cube is mounted as "<parent>-<name>"). The
// HTTP prefix therefore comes from the leaf, never from the full cube name.
export function httpPrefixOf(cube: string): string {
  return cube.includes("/") ? cube.split("/").pop()! : cube
}

// The browser's single reaction to a 401 from the proxy: the session is dead
// and the proxy already cleared the cookie on the way out, so leave for /login
// with this page as the destination.
// Same signature as fetch, so it drops in wherever a `typeof fetch` is asked for.
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status === 401 && typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search
    // replace, not push: the page we are leaving cannot be rendered without a
    // session, so Back must not return to it. A full document load (not a
    // router push) is deliberate -- it drops the client state of a dead
    // session and lets the middleware see the cleared cookie.
    window.location.replace(`/login?next=${encodeURIComponent(here)}`)
    // Never resolves: the caller must not render an error over a page that is
    // already navigating away.
    await new Promise(() => undefined)
  }
  return response
}

// Proxy path for a cube-relative qwbe path: the cube "crm/organizations" becomes
// /api/qwbe/organizations, because that is the prefix the cube actually serves at.
export function cubeApiPath(cube: string, suffix = ""): string {
  return `/api/qwbe/${httpPrefixOf(cube)}${suffix}`
}

// Metadata is under /catalog/{cube}/metadata and a child cube name
// ("crm/organizations") is a single path parameter, so it must be percent-encoded.
export function metadataApiPath(cube: string): string {
  return `/api/qwbe/catalog/${encodeURIComponent(cube)}/metadata`
}

// Proxy path of one record (GET /<leaf>/{id}). The id is one path segment, so
// it is percent-encoded: an id carrying "/" must never become extra segments.
// Returns null for an id that cannot name a record: empty (would resolve to
// the LIST endpoint) or a bare "." / ".." (the browser folds those before the
// request, and the proxy refuses a decoded ".." anyway).
export function recordApiPath(cube: string, id: string): string | null {
  if (id === "" || id === "." || id === "..") return null
  return cubeApiPath(cube, `/${encodeURIComponent(id)}`)
}

// The kernel's one OpenAPI document (qwbe core/src/main.ts GatedOpenApi): the
// complete spec across every mounted cube, served only to an authenticated
// Bearer, hence through the same cookie proxy as every other call. There is
// no per-cube spec and no documented anchor, so this is deliberately the
// whole document with no invented query or fragment filter.
export const OPENAPI_API_PATH = "/api/qwbe/openapi.json"

// Builds the query string of a list request. Paging and sorting go to qwbe
// (server-side paging end to end); there is no client-side slice anywhere.
// A filter key that collides with a paging key is skipped rather than sent, so
// a field named "limit" can never override paging. A test asserts both.
export function listQueryString(params: ListParams): string {
  const q = new URLSearchParams()
  if (params.offset !== undefined) q.set("offset", String(params.offset))
  if (params.limit !== undefined) q.set("limit", String(params.limit))
  if (params.sortBy !== undefined) q.set("sortBy", params.sortBy)
  if (params.descending) q.set("descending", "true")
  if (params.q !== undefined && params.q !== "") q.set("q", params.q)
  for (const [field, value] of Object.entries(params.filters ?? {})) {
    if (value !== "" && !RESERVED_QUERY_KEYS.has(field)) q.set(field, value)
  }
  return q.toString()
}

// The filter and search controls a list offers, derived from the PUBLISHED list
// contract. `search` is one prefix search sent as `q` (the contract's `search`
// fields are scanned by the backend); `filters` are exact-equality fields the
// backend accepts as `<field>=<value>`. A field the caller pins through
// fixedFilters gets no control of its own, and a field named like a list
// parameter is never admitted as a filter.
// Without a published contract (an older kernel) the fallback is the field
// flags: searchable fields as exact filters, no q.
export type ListControls = {
  search: boolean
  filters: FieldMetadata[]
}

export function listControlsOf(
  fields: FieldMetadata[],
  list: ListContractMetadata | null | undefined,
  fixedFilters: Readonly<Record<string, string>> = {},
): ListControls {
  const byName = new Map(fields.map((f) => [f.name, f]))
  const pinned = new Set(Object.keys(fixedFilters))
  const pick = (names: string[]): FieldMetadata[] =>
    names
      .filter((n) => !pinned.has(n) && !RESERVED_QUERY_KEYS.has(n))
      .map((n) => byName.get(n))
      .filter((f): f is FieldMetadata => f !== undefined)
  if (list) return { search: list.search.length > 0, filters: pick(list.filters) }
  return {
    search: false,
    filters: pick(fields.filter((f) => f.searchable).map((f) => f.name)),
  }
}

export function listApiPath(cube: string, params: ListParams): string {
  const qs = listQueryString(params)
  return `${cubeApiPath(cube)}${qs ? `?${qs}` : ""}`
}

// Columns are DERIVED from metadata. The default column set is metadata-driven
// too: a field absent from the create payload (editable: false) is a backend
// bookkeeping column (id, type, version, deleted, createdAt) and is hidden by
// default, so a 60k-row list does not render five dead columns per row. A mock
// field bound for a custom field (src/mock) is hidden by default too.
export type ColumnSpec = {
  field: FieldMetadata
  sortable: boolean
  editable: boolean
  visible: boolean
}

export function columnsFromFields(fields: FieldMetadata[]): ColumnSpec[] {
  return fields.map((field) => ({
    field,
    sortable: field.sortable,
    editable: field.editable,
    visible: field.editable && !(field.mock && field.custom),
  }))
}

// A cell is editable exactly when the metadata says so. A field that is not
// editable refuses editing, whatever the caller asks; a mock field has no
// backend column to save into.
export function canEdit(field: FieldMetadata): boolean {
  return field.editable && !field.mock
}

// The text of one value: a reference object ({id, name}, e.g. an owner) shows
// its name, anything else its string form.
export function valueTextOf(value: unknown): string {
  const name = value && typeof value === "object" ? (value as Row).name : undefined
  return typeof name === "string" ? name : String(value)
}

// The link a formatted value opens (vtiger shows phones, emails and websites as
// links), or null. A website without http(s):// gets http:// in front, as in
// vtiger, so a stored "javascript:..." can only ever become a plain web address.
export function formatHrefOf(field: FieldMetadata, value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  if (text === "") return null
  if (field.format === "email") return `mailto:${text}`
  if (field.format === "url") return /^https?:\/\//i.test(text) ? text : `http://${text}`
  const digits = text.replace(/[^\d+]/g, "")
  return field.format === "phone" && digits !== "" ? `tel:${digits}` : null
}

// What the list shows around one server page. Demo rows (mockup data, never
// from the server) ride on top of the first unfiltered page only, and never
// count: the range and the total stay the server's ("0 of 0" when the server
// has no rows), and the label says how many demo rows ride on top.
export function listWindowOf(
  page: PageOf<Row>,
  demoRows: readonly Row[],
  filtered: boolean,
): { demo: readonly Row[]; label: string } {
  const demo = page.offset === 0 && !filtered ? demoRows : []
  const range = page.rows.length === 0 ? "0" : `${page.offset + 1}-${page.offset + page.rows.length}`
  const server = page.total === undefined ? range : `${range} of ${page.total}`
  return { demo, label: demo.length > 0 ? `${server} · +${demo.length} demo` : server }
}

// The sort a column click produces: undefined for a column the metadata does
// not mark sortable, so a non-sortable header can never trigger a request.
/**
 * Where the reader is in the result set, for a paginator that can jump.
 *
 * `lastPage` is undefined when qwbe reports no total: nothing can then say how
 * many pages exist, and only a short page proves the end was reached.
 */
export function pageWindow(
  offset: number,
  pageSize: number,
  total: number | undefined,
): { currentPage: number; lastPage: number | undefined } {
  return {
    currentPage: Math.floor(offset / pageSize) + 1,
    lastPage: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)),
  }
}

// The page a typed "Page" value asks for: a whole number clamped to
// 1..lastPage (no upper clamp while qwbe has not reported a total). Anything
// that is not a whole number -- empty, "2.5", "abc", Infinity -- is undefined,
// and the caller restores the current page instead of requesting one.
export function pageFromInput(raw: string, lastPage: number | undefined): number | undefined {
  const text = raw.trim()
  const n = Number(text)
  if (text === "" || !Number.isInteger(n)) return undefined
  return Math.max(1, lastPage === undefined ? n : Math.min(n, lastPage))
}

export function sortRequestFor(
  column: ColumnSpec,
  currentSortBy: string | undefined,
  currentDescending: boolean,
): { sortBy: string; descending: boolean } | undefined {
  if (!column.sortable) return undefined
  if (currentSortBy === column.field.name) {
    return { sortBy: column.field.name, descending: !currentDescending }
  }
  return { sortBy: column.field.name, descending: false }
}

// Extracts the human-readable message from a qwbe error response. A validation
// failure is a 400 whose body carries `issues` (per-field messages) and a
// `message`; the per-field message wins ONLY when its path names the edited
// field -- an issue about a different field must not be shown in this cell.
export function errorMessage(body: unknown, fieldName?: string): string {
  if (typeof body === "string" && body.length > 0) return body
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; issues?: unknown }
    if (Array.isArray(b.issues) && b.issues.length > 0) {
      const forField = b.issues.find(
        (i) =>
          i &&
          typeof i === "object" &&
          Array.isArray((i as { path?: unknown[] }).path) &&
          (i as { path: unknown[] }).path[0] === fieldName &&
          typeof (i as { message?: unknown }).message === "string" &&
          ((i as { message: string }).message as string).length > 0,
      ) as { message: string } | undefined
      if (forField) return forField.message
    }
    if (typeof b.message === "string" && b.message.length > 0) return b.message
  }
  return "the change was refused"
}

// The body of a failed response, tolerating non-JSON: qwbe's message wins, but
// a plain-text error body must not crash the parser and lose the text.
export async function errorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "")
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// The error for a failed load: the body's message when there is one (for
// example "qwbe API unreachable at ..." from the proxy), else the status.
export async function requestFailure(what: string, response: Response): Promise<Error> {
  const body = await errorBody(response)
  const message =
    typeof body === "string" ? body : (body as { message?: unknown } | undefined)?.message
  return new Error(
    typeof message === "string" && message.length > 0
      ? message
      : `${what} request failed: ${response.status}`,
  )
}

// The record routes this app actually has, from the pages registry, under the
// full cube name and its leaf. A relation whose target has no route renders as
// plain text instead of a dead link.
const RELATION_ROUTES: Record<string, string> = Object.fromEntries(
  APP_PAGES.flatMap((page) => (page.cube ? [[page.cube, page.href], [httpPrefixOf(page.cube), page.href]] : [])),
)

// Builds the link for a related row, or null when the target cube has no
// frontend route (for example crm/contracts): the caller then renders text.
export function hrefForRelation(target: string, id: string): string | null {
  const route = RELATION_ROUTES[target]
  return route ? `${route}/${id}` : null
}

// The leaf route segment of a cube, used to link from a contact to its
// organization detail page and back.
export function routeOf(cube: string): string {
  return `/${cube.split("/").pop()}`
}

// The link to one row's detail page, or null when this app has no route for
// the cube (for example crm/contracts): a list then renders no row links.
export function rowHref(cube: string, id: string): string | null {
  const route = RELATION_ROUTES[cube] ?? RELATION_ROUTES[httpPrefixOf(cube)]
  return route ? `${route}/${id}` : null
}

// The human title of a row, derived from metadata: the value of the first
// required field (name on both CRM cubes), falling back to the id.
export function titleOf(meta: CubeMetadata, row: Row): string {
  const titleField = meta.fields.find((f) => f.required)
  const value = titleField ? row[titleField.name] : undefined
  return value === undefined || value === null ? String(row.id) : String(value)
}

// Resolves the display title of a related id through the target cube's own
// surface: its metadata (for the title field) and its row endpoint. Falls back
// to the raw id when either request fails -- a cell never blocks on it.
const metaCache = new Map<string, CubeMetadata>()

// Fetches (and session-caches) a cube's published metadata, or null when the
// request fails. Shared by every relation surface: batch cell resolution and
// the typeahead both need the title field, and each cube's metadata is fetched
// at most once per session.
export async function relationMeta(
  target: string,
  doFetch: typeof fetch = apiFetch,
): Promise<CubeMetadata | null> {
  const hit = metaCache.get(target)
  if (hit) return hit
  try {
    const r = await doFetch(metadataApiPath(target))
    if (!r.ok) return null
    const meta = (await r.json()) as CubeMetadata
    metaCache.set(target, meta)
    return meta
  } catch {
    return null
  }
}

// The value a PATCH carries for one edited cell, derived from the field
// metadata: an enum stays a string (the Select offers the published values), a
// boolean becomes a real boolean, numbers become numbers, and an empty string
// is null only for a nullable field -- for a non-nullable field the empty
// string travels as-is so qwbe refuses it with its own message.
export function coerce(field: FieldMetadata, value: string): unknown {
  if (field.type === "boolean") {
    if (value === "") return field.nullable ? null : false
    return value === "true" || value === "yes" || value === "1"
  }
  if (value === "") return field.nullable ? null : value
  if (field.enum && field.enum.length > 0) return value
  if (field.type === "integer" || field.type === "number") {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  return value
}

// The body of a create request, built from the form's string values with the
// SAME coerce the inline editor saves with. Untouched fields (empty after
// trim) are skipped, so the payload carries only what was filled and the
// create schema's defaults apply to the rest; a required field left empty is
// reported by its label, so the form can refuse the submit with qwbe's own
// field names instead of a 400 round trip. A boolean is the exception: an
// untouched checkbox IS a value (false), not an absence -- a required boolean
// (the sandbox's TVA flag) must reach qwbe as false, not as a refusal.
export function createPayloadOf(
  fields: FieldMetadata[],
  values: Record<string, string>,
): { payload: Record<string, unknown>; missing: string[] } {
  const payload: Record<string, unknown> = {}
  const missing: string[] = []
  for (const field of fields) {
    if (field.mock) continue
    const value = (values[field.name] ?? "").trim()
    if (value === "" && field.type !== "boolean") {
      if (field.required) missing.push(field.label)
    } else {
      payload[field.name] = coerce(field, value)
    }
  }
  return { payload, missing }
}

// A fieldset of a detail page: a legend and the field NAMES it groups, in
// display order. Names only -- labels, types and editability still come from
// the metadata, so this is a layout hint, not a second schema. `important`
// is a presentation emphasis for the page's primary section (a border accent
// plus a textual "Important" marker, never color alone); it says nothing
// about the data and is never derived from it.
export type FieldGroupSpec = { legend: string; fields: string[]; important?: boolean }

export type FieldSection = { legend: string; fields: FieldMetadata[]; important?: boolean }

// Distributes the published fields over the caller's groups by name. A name
// the metadata does not publish is skipped (the field was removed or renamed
// on the backend); a published field NO group names is never lost: static
// leftovers land in "Other", runtime custom fields in "Custom fields" -- so a
// custom field defined tomorrow shows up without a frontend change. Empty
// groups render nothing.
export function groupFields(fields: FieldMetadata[], groups: readonly FieldGroupSpec[]): FieldSection[] {
  const byName = new Map(fields.map((f) => [f.name, f]))
  const placed = new Set<string>()
  const sections: FieldSection[] = []
  for (const group of groups) {
    const chosen: FieldMetadata[] = []
    for (const name of group.fields) {
      const field = byName.get(name)
      if (field && !placed.has(name)) {
        chosen.push(field)
        placed.add(name)
      }
    }
    if (chosen.length > 0) {
      sections.push({ legend: group.legend, fields: chosen, ...(group.important ? { important: true } : {}) })
    }
  }
  const rest = fields.filter((f) => !placed.has(f.name))
  const other = rest.filter((f) => !f.custom)
  const custom = rest.filter((f) => f.custom)
  if (other.length > 0) sections.push({ legend: "Other", fields: other })
  if (custom.length > 0) sections.push({ legend: "Custom fields", fields: custom })
  return sections
}

// The row after one saved field, merging ONLY that key: a concurrent,
// out-of-order response body must not overwrite the other fields. A custom
// field's value lives in the row's `custom` sub-object, where the cell reads
// it back -- merging it flat would leave the cell showing "--" or the stale
// value until a full reload.
export function withSavedValue(row: Row, field: FieldMetadata, value: unknown): Row {
  return field.custom
    ? { ...row, custom: { ...((row.custom as Row | undefined) ?? {}), [field.name]: value } }
    : { ...row, [field.name]: value }
}

export type SaveResult =
  | { status: "unchanged" }
  | { status: "saved"; field: string; value: unknown }
  | { status: "refused"; message: string }

// One inline edit, as a pure async function so the request path is testable
// without a DOM: PATCHes exactly the edited key, merges ONLY that key from the
// response (an out-of-order stale body must not overwrite newer columns), and
// returns qwbe's own message -- matched to the edited field -- on refusal.
//
// The pre-edit value is derived HERE, from the row and the field, via the same
// customValueOf the cell renders with. A caller cannot hand in a "current": a
// custom field's value lives in the row's `custom` sub-object, and a caller
// that reads the top level always passes `undefined` -- which would make an
// empty save look like a no-op and skip the request entirely.
export async function saveCell(opts: {
  rowPath: string
  row: Row
  field: FieldMetadata
  next: string
  doFetch: typeof fetch
}): Promise<SaveResult> {
  const { rowPath, row, field, next, doFetch } = opts
  if (field.mock) return { status: "refused", message: "mock field: not saved" }
  const current = customValueOf(row, field)
  if (next === String(current ?? "")) return { status: "unchanged" }
  // One path for static AND custom fields: a custom field is saved through the
  // TARGET cube's own PATCH, the kernel folds the undeclared key into the
  // row's `custom` sub-object and validates it against the definition, and a
  // refusal comes back as qwbe's own message.
  const response = await doFetch(rowPath, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [field.name]: coerce(field, next) }),
  })
  if (!response.ok) {
    return { status: "refused", message: errorMessage(await errorBody(response), field.name) }
  }
  const saved = (await response.json()) as Row
  // A custom field's stored value comes back inside the row's `custom`
  // sub-object; a static field's value stays at the top level.
  const value = field.custom
    ? ((saved.custom as Row | undefined)?.[field.name] ?? null)
    : saved[field.name]
  return { status: "saved", field: field.name, value }
}
