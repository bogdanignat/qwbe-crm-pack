// The CONTACT search behind the "add member" picker, and the batch resolution
// behind the member list (T-1451).
//
// This is the contacts cube's own published list -- `q=` for the search,
// `ids=` for the batch -- addressed through the SAME helpers the generic
// relation surfaces use (lib/relation-batch.ts). Nothing here calls the
// account directory: a business contact is not a user account, and no screen
// in this feature may reveal one.
//
// TWO seams, both bounded:
//   SEARCH  GET /contacts?q=<text>&limit=20   -- a page, never the whole cube
//   BATCH   GET /contacts?ids=a,b,c           -- ONE request per member page,
//                                                sized by the ids themselves
// There is no third: the member list never fetches per row, and nothing ever
// downloads the contacts cube to filter it in the browser.
//
// Framework-free on purpose (no React import): the hooks bind it to
// components, and this file is testable with `node --test` alone.

import { apiFetch, type PageOf, type Row } from "./cube.ts"
import { batchListApiPath, relationSearchApiPath } from "./relation-batch.ts"

export const CONTACTS_CUBE = "crm/contacts"

// Suggestions per search. The same bound the relation typeahead uses: this
// control narrows by text, it does not paginate.
export const CONTACT_SEARCH_LIMIT = 20
// The same pause every search surface in this app uses.
export const CONTACT_SEARCH_PAUSE_MS = 300

export const CONTACT_SEARCH_REFUSED_NOTE =
  "You may not search contacts, so no contact can be added here."
export const CONTACT_SEARCH_BOUNDED_CLAIM = `Showing up to ${CONTACT_SEARCH_LIMIT} matches; there may be more.`
export const CONTACT_SEARCH_BOUNDED_NOTE = `${CONTACT_SEARCH_BOUNDED_CLAIM} Keep typing to narrow the search.`
// Said about a membership row whose contact the batch did not return. THREE
// causes produce exactly the same answer from the contacts cube and cannot be
// told apart from here: the contact was deleted, the contact exists but this
// operator may not read it (the contacts API is permission-filtered), or the
// stored id never named a contact (the backend validates the SHAPE of
// contactId only -- contract, known limit 1).
//
// So the wording is UNAVAILABLE, not "not found": the row is real, the person
// behind it is simply not available to this reader. Claiming it was deleted, or
// that it never existed, would be a diagnosis this UI did not make.
export const MISSING_CONTACT_LABEL = "Contact unavailable"

// The contact fields this feature renders. `name` is the cube's title field
// (its first required field) and `company` is its free-text company column --
// the SAME two labels the contact summary publishes. No email, no phone: a
// membership list is not a contact export.
export type ContactRef = {
  id: string
  name: string
  company: string | null
}

// A row as the contacts list returns it, narrowed from `unknown`. A row
// without a usable id or name is DROPPED rather than rendered as a blank
// option: an option that cannot be posted is not a choice.
export function contactRefOf(row: Row): ContactRef | null {
  const id = row.id
  const name = row.name
  if (typeof id !== "string" || id === "") return null
  if (typeof name !== "string" || name.trim() === "") return null
  const company = row.company
  return { id, name, company: typeof company === "string" && company !== "" ? company : null }
}

export function contactRefsOf(rows: ReadonlyArray<Row>): ContactRef[] {
  return rows.flatMap((row) => {
    const ref = contactRefOf(row)
    return ref === null ? [] : [ref]
  })
}

export function contactSearchPath(text: string, limit: number = CONTACT_SEARCH_LIMIT): string {
  return relationSearchApiPath(CONTACTS_CUBE, text, limit)
}

export function contactBatchPath(ids: ReadonlyArray<string>): string {
  return batchListApiPath(CONTACTS_CUBE, ids)
}

export type ContactResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string }

async function readPage(
  path: string,
  doFetch: typeof fetch,
): Promise<ContactResult<{ rows: ContactRef[]; returned: number }>> {
  let response: Response
  try {
    response = await doFetch(path)
  } catch {
    return { ok: false, status: 0, message: "network error" }
  }
  if (!response.ok) {
    return { ok: false, status: response.status, message: `contact search failed (${response.status})` }
  }
  try {
    const page = (await response.json()) as PageOf<Row>
    const rows = Array.isArray(page.rows) ? page.rows : []
    // `returned`, not `rows.length`: the page is capped when the BACKEND
    // filled it, whether or not every row here survived narrowing. Counting
    // the rendered rows would turn a full page with 3 unusable rows into an
    // untruncated list of 17 -- "that is every match", said about a cut list.
    return { ok: true, value: { rows: contactRefsOf(rows), returned: rows.length } }
  } catch {
    return { ok: false, status: response.status, message: "unreadable response" }
  }
}

export function searchContacts(
  text: string,
  limit: number = CONTACT_SEARCH_LIMIT,
  doFetch: typeof fetch = apiFetch,
): Promise<ContactResult<{ rows: ContactRef[]; returned: number }>> {
  return readPage(contactSearchPath(text, limit), doFetch)
}

// ONE request for a whole member page. Returns id -> contact; an id the
// response did not carry is simply absent, and the caller renders
// MISSING_CONTACT_LABEL for it.
export async function resolveContacts(
  ids: ReadonlyArray<string>,
  doFetch: typeof fetch = apiFetch,
): Promise<ContactResult<Record<string, ContactRef>>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))]
  if (unique.length === 0) return { ok: true, value: {} }
  const page = await readPage(contactBatchPath(unique), doFetch)
  if (!page.ok) return page
  const byId: Record<string, ContactRef> = {}
  for (const ref of page.value.rows) byId[ref.id] = ref
  return { ok: true, value: byId }
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

// A contact the picker must show but must not let the operator pick, with the
// reason in the CALLER's words ("Already in this group"). Blocked rows stay in
// the list, disabled: an operator who searches an existing member must read
// why, not "no matches".
export type ExcludedContact = { id: string; reason: string }

export type ContactSuggestion = {
  id: string
  name: string
  company: string | null
  excludedReason: string | null
}

export function contactSuggestionsOf(
  rows: ReadonlyArray<ContactRef>,
  excluded: ReadonlyArray<ExcludedContact>,
): ContactSuggestion[] {
  return rows.map((row) => {
    const hit = excluded.find((e) => e.id === row.id)
    return {
      id: row.id,
      name: row.name,
      company: row.company,
      excludedReason: hit === undefined ? null : hit.reason,
    }
  })
}

export function isSelectableContact(suggestion: ContactSuggestion): boolean {
  return suggestion.excludedReason === null
}

// ---------------------------------------------------------------------------
// The four answers
// ---------------------------------------------------------------------------

// ready + rows    -> real suggestions
// ready + no rows -> the backend really found no contact for this text
// refused         -> crm/contacts:read denied (403). There is no fallback
//                    here: unlike a username, a contact id cannot be typed,
//                    so the picker says the feature is unavailable instead of
//                    inviting an id nobody can know.
// failed          -> the request did not land: offer a retry, never say
//                    "no matches".
export type ContactSearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; rows: ContactRef[]; truncated: boolean }
  | { kind: "refused"; query: string }
  | { kind: "failed"; query: string; message: string }

const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

// The single sentence the picker's live region carries: the only channel that
// reaches an operator who cannot see the list, so everything the list shows
// visually survives here -- the count, the rows that are present but blocked
// and why (the arrow keys skip them), and that the page is bounded.
//
// SETTLED STATES ONLY. `loading` is silent: it happens on every keystroke, and
// a live region firing per keystroke interrupts the typing it is reporting on.
// The wait still reaches everyone through the input's aria-busy and the
// visible "Searching..." panel.
export function contactSearchStatus(input: {
  open: boolean
  state: ContactSearchState
  suggestions: ReadonlyArray<ContactSuggestion>
}): string {
  const { open, state, suggestions } = input
  if (!open) return ""
  switch (state.kind) {
    case "idle":
    case "loading":
      return ""
    case "refused":
      return CONTACT_SEARCH_REFUSED_NOTE
    case "failed":
      return state.message
    case "ready": {
      if (suggestions.length === 0) {
        return state.query.trim() === "" ? "no contacts to show" : "no matches"
      }
      const parts = [`${countOf(suggestions.length, "contact")} listed.`]
      const blocked = suggestions.flatMap((s) => (s.excludedReason === null ? [] : [s.excludedReason]))
      if (blocked.length > 0) {
        parts.push(
          `${countOf(blocked.length, "contact")} cannot be picked: ${[...new Set(blocked)].join("; ")}.`,
        )
      }
      if (state.truncated) parts.push(CONTACT_SEARCH_BOUNDED_CLAIM)
      return parts.join(" ")
    }
  }
}

// ---------------------------------------------------------------------------
// The search controller
// ---------------------------------------------------------------------------

export type ContactSearch = {
  // Debounced by default; `immediate` for focus/open, where the operator is
  // waiting on a first page and there is nothing to debounce.
  search: (query: string, opts?: { immediate?: boolean }) => void
  retry: () => void
  // Drops the pending timer AND any in-flight answer, then goes idle, so a
  // late response never reopens a list the operator closed.
  cancel: () => void
  dispose: () => void
}

export function createContactSearch(opts: {
  onState: (state: ContactSearchState) => void
  fetchContacts?: (
    query: string,
    limit: number,
  ) => Promise<ContactResult<{ rows: ContactRef[]; returned: number }>>
  limit?: number
  pauseMs?: number
}): ContactSearch {
  const limit = opts.limit ?? CONTACT_SEARCH_LIMIT
  const pauseMs = opts.pauseMs ?? CONTACT_SEARCH_PAUSE_MS
  const fetchContacts =
    opts.fetchContacts ?? ((query: string, max: number) => searchContacts(query, max))

  let timer: ReturnType<typeof setTimeout> | null = null
  // Every started search takes a ticket; only the newest ticket may paint.
  let ticket = 0
  let lastQuery = ""
  let disposed = false

  const emit = (state: ContactSearchState) => {
    if (!disposed) opts.onState(state)
  }

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const run = (query: string) => {
    const mine = ++ticket
    lastQuery = query
    emit({ kind: "loading", query })
    void fetchContacts(query, limit).then(
      (result) => {
        if (disposed || ticket !== mine) return
        if (result.ok) {
          emit({
            kind: "ready",
            query,
            rows: result.value.rows,
            truncated: result.value.returned >= limit,
          })
        } else if (result.status === 403) {
          emit({ kind: "refused", query })
        } else {
          emit({ kind: "failed", query, message: result.message })
        }
      },
      // A rejected promise is a failure, never an empty contacts cube.
      () => {
        if (disposed || ticket !== mine) return
        emit({ kind: "failed", query, message: "network error" })
      },
    )
  }

  return {
    search(query, searchOpts) {
      clearTimer()
      lastQuery = query
      if (searchOpts?.immediate === true) {
        run(query)
        return
      }
      // A newer keystroke invalidates the answer already in flight too, so a
      // slow response for "ad" cannot land after "adriana" was typed.
      ticket++
      emit({ kind: "loading", query })
      timer = setTimeout(() => {
        timer = null
        run(query)
      }, pauseMs)
    },
    retry() {
      clearTimer()
      run(lastQuery)
    },
    cancel() {
      clearTimer()
      ticket++
      emit({ kind: "idle" })
    },
    dispose() {
      clearTimer()
      ticket++
      disposed = true
    },
  }
}

// ---------------------------------------------------------------------------
// The member list view
// ---------------------------------------------------------------------------

// One rendered membership row: the membership's own id, the contact id it
// points at, and the contact IF the batch could resolve it. `contact: null`
// is a real, expected state (see MISSING_CONTACT_LABEL) and the row still
// offers Remove -- a membership pointing at nothing is exactly the row an
// operator needs to be able to delete.
export type MemberRow = {
  membershipId: string
  contactId: string
  contact: ContactRef | null
}

export function memberRowsOf(
  members: ReadonlyArray<{ id: string; contactId: string }>,
  resolved: Readonly<Record<string, ContactRef>>,
): MemberRow[] {
  return members.map((m) => ({
    membershipId: m.id,
    contactId: m.contactId,
    contact: resolved[m.contactId] ?? null,
  }))
}

// What a member row shows: the contact's name, with its company as the
// secondary line. An unresolved row says so and never renders the raw id as a
// name.
export function memberLabelOf(row: MemberRow): { primary: string; secondary: string | null } {
  if (row.contact === null) return { primary: MISSING_CONTACT_LABEL, secondary: null }
  return { primary: row.contact.name, secondary: row.contact.company }
}

// The Remove button's accessible name. A label is a SENTENCE about the row, so
// an unresolved row gets its own wording: "Remove Contact unavailable from this
// group" reads as if someone were named that.
export function memberRemoveLabel(row: MemberRow): string {
  return row.contact === null
    ? "Remove this unavailable contact from this group"
    : `Remove ${row.contact.name} from this group`
}

// What is said after that row was removed, for the same reason: the membership
// is gone, and this UI still cannot name whom it pointed at.
export function memberRemovedMessage(row: MemberRow): string {
  return row.contact === null
    ? "The membership was removed. Its contact was not available to show."
    : `${row.contact.name} was removed from this group.`
}

// What is said after a successful ADD. Adding is idempotent by contract and a
// 200 carries no "created" flag: an add that created a row and an add of a
// contact that was already a member are INDISTINGUISHABLE here. So the sentence
// states the resulting fact, which is true in both cases, and never claims an
// addition happened. Inferring one from `createdAt` against a browser clock was
// considered and rejected: clock skew, latency and a re-added contact all break
// it, and a wrong claim is worse than a neutral one.
export function memberAddedMessage(name: string): string {
  return `${name} is in this group.`
}
