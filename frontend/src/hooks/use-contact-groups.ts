"use client"

// The Contact groups LIST: one page of groups, the name search, and the two
// writes the cube offers here (create, rename).
//
// Authority comes from the backend only. The first list's 200/403 decides
// whether this operator sees the feature at all, and every later request is
// judged by its own answer -- a group can be renamed by someone else, or the
// write permission withdrawn, between two clicks. Nothing is updated
// optimistically: a write is followed by a reload, so what is on screen is
// what the cube actually holds.
//
// There is no delete: the cube publishes no delete-group endpoint (contract,
// known limit 3) and this app does not pretend otherwise.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  clampedPage,
  createContactGroup,
  fetchContactGroups,
  renameContactGroup,
  writeRefusalMessage,
  GROUPS_PAGE_SIZE,
  pageViewOf,
  type ContactGroup,
  type PageView,
} from "@/lib/contact-groups"
import { CONTACT_SEARCH_PAUSE_MS } from "@/lib/contact-directory"

export type GroupsAccess = "loading" | "ready" | "denied" | "failed"

export type WriteOutcome =
  | { ok: true; group: ContactGroup }
  | { ok: false; status: number; message: string }

export type ContactGroupsList = {
  access: GroupsAccess
  groups: ContactGroup[]
  view: PageView | null
  // Why the list itself could not be shown (never a write refusal).
  error: string | null
  // The text in the search box, exactly as typed. The request follows a pause.
  query: string
  // The text the rows on screen actually answer. It lags `query` by the pause,
  // and an empty-state message must be said about THIS -- saying `No group
  // matches "Ada"` about rows fetched for "Ad" is a false statement.
  settledQuery: string
  // True while the typed text has not been asked about yet, or has been asked
  // and not answered: the rows on screen are not (yet) about `query`.
  pending: boolean
  setQuery: (text: string) => void
  page: number
  setPage: (page: number) => void
  reload: () => void
  busy: boolean
  create: (name: string) => Promise<WriteOutcome>
  rename: (id: string, name: string) => Promise<WriteOutcome>
}

export function useContactGroups(): ContactGroupsList {
  const [access, setAccess] = useState<GroupsAccess>("loading")
  const [groups, setGroups] = useState<ContactGroup[]>([])
  const [view, setView] = useState<PageView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  // The query a request may actually be sent for: the typed text after the
  // pause. Keystrokes stay local; the cube's `q` is a prefix search, so a
  // request per keystroke is a miss by construction.
  const [settledQuery, setSettledQuery] = useState("")
  // What the rows on screen actually answer: the query and page the newest
  // ANSWER was about. Until it catches up with (settledQuery, page), the list
  // is pending and no statement is made about the current text.
  const [answered, setAnswered] = useState<{ query: string; page: number } | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  // Bumped to force a reload after a write, without touching the query or the
  // page the operator is on.
  const [epoch, setEpoch] = useState(0)
  // Only the newest list answer may paint.
  const seq = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The debounce is a timer -- an external system -- so it lives in an effect
  // and is cleared when the text changes again or the hook unmounts.
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query), CONTACT_SEARCH_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // A new search starts at the first page: page 4 of the previous search is
  // not a place in this one. Done where the text CHANGES, not in an effect
  // reacting to it -- a setState in an effect body is a second render pass for
  // something the event already knows.
  const changeQuery = useCallback((text: string) => {
    setQuery(text)
    setPage(1)
  }, [])

  useEffect(() => {
    const mine = ++seq.current
    void fetchContactGroups({ page, pageSize: GROUPS_PAGE_SIZE, q: settledQuery, sort: "name" }).then(
      (result) => {
        if (!mounted.current || seq.current !== mine) return
        if (!result.ok) {
          if (result.status === 403) {
            setAccess("denied")
            setError(null)
          } else {
            setAccess("failed")
            setError(result.message)
          }
          setGroups([])
          setView(null)
          setAnswered({ query: settledQuery, page })
          return
        }
        // A page past the end of what the server holds is corrected before it
        // is painted, so "Page 3 of 1" and a "0-25 of 25" window cannot be
        // rendered from a stale link or a list that shrank.
        const corrected = clampedPage(page, result.value, GROUPS_PAGE_SIZE)
        if (corrected !== page) {
          setPage(corrected)
          return
        }
        setAccess("ready")
        setError(null)
        setGroups(result.value.rows)
        setView(pageViewOf(result.value, GROUPS_PAGE_SIZE))
        setAnswered({ query: settledQuery, page })
      },
    )
  }, [page, settledQuery, epoch])

  const reload = useCallback(() => setEpoch((n) => n + 1), [])

  // One write, one shape: the request runs, the list reloads from the server,
  // and the caller gets the refusal already translated from the STATUS (the
  // kernel's message text is not a contract). 409 is a normal answer here --
  // the database is the arbiter of the name and another user may win the race.
  const write = useCallback(
    async (run: () => Promise<Awaited<ReturnType<typeof createContactGroup>>>): Promise<WriteOutcome> => {
      setBusy(true)
      const result = await run()
      const outcome: WriteOutcome = result.ok
        ? { ok: true, group: result.value }
        : {
            ok: false,
            status: result.status,
            message: writeRefusalMessage(result.status, result.message),
          }
      // A panel unmounted mid-request still gets its answer (the caller may be
      // closing a dialog on it); only the STATE of a live hook is touched.
      if (mounted.current) {
        setBusy(false)
        if (result.ok) reload()
      }
      return outcome
    },
    [reload],
  )

  const create = useCallback((name: string) => write(() => createContactGroup(name)), [write])
  const rename = useCallback(
    (id: string, name: string) => write(() => renameContactGroup(id, name)),
    [write],
  )

  const pending =
    query !== settledQuery || answered === null || answered.query !== settledQuery || answered.page !== page

  return {
    access,
    groups,
    view,
    error,
    query,
    settledQuery,
    pending,
    setQuery: changeQuery,
    page,
    setPage,
    reload,
    busy,
    create,
    rename,
  }
}
