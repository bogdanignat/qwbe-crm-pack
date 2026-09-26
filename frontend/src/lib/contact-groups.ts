// Typed adapter for the crm/contact-groups cube (T-1451).
//
// BUSINESS contact groups: sets of `crm/contacts` rows. They are NOT the
// kernel's ACCESS groups at /permissions/groups, which group user ACCOUNTS for
// authorization (lib/sharing.ts owns those, and nothing here touches them).
// Adding a contact to a group grants nobody anything: a membership row is a
// business fact about a person the business deals with, never an access grant.
//
// Contract: /tmp/crm-contact-groups-api.md (frozen). Every path and payload in
// this file mirrors it; no component builds either by hand. All calls go
// through the same-origin proxy (/api/qwbe/...), the rule lib/cube.ts sets.
//
// Framework-free on purpose (no React import): the hooks bind it to
// components, and this file is testable with `node --test` alone.

import { apiFetch, errorBody, errorMessage } from "./cube.ts"

// ContactGroup DTO. `normalizedName` is derived and read-only -- it is never
// accepted in a payload, so nothing here ever sends it.
export type ContactGroup = {
  id: string
  type: "ContactGroup"
  createdAt: string
  deleted: boolean
  // The display name EXACTLY as submitted: casing and spacing preserved. No
  // surface in this app rewrites it.
  name: string
  normalizedName: string
}

// ContactGroupMember DTO. It carries `contactId` ONLY -- no name, no email,
// no company: the group cube never proxies contact data. The identity is
// resolved through the contacts cube's own list (lib/contact-directory.ts).
export type ContactGroupMember = {
  id: string
  type: "ContactGroupMember"
  createdAt: string
  deleted: boolean
  groupId: string
  contactId: string
}

// The kernel's page envelope. `total` stays optional so a response from a
// kernel that omits it cannot push a list into silent truncation: the caller
// then proves the end with a short page instead.
export type ContactGroupPage<T> = {
  rows: T[]
  total?: number
  offset: number
  limit: number
  sortedBy?: string
}

export type GroupsResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string }

// The page size every list here asks for. Small enough that one `ids=` batch
// resolves a member page in a single contacts request (see the members hook).
export const GROUPS_PAGE_SIZE = 25
export const MEMBERS_PAGE_SIZE = 25

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const BASE = "/api/qwbe/contact-groups"

// An id is ONE path segment, so it travels percent-encoded. Empty (which would
// resolve to the LIST endpoint) and the traversal spellings the proxy refuses
// are not ids at all: the caller gets null and never sends a request.
export function groupSegment(id: string): string | null {
  const trimmed = id.trim()
  if (trimmed === "" || trimmed === "." || trimmed === "..") return null
  return encodeURIComponent(trimmed)
}

export type GroupListQuery = {
  page?: number
  pageSize?: number
  // Prefix search on `name`, the only search the cube declares.
  q?: string
  // `sort=name:desc` -- the cube sorts by `name` and `createdAt` only, and
  // reports what it actually used in `sortedBy`.
  sort?: string
}

export function contactGroupsPath(query: GroupListQuery = {}): string {
  const q = new URLSearchParams()
  if (query.page !== undefined) q.set("page", String(query.page))
  if (query.pageSize !== undefined) q.set("pageSize", String(query.pageSize))
  if (query.q !== undefined && query.q.trim() !== "") q.set("q", query.q.trim())
  if (query.sort !== undefined && query.sort !== "") q.set("sort", query.sort)
  const qs = q.toString()
  return qs === "" ? BASE : `${BASE}?${qs}`
}

export function contactGroupPath(id: string): string | null {
  const segment = groupSegment(id)
  return segment === null ? null : `${BASE}/${segment}`
}

export function groupMembersPath(id: string, page: number, pageSize: number): string | null {
  const segment = groupSegment(id)
  if (segment === null) return null
  if (!Number.isInteger(page) || page < 1) return null
  if (!Number.isInteger(pageSize) || pageSize < 1) return null
  return `${BASE}/${segment}/members?page=${page}&pageSize=${pageSize}`
}

export function addMemberPath(id: string): string | null {
  const segment = groupSegment(id)
  return segment === null ? null : `${BASE}/${segment}/members`
}

// A POST with the id in the BODY, not DELETE .../members/:contactId: the
// kernel's entity mediation refuses an endpoint with two path parameters, and
// its own permissions cube uses the same shape.
export function removeMemberPath(id: string): string | null {
  const segment = groupSegment(id)
  return segment === null ? null : `${BASE}/${segment}/members/remove`
}

// ---------------------------------------------------------------------------
// Names: what the UI may decide, and what only the server decides
// ---------------------------------------------------------------------------

// The ONE thing this UI refuses on its own: a blank name is a 400 by contract,
// so the submit button is disabled on it rather than spending a round trip.
export function isBlankName(name: string): boolean {
  return name.trim() === ""
}

// The cube's uniqueness key: lower(btrim(name)). Mirrored so the form can WARN
// before submitting; it never REFUSES on it. The database is the arbiter and
// another user may win the race, so a 409 is expected anyway and handled.
export function normalizedGroupName(name: string): string {
  return name.trim().toLowerCase()
}

// "A group with this name already exists" -- said about the groups this page
// happens to hold, which is a page, not the cube. Hence a warning, never a
// block. `self` is the group being renamed: re-spelling a group's OWN name
// (Ada -> ADA, Ada -> " Ada ") is allowed by the cube and returns 200, so it
// must not be warned about either.
export function duplicateNameWarning(
  name: string,
  known: ReadonlyArray<ContactGroup>,
  self?: string,
): string | null {
  if (isBlankName(name)) return null
  const key = normalizedGroupName(name)
  const clash = known.find((g) => g.id !== self && normalizedGroupName(g.name) === key)
  return clash === undefined
    ? null
    : `"${clash.name}" already uses this name (names ignore case and spacing).`
}

// The message a refused write carries. The STATUS decides what is said -- the
// kernel's message text is explicitly not a contract -- except for the states
// where the server's own sentence is more specific than anything written here.
export function writeRefusalMessage(status: number, serverMessage: string): string {
  switch (status) {
    case 400:
      return "A name is required."
    case 403:
      return "You do not have the permissions needed to change contact groups."
    case 404:
      return "This contact group no longer exists."
    case 409:
      return "Another group already uses this name (names ignore case and spacing)."
    default:
      return serverMessage
  }
}

// A refused MEMBERSHIP write. Kept apart from the name writes because 403 here
// has two possible causes -- the group's write permission, or `crm/contacts:read`
// (contract, Auth) -- and this UI cannot tell them apart. It therefore names the
// CAPABILITY that is missing, never a role, and never a diagnosis it did not make.
export function membershipRefusalMessage(
  action: "add" | "remove",
  status: number,
  serverMessage: string,
): string {
  switch (status) {
    case 400:
      return action === "add"
        ? "Choose a contact from the search results first."
        : "This contact cannot be removed without an id."
    case 403:
      return action === "add"
        ? "You do not have the permissions needed to add contacts to this group."
        : "You do not have the permissions needed to remove contacts from this group."
    case 404:
      return action === "add"
        ? "This contact group no longer exists."
        : "This contact is no longer a member of this group."
    default:
      return serverMessage
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function request<T>(
  path: string | null,
  init: RequestInit | undefined,
  doFetch: typeof fetch,
): Promise<GroupsResult<T>> {
  if (path === null) {
    // A caller handed in something that cannot name a row. No request is sent;
    // the shape of a 404 is the honest answer -- there is nothing there.
    return { ok: false, status: 404, message: "unknown contact group" }
  }
  let response: Response
  try {
    response = await doFetch(path, init)
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: errorMessage(await errorBody(response)),
    }
  }
  try {
    return { ok: true, value: (await response.json()) as T }
  } catch {
    return { ok: false, status: response.status, message: "unreadable response" }
  }
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

export function fetchContactGroups(
  query: GroupListQuery = {},
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<ContactGroupPage<ContactGroup>>> {
  return request(contactGroupsPath(query), undefined, doFetch)
}

export function fetchContactGroup(
  id: string,
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<ContactGroup>> {
  return request(contactGroupPath(id), undefined, doFetch)
}

// The name travels EXACTLY as typed: the cube preserves casing and spacing and
// this app never rewrites what the operator wrote. Only the blank check is
// local; uniqueness is the server's call (409).
export function createContactGroup(
  name: string,
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<ContactGroup>> {
  return request(BASE, jsonPost({ name }), doFetch)
}

export function renameContactGroup(
  id: string,
  name: string,
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<ContactGroup>> {
  const path = contactGroupPath(id)
  return request(
    path,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
    doFetch,
  )
}

export function fetchGroupMembers(
  id: string,
  page: number,
  pageSize: number = MEMBERS_PAGE_SIZE,
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<ContactGroupPage<ContactGroupMember>>> {
  return request(groupMembersPath(id, page, pageSize), undefined, doFetch)
}

// Adding is IDEMPOTENT by contract: an already-active member comes back as the
// EXISTING row with status 200, never a 409. So this never reports a duplicate.
//
// `contactId` is validated for SHAPE only on the backend today (contract, known
// limit 1): an id that names nothing is accepted and stored. The UI's half of
// that bargain is that only ids RETURNED BY A CONTACT SEARCH are ever sent --
// no free-text id field exists in this feature, and the member list reports a
// row it cannot resolve instead of pretending it names someone.
export function addGroupMember(
  id: string,
  contactId: string,
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<ContactGroupMember>> {
  return request(addMemberPath(id), jsonPost({ contactId }), doFetch)
}

// 404 here means either the group is gone OR that contact is not an active
// member of it -- the caller reloads the page rather than guessing which.
export function removeGroupMember(
  id: string,
  contactId: string,
  doFetch: typeof fetch = apiFetch,
): Promise<GroupsResult<{ removed: string }>> {
  return request(removeMemberPath(id), jsonPost({ contactId }), doFetch)
}

// ---------------------------------------------------------------------------
// Page views
// ---------------------------------------------------------------------------

// Where a reader is in a list, and whether there is a next page. Without a
// `total` from the cube, a FULL page is the only evidence that more may exist
// (the same rule the generic list follows).
export type PageView = {
  from: number
  to: number
  total: number | undefined
  hasPrevious: boolean
  hasNext: boolean
  lastPage: number | undefined
}

// The page a reader may actually stand on, decided by what the SERVER just
// returned. Two ways a requested page stops being valid between a click and an
// answer -- the last member of the last page is removed, or a link/history
// entry names a page that never existed:
//
//   with a total   the last page is ceil(total / pageSize), so anything beyond
//                  it is corrected to it (total 0 -> page 1);
//   without one    an EMPTY page beyond the first is the only evidence there is
//                  (the cube may omit `total`), so the reader steps back ONE
//                  page and the next answer is judged the same way. This walks
//                  back rather than jumping, because without a total nothing
//                  here knows where the list ends.
//
// A full or partial non-empty page is always valid: it is being looked at.
export function clampedPage<T>(
  requested: number,
  page: ContactGroupPage<T>,
  pageSize: number,
): number {
  if (!Number.isInteger(requested) || requested < 1) return 1
  if (!Number.isInteger(pageSize) || pageSize < 1) return 1
  const total = page.total
  if (total !== undefined) {
    const last = Math.max(1, Math.ceil(total / pageSize))
    return requested > last ? last : requested
  }
  if (page.rows.length === 0 && requested > 1) return requested - 1
  return requested
}

// Whether "this group has no contacts yet" is a FACT rather than an artefact of
// standing past the end of the list. It is true only when the server says the
// total is 0, or -- when the cube omits the total -- on the first page, which
// is the only page whose emptiness means the list itself is empty.
export function isGenuinelyEmpty<T>(page: ContactGroupPage<T>, requested: number): boolean {
  if (page.rows.length > 0) return false
  return page.total !== undefined ? page.total === 0 : requested === 1
}

export function pageViewOf<T>(page: ContactGroupPage<T>, pageSize: number): PageView {
  const count = page.rows.length
  const total = page.total
  return {
    from: count === 0 ? 0 : page.offset + 1,
    to: page.offset + count,
    total,
    hasPrevious: page.offset > 0,
    hasNext: total === undefined ? count >= pageSize : page.offset + count < total,
    lastPage: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)),
  }
}
