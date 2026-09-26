"use client"

// The members of ONE permission group: the page on screen and the three writes
// this level offers (rename the group, add a member, remove a member).
// Extracted from components/groups-panel unchanged in behaviour.
//
// Every write is followed by a re-read of the page, and a refusal or a vanished
// group additionally asks the group LIST to re-judge the panel (`onChanged`):
// the kernel re-checks cube access on each call, so the answer to the last
// request is the only thing that says what this operator may still do.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  addGroupMember,
  fetchGroupMembersPage,
  groupWriteRefusalMessage,
  lookupAccounts,
  memberWriteRefusalMessage,
  memberRowsOf,
  membersHasMore,
  removeGroupMemberById,
  renameGroup,
  type GroupMembershipPage,
  type MemberRow,
  type PermissionGroupRef,
} from "@/lib/sharing"
import type { GroupWriteOutcome } from "@/hooks/use-permission-groups"

// The backend caps a members page at 200; 50 is what this panel asks for.
export const MEMBERS_PAGE = 50

export type MembersState =
  | { kind: "loading" }
  | { kind: "ready"; page: GroupMembershipPage; rows: MemberRow[] }
  | { kind: "failed"; message: string }

export type MemberWriteOutcome =
  | { ok: true; username: string | null }
  | { ok: false; status: number; message: string }

// `null` is the answer of a write whose panel is GONE (the scope or the group
// was switched while the request was in flight). There is no screen left to
// show it on, and announcing it over the panel that replaced this one would
// name a group the operator is no longer looking at, so the caller says
// nothing. Not an error: the write itself may well have succeeded, and the
// fresh panel reads the server for itself.
//
// `null` suppresses the ANNOUNCEMENT ONLY. Everything the write owes to state
// that outlives this section -- releasing the panel's busy flag, and asking the
// group LIST to re-read itself -- has already happened by the time `null` is
// returned. Skipping those with the message is what leaves a renamed group
// showing its old name in the select, or a deleted one still offered.
export type SettledMemberWrite = MemberWriteOutcome | null
export type SettledGroupWrite = GroupWriteOutcome | null

export type GroupMembersAdmin = {
  state: MembersState
  page: GroupMembershipPage | null
  rows: MemberRow[]
  offset: number
  hasPrevious: boolean
  hasNext: boolean
  previous: () => void
  next: () => void
  refetch: () => void
  rename: (name: string) => Promise<SettledGroupWrite>
  add: (username: string) => Promise<SettledMemberWrite>
  remove: (row: MemberRow) => Promise<SettledMemberWrite>
}

export function useGroupMembers(opts: {
  group: PermissionGroupRef
  setBusy: (busy: boolean) => void
  onChanged: () => void
}): GroupMembersAdmin {
  const { group, setBusy, onChanged } = opts
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<MembersState>({ kind: "loading" })
  const seq = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(
    (at: number) => {
      const mine = ++seq.current
      void (async () => {
        const result = await fetchGroupMembersPage({ groupId: group.id, offset: at, limit: MEMBERS_PAGE })
        if (!mounted.current || seq.current !== mine) return
        if (!result.ok) {
          // 403 (refused for this group), 404 (gone), 0 (network) and an
          // invalid body all show the server's/adapter's message; none of them
          // ever renders as "no members".
          setState({ kind: "failed", message: result.message })
          return
        }
        // ONE batch lookup for the whole page (`?ids=a,b`), never one request
        // per row: display names and usernames arrive together.
        const accounts = await lookupAccounts(result.value.rows.map((row) => row.userId))
        if (!mounted.current || seq.current !== mine) return
        setState({ kind: "ready", page: result.value, rows: memberRowsOf(result.value.rows, accounts) })
        // The last row of a later page was removed: step back one page.
        if (result.value.rows.length === 0 && at > 0) setOffset(Math.max(0, at - MEMBERS_PAGE))
      })()
    },
    [group.id],
  )

  useEffect(() => load(offset), [load, offset])

  const refetch = useCallback(() => load(offset), [load, offset])

  // What every membership write does with its answer: the page is re-read
  // always, and the group LIST is asked to re-judge the panel when the status
  // can mean this group is no longer this caller's (403) or no longer there at
  // all (404 -- on these routes 404 is usually the username, but it is also how
  // a deleted or newly refused group answers, and a list still offering a group
  // that is gone is worse than one extra GET).
  //
  // Both halves run even when THIS section was replaced mid-write, because they
  // are not the same owner: `onChanged` is the LIST's re-read and the list
  // outlives the section (it has its own `mounted`/`seq` guard), so a group that
  // a 403/404 says is gone must stop being offered whether or not the operator
  // is still looking at it. Only the member page belongs here.
  const settle = useCallback(
    (status: number | undefined) => {
      if (status === 403 || status === 404) onChanged()
      // The members page is THIS section's screen: re-reading it after the
      // section is gone would fetch for something nobody is looking at.
      if (mounted.current) refetch()
    },
    [onChanged, refetch],
  )

  // Renaming the group is a write to the GROUP, so it keeps the group mapper
  // (409 = the name is taken in this scope); only the membership writes below
  // use the membership mapper.
  const rename = useCallback(
    async (name: string): Promise<SettledGroupWrite> => {
      setBusy(true)
      try {
        const result = await renameGroup({ groupId: group.id, name })
        // A successful rename changes the LIST's copy of this group, and a
        // refusal may mean it is gone or no longer this caller's to administer.
        // Asked for BEFORE the unmount guard below and deliberately not gated by
        // it: the list is the parent's, it survives this section, and a rename
        // that went through must not leave the select above still offering the
        // old name just because the operator switched group while it was in
        // flight.
        if (result.ok || result.status === 403 || result.status === 404) onChanged()
        const outcome: GroupWriteOutcome = result.ok
          ? { ok: true, group: result.value }
          : { ok: false, status: result.status, message: groupWriteRefusalMessage(result.status, result.message) }
        // Only the ANNOUNCEMENT is withheld: every sentence built from this
        // outcome names THIS group, and the operator is now looking at another.
        return mounted.current ? outcome : null
      } finally {
        // Released on EVERY path, a throw included: a busy flag left set
        // disables the whole panel with nothing said. `setBusy` belongs to the
        // group list (which outlives this section) and is guarded there, so it
        // is called unconditionally -- skipping it when only this section
        // unmounted is what would strand the panel.
        setBusy(false)
      }
    },
    [group.id, onChanged, setBusy],
  )

  const add = useCallback(
    async (username: string): Promise<SettledMemberWrite> => {
      setBusy(true)
      try {
        const result = await addGroupMember({ groupId: group.id, username })
        // `settle` first, unmount guard after: see `settle` above -- the list's
        // re-read is the parent's and must happen even for a section that is
        // gone, or a group a 404 just said does not exist keeps being offered.
        settle(result.ok ? undefined : result.status)
        const outcome: MemberWriteOutcome = result.ok
          ? { ok: true, username }
          : { ok: false, status: result.status, message: memberWriteRefusalMessage(result.status, result.message) }
        return mounted.current ? outcome : null
      } finally {
        setBusy(false)
      }
    },
    [group.id, setBusy, settle],
  )

  const remove = useCallback(
    async (row: MemberRow): Promise<SettledMemberWrite> => {
      setBusy(true)
      try {
        const result = await removeGroupMemberById({ groupId: group.id, userId: row.userId })
        settle(result.ok ? undefined : result.status)
        const outcome: MemberWriteOutcome = result.ok
          ? { ok: true, username: result.value.username }
          : { ok: false, status: result.status, message: memberWriteRefusalMessage(result.status, result.message) }
        return mounted.current ? outcome : null
      } finally {
        setBusy(false)
      }
    },
    [group.id, setBusy, settle],
  )

  const page = state.kind === "ready" ? state.page : null
  const rows = state.kind === "ready" ? state.rows : []

  return {
    state,
    page,
    rows,
    offset,
    hasPrevious: page !== null && page.offset > 0,
    hasNext: page !== null && membersHasMore(page),
    previous: () => setOffset((at) => Math.max(0, at - MEMBERS_PAGE)),
    next: () => setOffset((at) => at + MEMBERS_PAGE),
    refetch,
    rename,
    add,
    remove,
  }
}
