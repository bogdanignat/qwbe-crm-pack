// The directory search behind the @username picker: debounce, latest-wins
// race control, and the four answers the picker must tell apart.
//
// Framework-free on purpose (no React import): the hook binds it to a
// component, and this file is testable with node --test alone.
//
// The four answers are NOT interchangeable (the whole point of T-1450's
// picker complaint):
//   ready + rows      -> real suggestions
//   ready + no rows   -> the backend really found nothing for this query
//   refused           -> account:read was denied (403): the typed username
//                        stays the identity, the exact-username fallback lives
//                        on, and we never widen anything to "find" the user
//   failed            -> the request did not land (network, proxy, unreadable
//                        body): offer a retry, never say "no matches"
//
// The search is always server-side over the WHOLE authorized directory; the
// bounded page this returns is a page, and `truncated` says so, so the UI can
// avoid pretending the first page is the directory.

import { normalizeUsername, searchAccounts, type AccountPage, type AccountRef, type SharingResult } from "./sharing.ts"

export const DIRECTORY_LIMIT = 20
export const DIRECTORY_PAUSE_MS = 300
export const DIRECTORY_REFUSED_NOTE = "Directory search unavailable: type the exact username."
// Said whenever the backend filled the page it was asked for. Two claims it
// deliberately does NOT make:
//   - no total: the directory total is not in the response, so "20 of 348"
//     would be invented;
//   - no "there ARE more": a page filled to the limit is the only evidence
//     here, and a directory holding exactly `limit` matches fills it too. The
//     cap is a fact about the request ("up to 20"); more matches is a
//     possibility ("there may be more"), and it is worded as one.
// It also stays true when malformed rows were dropped, where "the first 20
// accounts" would have been a lie about a list of 17.
//
// CLAIM vs NOTE: the claim is the fact, and it is what the live region carries
// with a settled result. The note adds the standing advice for the visible
// echo; that advice also lives in the field's permanent help text, so the live
// region does not repeat it on every query.
export const DIRECTORY_BOUNDED_CLAIM = `Showing up to ${DIRECTORY_LIMIT} matches; there may be more.`
export const DIRECTORY_BOUNDED_NOTE = `${DIRECTORY_BOUNDED_CLAIM} Keep typing to narrow the search.`

// One account the picker must show but must not let the operator pick, with
// the reason in the CALLER's words: the group panel says "Already in group",
// the record sharing panel says "Already shared". A shared picker never
// invents context copy of its own.
export type ExcludedUser = {
  username: string
  reason: string
}

// One rendered option. `excludedReason` non-null = visible, announced, and
// not selectable.
export type UserSuggestion = {
  id: string
  username: string
  primary: string
  secondary: string | null
  excludedReason: string | null
}

export type DirectoryState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; rows: AccountRef[]; truncated: boolean }
  | { kind: "refused"; query: string }
  | { kind: "failed"; query: string; message: string }

// EXACT comparison, deliberately. Both sides are backend-issued strings -- a
// directory row's `username` and the caller's excluded usernames, which come
// from the same account lookup -- so they already agree on casing, and the
// submit guards (sharing-panel's duplicate check, the backend's own
// membership/grant validation) compare exactly too. Case-folding HERE and
// nowhere else would make the picker and the mutation disagree: an account the
// picker declared "Already in group" could still be added, and an account the
// kernel treats as distinct could be shown as blocked. The kernel's own
// username case semantics could not be read from this workspace, so the
// conservative rule holds: never widen an exclusion beyond what the mutation
// path enforces.
const sameUser = (a: string, b: string) => a === b

// The picker's placeholder ("@username") and the display everywhere else
// ("@mihai") invite the operator to type the sigil; the directory's own
// `username` values never carry it (suggestionsOf prepends it only for
// display). A query sent with a leading "@" therefore fails to substring-match
// the very row it names, and the backend is never asked to strip it (this
// query travels to it verbatim, T-1450: "no enumeration escalation").
//
// The SAME rule the submit path applies (normalizeUsername, lib/sharing.ts):
// one sigil rule for the query and the identity, or the list and the mutation
// disagree about what "@maria" names.
export function normalizeDirectoryQuery(query: string): string {
  return normalizeUsername(query)
}

// Excluded accounts stay in the list, disabled, instead of being filtered
// away: an operator who types an existing member must read "Already in group",
// not "no matches".
export function suggestionsOf(
  rows: ReadonlyArray<AccountRef>,
  excluded: ReadonlyArray<ExcludedUser>,
): UserSuggestion[] {
  return rows.map((row) => {
    const hit = excluded.find((e) => sameUser(e.username, row.username))
    const handle = `@${row.username}`
    return {
      id: row.id,
      username: row.username,
      primary: row.displayName ?? handle,
      secondary: row.displayName ? handle : null,
      excludedReason: hit ? hit.reason : null,
    }
  })
}

export function isSelectable(suggestion: UserSuggestion): boolean {
  return suggestion.excludedReason === null
}

const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

// The single sentence the picker's live region carries. It is the ONLY channel
// that reaches an operator who cannot see the list, so everything the list
// shows visually has to survive here:
//   - how many options there are;
//   - that some of them are present but NOT pickable, with the caller's own
//     reason ("Already in group") -- a disabled row is skipped by the arrow
//     keys, so without this it is simply missing from the keyboard's world;
//   - that the page is bounded, so silence is never read as completeness.
// Pure and framework-free so it is asserted in the unit suite, not inferred
// from a screenshot.
//
// SETTLED STATES ONLY. `loading` is silent here on purpose: it happens on
// EVERY keystroke, and a live region that says "searching the directory" each
// time interrupts the operator's own typing with a sentence that carries no
// result -- the announcement they are waiting for is the one after it. The
// search is not hidden: the popup shows "Searching…" for a sighted operator
// and the input carries aria-busy for everyone else, neither of which is an
// interruption.
export function directoryStatus(input: {
  open: boolean
  state: DirectoryState
  suggestions: ReadonlyArray<UserSuggestion>
}): string {
  const { open, state, suggestions } = input
  if (!open) return ""
  switch (state.kind) {
    case "idle":
      return ""
    case "loading":
      return ""
    case "refused":
      return DIRECTORY_REFUSED_NOTE
    case "failed":
      return state.message
    case "ready": {
      if (suggestions.length === 0) {
        return state.query.trim() === "" ? "no accounts to show" : "no matches"
      }
      // Every part carries its own full stop, so the bounded claim joins the
      // rest without growing a double period.
      const parts = [`${countOf(suggestions.length, "account")} listed.`]
      const blocked = suggestions.flatMap((s) => (s.excludedReason === null ? [] : [s.excludedReason]))
      if (blocked.length > 0) {
        parts.push(`${countOf(blocked.length, "account")} cannot be picked: ${[...new Set(blocked)].join("; ")}.`)
      }
      if (state.truncated) parts.push(DIRECTORY_BOUNDED_CLAIM)
      return parts.join(" ")
    }
  }
}

export type DirectorySearch = {
  // Debounced by default; `immediate` for focus/open, where the operator is
  // waiting on a first page and there is nothing to debounce.
  search: (query: string, opts?: { immediate?: boolean }) => void
  // Re-runs the last query at once (the Retry button of the failed state).
  retry: () => void
  // Drops the pending timer AND any in-flight answer, then goes idle: used on
  // close and after a pick, so a late response never reopens a stale list.
  cancel: () => void
  // Same, and no state is ever emitted again: used on unmount.
  dispose: () => void
}

export function createDirectorySearch(opts: {
  onState: (state: DirectoryState) => void
  fetchAccounts?: (query: string, limit: number) => Promise<SharingResult<AccountPage>>
  limit?: number
  pauseMs?: number
}): DirectorySearch {
  const limit = opts.limit ?? DIRECTORY_LIMIT
  const pauseMs = opts.pauseMs ?? DIRECTORY_PAUSE_MS
  const fetchAccounts =
    opts.fetchAccounts ?? ((query: string, max: number) => searchAccounts({ q: query, limit: max }))

  let timer: ReturnType<typeof setTimeout> | null = null
  // Every started search takes a ticket; only the newest ticket may paint.
  let ticket = 0
  let lastQuery = ""
  let disposed = false

  const emit = (state: DirectoryState) => {
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
    // `query` (as typed) stays in every emitted state -- the heading and the
    // live region echo exactly what the operator wrote. Only the request sent
    // to the backend is normalized, so "@maria" still reads "Matches for
    // "@maria"" while the directory is actually asked for "maria".
    void fetchAccounts(normalizeDirectoryQuery(query), limit).then(
      (result) => {
        if (disposed || ticket !== mine) return
        if (result.ok) {
          // `returned`, not `rows.length`: the page is capped when the BACKEND
          // filled it, whether or not this adapter could read every row. Using
          // the rendered count would turn a page of 20 with 3 malformed rows
          // into an untruncated list of 17 -- "that is the whole directory",
          // said about a list that was cut off.
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
      // A rejected promise is a failure, never an empty directory.
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
      if (searchOpts?.immediate) {
        run(query)
        return
      }
      // A newer keystroke also invalidates the answer already in flight, so a
      // slow response for "ma" cannot land after "marin" was typed; and the
      // list says "searching" from the first keystroke instead of leaving the
      // previous query's rows under the new text.
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
