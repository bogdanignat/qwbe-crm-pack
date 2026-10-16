// Typed adapter for the qwbe `echo` cube (activity feed + comments), verified
// against qwbe core/src/cubes/echo/index.ts and feed.ts on 2026-09-07:
//
//   GET    /echo/feed?cube=&entityId=&before=&limit=   -> { rows, nextBefore }
//   POST   /echo/comments?cube=&entityId=  { body }   -> FeedRow (op "comment")
//   PATCH  /echo/comments/:id              { body }   -> FeedComment
//   DELETE /echo/comments/:id                         -> FeedComment (body "", deletedAt set)
//
// The target travels as QUERY parameters because a cube name may carry a slash
// ("crm/contacts"); the comment id is kernel-generated and rides in the path.
// Every call goes through the same-origin proxy (/api/qwbe/...), like lib/cube.ts.
//
// Authority is the server's: the feed hides what the caller may not see, the
// comment routes answer 403 for anything the caller may not do. This module
// mirrors the kernel's rules only to decide which controls to OFFER (author
// edits, author or moderator deletes), never to grant anything.

import { apiFetch, errorBody, errorMessage } from "./cube.ts"
import { formatDateTime } from "./date-time.ts"

// FeedComment (echo/index.ts): `body` is "" once deleted; the log never carries text.
export type FeedComment = {
  id: string
  cube: string
  entityType: string
  rowId: string
  actorId: string | null
  actorUsername: string | null
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  deletedBy: string | null
}

// FeedRow (echo/index.ts). `actorId` null = no authenticated request wrote it
// (boot, migration): shown as "system", never as a person.
export type FeedRow = {
  id: number
  at: string
  cube: string
  entityType: string
  rowId: string
  op: string
  version: number | null
  actorId: string | null
  actorUsername: string | null
  changes: Record<string, unknown> | null
  commentId: string | null
  comment: FeedComment | null
}

// `nextBefore` is the id of the last SCANNED row (visible or not), null only
// when the scan is exhausted: an empty `rows` with a non-null cursor means
// "nothing visible on this page, more to scan", NOT "no activity".
export type FeedPage = {
  rows: FeedRow[]
  nextBefore: number | null
}

export type EchoResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string }

// The kernel's body boundary (CommentBody: trimmed, 1..4000). Mirrored so an
// empty or oversized draft is refused before a round trip; the server still
// validates.
export const COMMENT_MAX = 4000

export type FeedQuery = {
  cube?: string
  entityId?: string
  before?: number
  limit?: number
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function clean(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text === undefined || text === "" ? undefined : text
}

// The feed query. `entityId` without `cube` is refused here (the kernel
// answers 403 "entityId requires cube"); a cursor or limit that is not a
// positive integer is refused too, never sent as "NaN".
export function feedPath(query: FeedQuery): string | null {
  const cube = clean(query.cube)
  const entityId = clean(query.entityId)
  if (entityId !== undefined && cube === undefined) return null
  const params = new URLSearchParams()
  if (cube !== undefined) params.set("cube", cube)
  if (entityId !== undefined) params.set("entityId", entityId)
  for (const [key, value] of [
    ["before", query.before],
    ["limit", query.limit],
  ] as const) {
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 1) return null
    params.set(key, String(value))
  }
  const qs = params.toString()
  return `/api/qwbe/echo/feed${qs ? `?${qs}` : ""}`
}

export function commentsPath(cube: string, entityId: string): string | null {
  const c = clean(cube)
  const e = clean(entityId)
  if (c === undefined || e === undefined) return null
  const params = new URLSearchParams({ cube: c, entityId: e })
  return `/api/qwbe/echo/comments?${params.toString()}`
}

export function commentPath(id: string): string | null {
  const c = clean(id)
  return c === undefined ? null : `/api/qwbe/echo/comments/${encodeURIComponent(c)}`
}

// GET /permissions/cube-admins?cube= answers 200 exactly when the permission
// foundation's `state.cubeAdmin(actor, cube)` holds -- the SAME predicate that
// yields the "superadmin" / "cube-admin" decision sources the echo cube
// accepts for moderation (foundation.ts, cube-admins.ts). 403 otherwise.
export function moderatorProbePath(cube: string): string | null {
  const c = clean(cube)
  return c === undefined ? null : `/api/qwbe/permissions/cube-admins?cube=${encodeURIComponent(c)}`
}

// GET /settings/cubes: the live catalogue (settings:read, every signed-in
// role). The /echo filter is drawn from it, never from a hardcoded list.
export const CUBES_PATH = "/api/qwbe/settings/cubes"

// ---------------------------------------------------------------------------
// Trust boundary: the feed page as received
// ---------------------------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === "string"
const isNullOrString = (v: unknown): v is string | null => v === null || typeof v === "string"

// A cube that may appear in the feed: `name` is the filter value, `entity`
// its label. Kept from the catalogue when enabled with an entity -- the
// closest client-side reading of the kernel's `recordsActivity` (CubeInfo
// carries no identity-directory flag; such a cube answers 403 "does not
// capture activity" from the feed, shown verbatim). Sorted by name.
export type ActivityCube = { name: string; entity: string }

export function parseActivityCubes(raw: unknown): ActivityCube[] | null {
  if (!Array.isArray(raw)) return null
  const cubes: ActivityCube[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") return null
    const c = item as Record<string, unknown>
    if (!isString(c.name) || typeof c.enabled !== "boolean" || !isNullOrString(c.entity)) return null
    if (c.enabled && c.entity !== null) cubes.push({ name: c.name, entity: c.entity })
  }
  return cubes.sort((a, b) => a.name.localeCompare(b.name))
}

export function parseFeedComment(raw: unknown): FeedComment | null {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Record<string, unknown>
  if (
    !isString(c.id) ||
    !isString(c.cube) ||
    !isString(c.entityType) ||
    !isString(c.rowId) ||
    !isNullOrString(c.actorId) ||
    !isNullOrString(c.actorUsername) ||
    !isString(c.body) ||
    !isString(c.createdAt) ||
    !isNullOrString(c.editedAt) ||
    !isNullOrString(c.deletedAt) ||
    !isNullOrString(c.deletedBy)
  ) {
    return null
  }
  return {
    id: c.id,
    cube: c.cube,
    entityType: c.entityType,
    rowId: c.rowId,
    actorId: c.actorId,
    actorUsername: c.actorUsername,
    body: c.body,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    deletedAt: c.deletedAt,
    deletedBy: c.deletedBy,
  }
}

export function parseFeedRow(raw: unknown): FeedRow | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.id !== "number" ||
    !isString(r.at) ||
    !isString(r.cube) ||
    !isString(r.entityType) ||
    !isString(r.rowId) ||
    !isString(r.op) ||
    !(r.version === null || typeof r.version === "number") ||
    !isNullOrString(r.actorId) ||
    !isNullOrString(r.actorUsername) ||
    !(r.changes === null || (typeof r.changes === "object" && !Array.isArray(r.changes))) ||
    !isNullOrString(r.commentId)
  ) {
    return null
  }
  const comment = r.comment === null || r.comment === undefined ? null : parseFeedComment(r.comment)
  if (r.comment !== null && r.comment !== undefined && comment === null) return null
  return {
    id: r.id,
    at: r.at,
    cube: r.cube,
    entityType: r.entityType,
    rowId: r.rowId,
    op: r.op,
    version: r.version as number | null,
    actorId: r.actorId,
    actorUsername: r.actorUsername,
    changes: r.changes as Record<string, unknown> | null,
    commentId: r.commentId,
    comment,
  }
}

export function parseFeedPage(raw: unknown): FeedPage | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  if (!Array.isArray(p.rows)) return null
  if (!(p.nextBefore === null || typeof p.nextBefore === "number")) return null
  const rows: FeedRow[] = []
  for (const item of p.rows) {
    const row = parseFeedRow(item)
    if (!row) return null
    rows.push(row)
  }
  return { rows, nextBefore: p.nextBefore as number | null }
}

// ---------------------------------------------------------------------------
// Pure display helpers (plain text only -- values are never rendered as HTML)
// ---------------------------------------------------------------------------

export type ChangeLine = { field: string; from: string | null; to: string | null }

function plain(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// `changes` as stored: { "<field>": { from?, to? } } (create: `to` only,
// update: both, delete: {}). Any other shape for a field becomes its text.
export function describeChanges(changes: Record<string, unknown> | null): ChangeLine[] {
  if (!changes) return []
  return Object.entries(changes).map(([field, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && ("from" in value || "to" in value)) {
      const v = value as { from?: unknown; to?: unknown }
      return { field, from: plain(v.from), to: plain(v.to) }
    }
    return { field, from: null, to: plain(value) }
  })
}

// Who did it, as the row records it: the username snapshot, else the raw actor
// id, else "system" (no authenticated request wrote the row). Nothing is
// inferred about humans versus agents: the actor is whatever account held
// the token.
export function actorLabel(row: { actorId: string | null; actorUsername: string | null }): string {
  return row.actorUsername ?? row.actorId ?? "system"
}

const OP_LABELS: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  comment: "commented",
}

export function opLabel(op: string): string {
  return OP_LABELS[op] ?? op
}

export type CommentState = "current" | "edited" | "deleted"

export function commentState(c: Pick<FeedComment, "editedAt" | "deletedAt">): CommentState {
  if (c.deletedAt !== null) return "deleted"
  return c.editedAt !== null ? "edited" : "current"
}

// A 403 on a comment write whose sentence is the TARGET gate's (echo/index.ts
// gatedTarget / gatedComment): the caller lost the record, not just this one
// action, so the feed is worth reloading. Any other refusal (author-only,
// moderator-only) is shown in place; the list stays.
const TARGET_GATE_MESSAGES = new Set([
  "this entity is not shared with you",
  "no readable route on that cube",
  "no such comment",
])
export const isTargetRefusal = (message: string): boolean =>
  TARGET_GATE_MESSAGES.has(message) || message.endsWith(" does not capture activity")

// The controls to OFFER on one comment, mirroring echo's rules: the author
// edits and deletes their own live comment; a moderator (the caller's
// decision source on the target cube is superadmin or cube-admin, see
// moderatorProbePath) deletes any live comment and edits none. `moderator`
// undefined = not known yet: nothing beyond the author's own controls. The
// server re-decides every request; a 403 here is a fact, not a bug. Note the
// kernel also requires the EDIT decision on the target for an author delete
// (feed.ts commentAuthority): an author who lost edit access is offered
// Delete and receives the server's 403, shown as is.
export function commentActions(
  c: Pick<FeedComment, "actorId" | "deletedAt">,
  meId: string | null,
  moderator: boolean | undefined,
): { edit: boolean; delete: boolean } {
  if (c.deletedAt !== null) return { edit: false, delete: false }
  const own = meId !== null && c.actorId === meId
  return { edit: own, delete: own || moderator === true }
}

// A date for display, or the raw text when it is not a date at all -- the
// feed never crashes on a timestamp it cannot read.
// In the app's locale and time zone (lib/locale.ts), with seconds.
export function formatAt(iso: string): string {
  return formatDateTime(iso, { seconds: true })
}

// Rows of a later page appended after the current ones; a row already shown
// (an added comment the scan reaches again) is not shown twice.
export function appendRows(current: ReadonlyArray<FeedRow>, more: ReadonlyArray<FeedRow>): FeedRow[] {
  const seen = new Set(current.map((r) => r.id))
  return [...current, ...more.filter((r) => !seen.has(r.id))]
}

// The rows after one comment changed (edit or delete): only the row carrying
// that comment id takes the new comment body/flags.
export function withComment(rows: ReadonlyArray<FeedRow>, comment: FeedComment): FeedRow[] {
  return rows.map((r) => (r.commentId === comment.id ? { ...r, comment } : r))
}

// ---------------------------------------------------------------------------
// Calls. Never throw: status 0 = the request never reached the backend.
// ---------------------------------------------------------------------------

async function refusal(response: Response): Promise<{ ok: false; status: number; message: string }> {
  return { ok: false, status: response.status, message: errorMessage(await errorBody(response)) }
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
}

// One feed page. A 200 whose body does not parse is a failure with the
// response status, never an empty feed.
export async function fetchFeed(
  query: FeedQuery,
  doFetch: typeof fetch = apiFetch,
): Promise<EchoResult<FeedPage>> {
  const path = feedPath(query)
  if (!path) return { ok: false, status: 400, message: "invalid feed query" }
  try {
    const response = await doFetch(path)
    if (!response.ok) return refusal(response)
    const page = parseFeedPage(await response.json().catch(() => null))
    if (!page) return { ok: false, status: response.status, message: "invalid feed response" }
    return { ok: true, value: page }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// The kernel's own boundary, applied before the round trip.
function checkBody(body: string): { ok: true; body: string } | { ok: false; status: 400; message: string } {
  const text = body.trim()
  if (text === "") return { ok: false, status: 400, message: "the comment cannot be empty" }
  if (text.length > COMMENT_MAX) {
    return { ok: false, status: 400, message: `the comment cannot exceed ${COMMENT_MAX} characters` }
  }
  return { ok: true, body: text }
}

export async function addComment(opts: {
  cube: string
  entityId: string
  body: string
  doFetch?: typeof fetch
}): Promise<EchoResult<FeedRow>> {
  const path = commentsPath(opts.cube, opts.entityId)
  if (!path) return { ok: false, status: 400, message: "invalid comment target" }
  const checked = checkBody(opts.body)
  if (!checked.ok) return checked
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(path, jsonInit("POST", { body: checked.body }))
    if (!response.ok) return refusal(response)
    const row = parseFeedRow(await response.json().catch(() => null))
    if (!row) return { ok: false, status: response.status, message: "invalid comment response" }
    return { ok: true, value: row }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

export async function editComment(opts: {
  id: string
  body: string
  doFetch?: typeof fetch
}): Promise<EchoResult<FeedComment>> {
  const path = commentPath(opts.id)
  if (!path) return { ok: false, status: 400, message: "invalid comment id" }
  const checked = checkBody(opts.body)
  if (!checked.ok) return checked
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(path, jsonInit("PATCH", { body: checked.body }))
    if (!response.ok) return refusal(response)
    const comment = parseFeedComment(await response.json().catch(() => null))
    if (!comment) return { ok: false, status: response.status, message: "invalid comment response" }
    return { ok: true, value: comment }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

export async function deleteComment(id: string, doFetch: typeof fetch = apiFetch): Promise<EchoResult<FeedComment>> {
  const path = commentPath(id)
  if (!path) return { ok: false, status: 400, message: "invalid comment id" }
  try {
    const response = await doFetch(path, { method: "DELETE" })
    if (!response.ok) return refusal(response)
    const comment = parseFeedComment(await response.json().catch(() => null))
    if (!comment) return { ok: false, status: response.status, message: "invalid comment response" }
    return { ok: true, value: comment }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// The cubes the /echo filter may name. A 200 that does not parse is a
// failure with its status; 403 and network reach the caller as refusals, to
// be shown next to the select (never a silent cut to "All cubes").
export async function fetchActivityCubes(doFetch: typeof fetch = apiFetch): Promise<EchoResult<ActivityCube[]>> {
  try {
    const response = await doFetch(CUBES_PATH)
    if (!response.ok) return refusal(response)
    const cubes = parseActivityCubes(await response.json().catch(() => null))
    if (!cubes) return { ok: false, status: response.status, message: "invalid cube catalogue" }
    return { ok: true, value: cubes }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Whether the caller moderates comments on `cube`: true on 200, false on 403
// (both are answers); any other outcome is a failure, reported as such.
export async function fetchModerator(cube: string, doFetch: typeof fetch = apiFetch): Promise<EchoResult<boolean>> {
  const path = moderatorProbePath(cube)
  if (!path) return { ok: false, status: 400, message: "invalid cube" }
  try {
    const response = await doFetch(path)
    if (response.ok) return { ok: true, value: true }
    if (response.status === 403) return { ok: true, value: false }
    return refusal(response)
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}
