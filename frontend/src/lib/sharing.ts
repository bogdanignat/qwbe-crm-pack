// Typed sharing adapter for the CRM detail page.
//
// Wraps the qwbe `permissions` cube's entity-sharing routes (verified against
// qwbe core/src/cubes/permissions/api.ts and permissions-schemas.ts) so the
// sharing panel never builds a path or payload by hand. All calls go through
// the same-origin proxy (/api/qwbe/...), the same rule as lib/cube.ts.
//
// Authority model (backend-enforced, mirrored here only as copy): only the
// entity owner, a cube admin or a superadmin may list, create or revoke
// grants; a TOTAL grantee may NOT re-share (requireShare ignores the share
// action). No capability (QWB-63) grant is ever issued from here.

import { apiFetch, errorBody, errorMessage } from "./cube.ts"

// The exact action vocabulary qwbe's permissions model publishes
// (core/src/cubes/permissions/permissions-model.ts). TOTAL is this exact SET
// of six, never "an array of length 6".
export const ENTITY_ACTIONS = ["read", "create", "edit", "delete", "share", "transfer"] as const
export type EntityAction = (typeof ENTITY_ACTIONS)[number]
export const TOTAL_ACTIONS: ReadonlyArray<EntityAction> = [...ENTITY_ACTIONS]

export type GrantSubject =
  | { kind: "user"; userId: string }
  | { kind: "group"; groupId: string }

// EntityGrantSchema (core/src/cubes/permissions/permissions-schemas.ts:20-33).
export type EntityGrant = {
  id: string
  cube: string
  entityType: string
  entityId: string
  subject: GrantSubject
  actions: EntityAction[]
  createdBy: string
  createdAt: string
}

// EntityGrantPageSchema (permissions-schemas.ts:136-142): total is required
// here, but the view keeps it optional so a response from an older kernel
// cannot push the panel into silent truncation (see grantsPageView).
export type EntityGrantPage = {
  rows: EntityGrant[]
  total?: number
  offset: number
  limit: number
  sortedBy?: string
}

// Account fields the panel uses; the hash never travels and the picker must
// never render `email` (contract inventory G8).
export type AccountRef = {
  id: string
  username: string
  displayName: string | null
}

export type PermissionGroupRef = {
  id: string
  cube: string
  name: string
  createdBy: string
  createdAt: string
}

export type SharingResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string }

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function oneSegment(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : encodeURIComponent(trimmed)
}

// The entity reference the permissions cube serves. The cube name carries a
// slash and is ONE path parameter, so it travels percent-encoded as one
// segment (the proxy re-encodes each decoded segment for the same reason).
export function grantsRefPath(
  cube: string,
  entityType: string,
  entityId: string,
): string | null {
  const c = oneSegment(cube)
  const t = oneSegment(entityType)
  const e = oneSegment(entityId)
  if (!c || !t || !e) return null
  return `/api/qwbe/permissions/entities/${c}/${t}/${e}`
}

// One grant page with EXPLICIT offset and limit: the panel asks for a page,
// reads `total` from the response and continues by offset -- never a silent
// client-side slice of one big request.
export function grantsPagePath(
  cube: string,
  entityType: string,
  entityId: string,
  offset: number,
  limit: number,
): string | null {
  const ref = grantsRefPath(cube, entityType, entityId)
  if (!ref) return null
  if (!Number.isInteger(offset) || offset < 0) return null
  if (!Number.isInteger(limit) || limit < 1) return null
  return `${ref}/grants?offset=${offset}&limit=${limit}`
}

// Typed text -> the username identity, the ONE place that conversion happens
// (T-1450). The "@" is a display sigil -- the placeholder is "@username" and
// every suggestion renders "@maria" -- but no backend-issued `username` ever
// carries it. Both halves of the picker's contract come through here so they
// cannot disagree: the SEARCH (normalizeDirectoryQuery) and the SUBMIT
// (addGroupMember, userGrantPayload, and the panels' duplicate/self guards).
// Stripping it on one side only is the bug: "@maria" matched Maria in the list
// and then invited "@maria", which is no account at all.
//
// Only a LEADING "@" is a sigil; one inside the text (an email) is left alone.
// No case-folding: both sides of every comparison are backend-issued strings
// and the mutation path compares exactly.
export function normalizeUsername(typed: string): string {
  const text = typed.trim()
  return text.startsWith("@") ? text.slice(1).trim() : text
}

// Typeahead search over the account directory (q scans username,
// displayName, email; the picker renders username + displayName only).
export function userSearchPath(q: string, limit: number): string {
  const params = new URLSearchParams()
  const text = q.trim()
  if (text !== "") params.set("q", text)
  params.set("limit", String(Number.isInteger(limit) && limit > 0 ? limit : 20))
  return `/api/qwbe/account?${params.toString()}`
}

// Batch label resolution for grant rows, by opaque account id
// (`ids=a,b` is a batch, not a page -- same contract as relation-batch).
export function userNamesPath(ids: ReadonlyArray<string>): string | null {
  const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))]
  if (unique.length === 0) return null
  return `/api/qwbe/account?ids=${encodeURIComponent(unique.join(","))}`
}

// The groups of ONE cube, for the group picker and group chip labels.
export function groupsPath(cube: string): string {
  return `/api/qwbe/permissions/groups?cube=${encodeURIComponent(cube.trim())}`
}

// Revoke goes by grant id, one path segment.
export function grantRevokePath(grantId: string): string | null {
  const id = oneSegment(grantId)
  return id ? `/api/qwbe/permissions/grants/${id}` : null
}

// Group members page (kernel slice 2026-09: GET /permissions/groups/{id}/members,
// PageParams offset/limit capped at 200 by the backend). The group id is ONE
// percent-encoded path segment; the page window travels explicitly.
export function groupMembersPath(groupId: string, offset: number, limit: number): string | null {
  const id = oneSegment(groupId)
  if (!id) return null
  if (!Number.isInteger(offset) || offset < 0) return null
  if (!Number.isInteger(limit) || limit < 1) return null
  return `/api/qwbe/permissions/groups/${id}/members?offset=${offset}&limit=${limit}`
}

export function groupCreatePath(): string {
  return "/api/qwbe/permissions/groups"
}

export function groupRenamePath(groupId: string): string | null {
  const id = oneSegment(groupId)
  return id ? `/api/qwbe/permissions/groups/${id}` : null
}

export function groupMembersAddPath(groupId: string): string | null {
  const id = oneSegment(groupId)
  return id ? `/api/qwbe/permissions/groups/${id}/members` : null
}

export function groupMembersRemovePath(groupId: string): string | null {
  const id = oneSegment(groupId)
  return id ? `/api/qwbe/permissions/groups/${id}/members/remove` : null
}

// ---------------------------------------------------------------------------
// Payloads: EXPLICIT, nonempty actions on every create
// ---------------------------------------------------------------------------

// True only for the exact six-action set. A six-element array with a
// duplicate and a missing action is NOT total.
export function isTotalActions(actions: ReadonlyArray<string>): actions is ReadonlyArray<EntityAction> {
  if (actions.length !== ENTITY_ACTIONS.length) return false
  return new Set(actions).size === ENTITY_ACTIONS.length &&
    actions.every((a) => (ENTITY_ACTIONS as readonly string[]).includes(a))
}

export type GrantPayloadError = "subject" | "actions"

type PayloadOutcome =
  | { payload: { actions: EntityAction[]; [k: string]: string | EntityAction[] } }
  | { error: GrantPayloadError }

function normalizeActions(raw: ReadonlyArray<string>): PayloadOutcome {
  // Deduplicate while keeping the caller's order; every element must be a
  // published action.
  const seen = new Set<string>()
  const actions: EntityAction[] = []
  for (const a of raw) {
    if (!(ENTITY_ACTIONS as readonly string[]).includes(a)) return { error: "actions" }
    if (!seen.has(a)) {
      seen.add(a)
      actions.push(a as EntityAction)
    }
  }
  // Explicit and nonempty: the backend would default user grants to TOTAL
  // when `actions` is omitted, and this adapter never relies on a silent
  // default (G3: group grants have no default at all).
  if (actions.length === 0) return { error: "actions" }
  // A custom set never carries `share` (G6): requireShare ignores the share
  // action, so a "share" checkbox would lie. Only the exact TOTAL set
  // includes it.
  if (!isTotalActions(actions) && seen.has("share")) return { error: "actions" }
  return { payload: { actions } }
}

// Share with one user by username. Returns qwbe's payload shape
// (UserGrantCreate) with an EXPLICIT actions array.
export function userGrantPayload(
  username: string,
  actions: ReadonlyArray<string>,
): PayloadOutcome {
  const name = normalizeUsername(username)
  if (name === "") return { error: "subject" }
  const outcome = normalizeActions(actions)
  if ("error" in outcome) return outcome
  return { payload: { username: name, actions: outcome.payload.actions } }
}

// Share with one group. The backend REQUIRES actions here (no default, G3).
export function groupGrantPayload(
  groupId: string,
  actions: ReadonlyArray<string>,
): PayloadOutcome {
  const id = groupId.trim()
  if (id === "") return { error: "subject" }
  const outcome = normalizeActions(actions)
  if ("error" in outcome) return outcome
  return { payload: { groupId: id, actions: outcome.payload.actions } }
}

// Chip label for a grant's action list: the literal "TOTAL" for the exact six
// (never colour, never a length check), else the action names joined.
export function grantActionsLabel(actions: ReadonlyArray<string>): string {
  return isTotalActions(actions) ? "TOTAL" : actions.join(", ")
}

// The three levels the form offers. "custom" never carries `share` (G6) and
// is offered in the published action order, so the confirmation line and the
// payload list the same set in the same order.
export type ShareLevel = "total" | "read" | "custom"
export const CUSTOM_ACTIONS: ReadonlyArray<EntityAction> = ENTITY_ACTIONS.filter((a) => a !== "share")

export function actionsForLevel(level: ShareLevel, custom: ReadonlyArray<string>): EntityAction[] {
  if (level === "total") return [...TOTAL_ACTIONS]
  if (level === "read") return ["read"]
  return CUSTOM_ACTIONS.filter((a) => custom.includes(a))
}

// ---------------------------------------------------------------------------
// Grant page: explicit offset + total, no silent truncation
// ---------------------------------------------------------------------------

export type GrantsPageView = {
  rows: EntityGrant[]
  total: number | undefined
  offset: number
  limit: number
  // true = another page exists (total known and not reached);
  // false = this page is the last;
  // null = the response carried no total: the ONLY safe continuation is
  // probing the next offset, and the UI must say "more?" instead of counting.
  hasMore: boolean | null
}

export function grantsPageView(page: EntityGrantPage): GrantsPageView {
  const nextOffset = page.offset + page.rows.length
  return {
    rows: page.rows,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.total === undefined ? (page.rows.length > 0 ? null : false) : nextOffset < page.total,
  }
}

// ---------------------------------------------------------------------------
// Chips: one per grant row, opaque-id fallback
// ---------------------------------------------------------------------------

export type GrantChip = {
  grantId: string
  kind: "user" | "group"
  // The raw subject id (opaque account id or group id) -- always present so a
  // chip survives an unresolved name.
  subjectId: string
  label: string
  actions: string
  total: boolean
}

// One chip per grant row, in response order. Duplicate rows for the same
// subject stay as separate, separately revokable chips (the backend does not
// deduplicate grants). Names come from the resolved lookups; an id with no
// resolved name falls back to the raw id -- never to an empty chip.
export function chipsOf(
  rows: ReadonlyArray<EntityGrant>,
  userNames: Readonly<Record<string, string>>,
  groupNames: Readonly<Record<string, string>>,
): GrantChip[] {
  return rows.map((row) => {
    const subject = row.subject
    const isUser = subject.kind === "user"
    const subjectId = isUser ? subject.userId : (subject as { groupId: string }).groupId
    const names = isUser ? userNames : groupNames
    return {
      grantId: row.id,
      kind: row.subject.kind,
      subjectId,
      label: names[subjectId] ?? subjectId,
      actions: grantActionsLabel(row.actions),
      total: isTotalActions(row.actions),
    }
  })
}

// ---------------------------------------------------------------------------
// Groups admin adapter (Settings > Users and Groups)
// ---------------------------------------------------------------------------

// GroupMembershipSchema (permissions-schemas.ts:13-19). Members are addressed
// by `username` on write, but carry an opaque `userId` here: labels resolve
// through lookupAccounts (one batch per page), falling back to the raw id.
export type GroupMembership = {
  id: string
  groupId: string
  userId: string
  createdBy: string
  createdAt: string
}

// PageOf(GroupMembershipSchema). This endpoint is NEW with the members kernel
// slice, so `total` is REQUIRED: a response without it is invalid and
// fetchGroupMembersPage fails visibly instead of guessing.
export type GroupMembershipPage = {
  rows: GroupMembership[]
  total: number
  offset: number
  limit: number
}

// Boundary check of the members page shape; the UI never renders a page that
// did not pass it (an unknown shape must never look like "no members").
export function parseMembersPage(raw: unknown): GroupMembershipPage | null {
  if (typeof raw !== "object" || raw === null) return null
  const page = raw as Record<string, unknown>
  const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0
  if (!Array.isArray(page.rows) || !count(page.total) || !count(page.offset) || !count(page.limit)) return null
  const rows: GroupMembership[] = []
  for (const row of page.rows as unknown[]) {
    if (typeof row !== "object" || row === null) return null
    const m = row as Record<string, unknown>
    if (typeof m.id !== "string" || typeof m.groupId !== "string" || typeof m.userId !== "string") return null
    rows.push({
      id: m.id,
      groupId: m.groupId,
      userId: m.userId,
      createdBy: typeof m.createdBy === "string" ? m.createdBy : "",
      createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
    })
  }
  return { rows, total: page.total as number, offset: page.offset as number, limit: page.limit as number }
}

// One row of the members list. `username` is null when the account lookup
// did not return it: the row then shows the opaque id and a remove MUST ask
// for an explicit username, because the id can never be sent as a username.
// `displayName` is null when the account carries none -- an account without a
// display name is NOT an unresolved account.
export type MemberRow = {
  membershipId: string
  userId: string
  username: string | null
  displayName: string | null
}

// The whole page resolves through ONE batch lookup (`?ids=a,b`), so this maps
// an already-fetched account map: no request per row.
export function memberRowsOf(
  rows: ReadonlyArray<GroupMembership>,
  accounts: Readonly<Record<string, AccountRef>>,
): MemberRow[] {
  return rows.map((row) => {
    const account = accounts[row.userId]
    return {
      membershipId: row.id,
      userId: row.userId,
      username: account?.username ?? null,
      displayName: account?.displayName ?? null,
    }
  })
}

// What a member row shows: the display name leads when the directory returned
// one, with the @username beside it; an account the lookup did not resolve
// falls back to the opaque id and says so (`unresolved`), never to an empty
// row and never to a guessed name.
export type MemberLabel = {
  primary: string
  secondary: string | null
  unresolved: boolean
  // The name of a CONTROL (aria-label of Remove / Confirm / Cancel). Always
  // the handle -- `@username`, or the opaque id when the lookup failed -- and
  // never the display name: the display name is directory data that can change
  // under the operator, and a control whose accessible name moves with it
  // cannot be addressed twice by the same words, by an assistive technology, a
  // keyboard user or a test. `primary`/`secondary` carry the display name to
  // the eye; only this names the button.
  control: string
}

export function memberLabelOf(row: MemberRow): MemberLabel {
  if (row.username === null) {
    return { primary: row.userId, secondary: null, unresolved: true, control: row.userId }
  }
  const handle = `@${row.username}`
  return row.displayName === null
    ? { primary: handle, secondary: null, unresolved: false, control: handle }
    : { primary: row.displayName, secondary: handle, unresolved: false, control: handle }
}

// true = another page exists; empty rows with total 0 is the only "no
// members" signal (the caller already knows the page is valid).
export function membersHasMore(page: GroupMembershipPage): boolean {
  return page.offset + page.rows.length < page.total
}

// What the picker can mark "Already in group", and how far that marking
// reaches.
//
// `marked` is the number of accounts actually EXCLUDED, not the number of rows
// on the page: a row whose username the directory did not resolve cannot be
// compared against a typed username, so it is a member the picker cannot mark.
// Counting rows instead would claim coverage for it and, when the page holds
// every member, hide the gap notice entirely -- the operator would read an
// unmarked existing member as "not a member yet".
//
// `incomplete` therefore compares the MARKS against the group's own total, so
// it is true both for a member on another page and for a loaded member with an
// unresolved username.
export type MemberMarks = {
  excluded: ReadonlyArray<{ username: string; reason: string }>
  marked: number
  incomplete: boolean
}

export function memberMarks(
  rows: ReadonlyArray<MemberRow>,
  total: number,
  reason: string,
): MemberMarks {
  const excluded = rows.flatMap((row) => (row.username === null ? [] : [{ username: row.username, reason }]))
  return { excluded, marked: excluded.length, incomplete: excluded.length < total }
}

// The selection to keep after a group list has been re-read: the same group,
// or NOTHING. A group the fresh list no longer carries was deleted, renamed
// out of this scope, or refused to this caller between two reads -- keeping it
// selected would point every later request, and every open dialog, at a group
// of a list that no longer exists. Returning "" is what makes the panel drop
// the section instead.
export function retainSelectedGroup(groups: ReadonlyArray<PermissionGroupRef>, selected: string): string {
  return groups.some((group) => group.id === selected) ? selected : ""
}

// A refused write to the GROUP ITSELF -- create or rename, and nothing else --
// said in words the operator can act on, chosen by the STATUS. The kernel's
// message text is not a contract, so it is only used when the status carries no
// meaning of its own (the same rule lib/contact-groups.ts writeRefusalMessage
// follows).
//
// Membership writes must NOT come through here: on those routes the same
// statuses mean different things (a 404 is usually the USERNAME, not the group;
// a 400 is this adapter refusing an empty user or an unusable group id), so
// they have their own mapper below. Mapping them here produced "This group no
// longer exists." for `username bob does not exist` and "A group name is
// required." for "choose a user".
//
// 409 is the reason this exists: group names are unique per cube and the
// database decides, normalizing case and surrounding spaces, so "already
// taken" must be stated as the normalization actually works -- otherwise the
// operator retypes the same name with different capitals and is refused again.
export function groupWriteRefusalMessage(status: number, serverMessage: string): string {
  switch (status) {
    case 400:
      return "A group name is required."
    case 403:
      return "You may not administer the groups of this scope."
    case 404:
      return "This group no longer exists."
    case 409:
      return "Another group of this scope already uses this name (names ignore case and surrounding spaces)."
    default:
      return serverMessage
  }
}

// A refused MEMBERSHIP write (add member, remove member). Only the two statuses
// whose meaning is fixed on these routes are worded here; everything else keeps
// the message that was actually produced, because on these routes it is the only
// thing that says WHICH of several things went wrong:
//
//   400 - this adapter refused before sending (no user picked, unusable group
//         id). The adapter's own sentence already names the cause.
//   403 - requireCubeAccess: the caller may not administer this scope's groups
//         (qwbe core/src/cubes/permissions/groups.ts). Status-fixed.
//   404 - THREE different causes share this status: the username does not
//         resolve to an account (`username X does not exist`, handler-utils.ts
//         resolveIdentity), the group is gone (`group X does not exist`), or the
//         membership is gone (`membership does not exist`). Only the message
//         distinguishes them, so it travels verbatim -- inventing one of the
//         three would send the operator after the wrong problem.
//   409 - not produced: adding an existing member returns that membership
//         unchanged (groups.ts addGroupMember is idempotent).
export function memberWriteRefusalMessage(status: number, serverMessage: string): string {
  if (status === 403) return "You may not administer the members of this scope's groups."
  return serverMessage
}

// The admin calls validate at the boundary and keep qwbe's own message on
// refusal. status 0 = the request never reached the backend (network, proxy
// down): NOT a refusal, and for a member list NOT an empty group.

function jsonInit(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }
}

// The full group rows of one cube. `status: 403` = the backend refused
// (requireCubeAccess: neither entity owner, nor cube admin, nor superadmin)
// -- the UI hides the admin panel; status 0 = network. Never throws.
export async function fetchGroups(
  cube: string,
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<PermissionGroupRef[]>> {
  const name = cube.trim()
  if (name === "") return { ok: false, status: 400, message: "choose a cube" }
  try {
    const response = await doFetch(groupsPath(name))
    if (!response.ok) return refusal(response)
    return { ok: true, value: (await response.json()) as PermissionGroupRef[] }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Create a group in one cube. The name is trimmed and must be nonempty.
//
// Nonempty is the ONLY thing this client can decide. The name must also be
// unique within the cube, and the DATABASE is what says so: qwbe keeps a
// partial unique index over (cube, name) normalized as `lower(btrim(name))`
// (core/src/cubes/permissions/groups.ts `permission_groups_cube_name_key`,
// groups-unique.test.ts), which is not what `.trim()` compares. A 409 can
// therefore arrive for a name that looks free here -- " Sales" against
// "sales", or another operator winning the race -- and 409 is a NORMAL answer
// for both create and rename, never a defect. See groupWriteRefusalMessage.
export async function createGroup(opts: {
  cube: string
  name: string
  doFetch?: typeof fetch
}): Promise<SharingResult<PermissionGroupRef>> {
  const cube = opts.cube.trim()
  const name = opts.name.trim()
  if (cube === "") return { ok: false, status: 400, message: "choose a cube" }
  if (name === "") return { ok: false, status: 400, message: "the group name cannot be empty" }
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(groupCreatePath(), jsonInit({ cube, name }))
    if (!response.ok) return refusal(response)
    return { ok: true, value: (await response.json()) as PermissionGroupRef }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Rename by group id (PATCH). Same nonempty-name rule, and the same unique
// index: a rename onto a name another group of the cube already holds answers
// 409 and changes nothing (no row touched, no audit row written).
export async function renameGroup(opts: {
  groupId: string
  name: string
  doFetch?: typeof fetch
}): Promise<SharingResult<PermissionGroupRef>> {
  const name = opts.name.trim()
  if (name === "") return { ok: false, status: 400, message: "the group name cannot be empty" }
  const path = groupRenamePath(opts.groupId)
  if (!path) return { ok: false, status: 400, message: "invalid group id" }
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) return refusal(response)
    return { ok: true, value: (await response.json()) as PermissionGroupRef }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// One members page with EXPLICIT offset and limit; total comes back so the
// UI knows whether the list is truly empty or a refusal/network gap. Never
// throws: status 0 marks a network failure; a 200 with an invalid body is
// reported as a failure with the response status, never as an empty page.
export async function fetchGroupMembersPage(opts: {
  groupId: string
  offset: number
  limit: number
  doFetch?: typeof fetch
}): Promise<SharingResult<GroupMembershipPage>> {
  const path = groupMembersPath(opts.groupId, opts.offset, opts.limit)
  if (!path) return { ok: false, status: 400, message: "invalid group id or page window" }
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(path)
    if (!response.ok) return refusal(response)
    const page = parseMembersPage(await response.json().catch(() => null))
    if (!page) return { ok: false, status: response.status, message: "invalid members page response" }
    return { ok: true, value: page }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Add one member by username. Idempotent on the backend (an existing
// membership is returned as is).
export async function addGroupMember(opts: {
  groupId: string
  username: string
  doFetch?: typeof fetch
}): Promise<SharingResult<GroupMembership>> {
  const username = normalizeUsername(opts.username)
  if (username === "") return { ok: false, status: 400, message: "choose a user" }
  const path = groupMembersAddPath(opts.groupId)
  if (!path) return { ok: false, status: 400, message: "invalid group id" }
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(path, jsonInit({ username }))
    if (!response.ok) return refusal(response)
    return { ok: true, value: (await response.json()) as GroupMembership }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Remove one member by username. The backend answers 404 for a membership
// that does not exist; qwbe's message travels verbatim.
export async function removeGroupMember(opts: {
  groupId: string
  username: string
  doFetch?: typeof fetch
}): Promise<SharingResult<{ removed: string }>> {
  const username = normalizeUsername(opts.username)
  if (username === "") return { ok: false, status: 400, message: "choose a user" }
  const path = groupMembersRemovePath(opts.groupId)
  if (!path) return { ok: false, status: 400, message: "invalid group id" }
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(path, jsonInit({ username }))
    if (!response.ok) return refusal(response)
    return { ok: true, value: (await response.json()) as { removed: string } }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Remove the member whose account id the operator clicked. The remove route
// takes a USERNAME, so the id is resolved fresh through the directory right
// before the request; an id the directory cannot resolve now is refused
// without any request, and a username typed by the operator is never used
// as the target. The kernel answers with the id it actually removed; a
// mismatch is reported as a failure, never as success.
export async function removeGroupMemberById(opts: {
  groupId: string
  userId: string
  doFetch?: typeof fetch
}): Promise<SharingResult<{ removed: string; username: string }>> {
  const doFetch = opts.doFetch ?? apiFetch
  const username = (await lookupUserNames([opts.userId], doFetch))[opts.userId]
  if (!username) return { ok: false, status: 0, message: "cannot resolve this account right now, try again" }
  const result = await removeGroupMember({ groupId: opts.groupId, username, doFetch })
  if (!result.ok) return result
  if (result.value.removed !== opts.userId) {
    return {
      ok: false,
      status: 500,
      message: `removed account ${result.value.removed} instead of ${opts.userId}; the member list was refreshed`,
    }
  }
  return { ok: true, value: { removed: result.value.removed, username } }
}

// ---------------------------------------------------------------------------
// Calls: every refusal keeps qwbe's own message
// ---------------------------------------------------------------------------

async function refusal(response: Response): Promise<{ ok: false; status: number; message: string }> {
  return {
    ok: false,
    status: response.status,
    message: errorMessage(await errorBody(response)),
  }
}

// One grant page. offset/limit travel explicitly; the caller decides whether
// to continue.
export async function fetchGrantPage(opts: {
  cube: string
  entityType: string
  entityId: string
  offset: number
  limit: number
  doFetch?: typeof fetch
}): Promise<SharingResult<EntityGrantPage>> {
  const path = grantsPagePath(opts.cube, opts.entityType, opts.entityId, opts.offset, opts.limit)
  const doFetch = opts.doFetch ?? apiFetch
  if (!path) return { ok: false, status: 400, message: "invalid entity reference or page window" }
  const response = await doFetch(path)
  if (!response.ok) return refusal(response)
  return { ok: true, value: (await response.json()) as EntityGrantPage }
}

// One parsed account page. `rows` are the accounts this adapter could read;
// `returned` is how many rows the BACKEND put in the page, before any were
// dropped.
//
// The two are kept apart on purpose: "did the backend cap this page?" is a
// question about `returned`, and answering it with `rows.length` turns every
// dropped malformed row into a false "you are seeing everything".
export type AccountPage = {
  rows: AccountRef[]
  returned: number
}

// Boundary parse of an account page. A row without a usable id+username is
// dropped (never rendered as a half account); `email` is read by nobody here
// (contract inventory G8).
export function parseAccountPage(raw: unknown): AccountPage {
  if (typeof raw !== "object" || raw === null) return { rows: [], returned: 0 }
  const rows = (raw as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return { rows: [], returned: 0 }
  const parsed = (rows as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const row = entry as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id : ""
    const username = typeof row.username === "string" ? row.username : ""
    if (id === "" || username === "") return []
    return [{
      id,
      username,
      displayName: typeof row.displayName === "string" && row.displayName !== "" ? row.displayName : null,
    }]
  })
  return { rows: parsed, returned: rows.length }
}

// Directory search for the user picker, with the refusal kept apart from a
// transport failure: `status: 403` = the directory refused account:read (the
// picker says so and keeps the typed username as the identity), `status: 0` =
// the request never reached the backend (offer a retry). An empty `rows` is a
// real "no account matches", never a refusal. No enumeration escalation: the
// query and the limit travel exactly as the caller asked.
export async function searchAccounts(opts: {
  q: string
  limit: number
  doFetch?: typeof fetch
}): Promise<SharingResult<AccountPage>> {
  const doFetch = opts.doFetch ?? apiFetch
  try {
    const response = await doFetch(userSearchPath(opts.q, opts.limit))
    if (!response.ok) return refusal(response)
    const body: unknown = await response.json().catch(() => null)
    // A 200 with a body this adapter cannot read is a failure, never an empty
    // directory: "no matches" must be the backend's answer, not a parse gap.
    if (typeof body !== "object" || body === null || !Array.isArray((body as { rows?: unknown }).rows)) {
      return { ok: false, status: response.status, message: "invalid account search response" }
    }
    return { ok: true, value: parseAccountPage(body) }
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
}

// Batch account resolution by opaque id. A row the response did not return
// (deleted account) is simply absent, so the caller falls back to the raw id.
export async function lookupAccounts(
  ids: ReadonlyArray<string>,
  doFetch: typeof fetch = apiFetch,
): Promise<Record<string, AccountRef>> {
  const path = userNamesPath(ids)
  if (!path) return {}
  try {
    const response = await doFetch(path)
    if (!response.ok) return {}
    const accounts: Record<string, AccountRef> = {}
    for (const row of parseAccountPage(await response.json().catch(() => null)).rows) {
      accounts[row.id] = row
    }
    return accounts
  } catch {
    return {}
  }
}

// Batch label resolution for user chips (username only).
export async function lookupUserNames(
  ids: ReadonlyArray<string>,
  doFetch: typeof fetch = apiFetch,
): Promise<Record<string, string>> {
  const accounts = await lookupAccounts(ids, doFetch)
  const names: Record<string, string> = {}
  for (const [id, account] of Object.entries(accounts)) names[id] = account.username
  return names
}

// The groups of one cube. `null` means the backend refused -- 403 for a user
// who is neither an entity owner nor a cube admin nor a superadmin
// (requireCubeAccess): the panel hides the group form and keeps the user
// form. Any other failure degrades the same way; it never throws.
export async function lookupGroups(
  cube: string,
  doFetch: typeof fetch = apiFetch,
): Promise<Record<string, string> | null> {
  try {
    const response = await doFetch(groupsPath(cube))
    if (!response.ok) return null
    const rows = (await response.json()) as PermissionGroupRef[]
    const names: Record<string, string> = {}
    for (const group of rows) names[group.id] = group.name
    return names
  } catch {
    return null
  }
}

// Share with a user. The payload is built by userGrantPayload -- an EXPLICIT,
// nonempty action set, never a silent backend default.
export async function createUserGrant(opts: {
  cube: string
  entityType: string
  entityId: string
  username: string
  actions: ReadonlyArray<string>
  doFetch?: typeof fetch
}): Promise<SharingResult<EntityGrant>> {
  const outcome = userGrantPayload(opts.username, opts.actions)
  if ("error" in outcome) {
    return { ok: false, status: 400, message: "choose a user and at least one action" }
  }
  const ref = grantsRefPath(opts.cube, opts.entityType, opts.entityId)
  if (!ref) return { ok: false, status: 400, message: "invalid entity reference" }
  const doFetch = opts.doFetch ?? apiFetch
  const response = await doFetch(`${ref}/grants/user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(outcome.payload),
  })
  if (!response.ok) return refusal(response)
  return { ok: true, value: (await response.json()) as EntityGrant }
}

// Share with a group. Actions are REQUIRED (no backend default, G3).
export async function createGroupGrant(opts: {
  cube: string
  entityType: string
  entityId: string
  groupId: string
  actions: ReadonlyArray<string>
  doFetch?: typeof fetch
}): Promise<SharingResult<EntityGrant>> {
  const outcome = groupGrantPayload(opts.groupId, opts.actions)
  if ("error" in outcome) {
    return { ok: false, status: 400, message: "choose a group and at least one action" }
  }
  const ref = grantsRefPath(opts.cube, opts.entityType, opts.entityId)
  if (!ref) return { ok: false, status: 400, message: "invalid entity reference" }
  const doFetch = opts.doFetch ?? apiFetch
  const response = await doFetch(`${ref}/grants/group`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(outcome.payload),
  })
  if (!response.ok) return refusal(response)
  return { ok: true, value: (await response.json()) as EntityGrant }
}

// Revoke by grant id (the backend answers 404 for a missing or soft-deleted
// grant; qwbe's message travels verbatim).
export async function revokeGrant(
  grantId: string,
  doFetch: typeof fetch = apiFetch,
): Promise<SharingResult<{ revoked: string }>> {
  const path = grantRevokePath(grantId)
  if (!path) return { ok: false, status: 400, message: "invalid grant id" }
  const response = await doFetch(path, { method: "DELETE" })
  if (!response.ok) return refusal(response)
  return { ok: true, value: (await response.json()) as { revoked: string } }
}
