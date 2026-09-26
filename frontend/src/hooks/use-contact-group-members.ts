"use client"

// ONE contact group: the group itself, one page of its membership rows with
// the contact identities resolved, the two membership writes (add an EXISTING
// contact, remove one) and the rename of the group on screen.
//
// Two cubes, two permissions, two answers, kept apart on purpose:
//   the group   GET /contact-groups/:id            crm/contact-groups:read
//   the members GET /contact-groups/:id/members    ALSO crm/contacts:read
// A caller holding group permissions but not contact read permission gets 200
// on the group and 403 on the members (contract, Auth): the page then shows
// the group and says why the membership list is unavailable, instead of
// showing an empty group that is not empty.
//
// Membership rows carry `contactId` ONLY. Every page of them is resolved with
// ONE `ids=` batch against the contacts cube -- never one request per row, and
// never a download of the contacts cube to filter in the browser.
//
// NAVIGATION SAFETY. Every piece of state here carries the groupId it belongs
// to, and what the hook returns is that state only while the id still matches.
// A slow answer for group A therefore cannot paint under group B, cannot clamp
// B's page and cannot be removed from B -- with or without a remount, and
// whichever answer lands first.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  addGroupMember,
  clampedPage,
  fetchContactGroup,
  fetchGroupMembers,
  isGenuinelyEmpty,
  membershipRefusalMessage,
  removeGroupMember,
  renameContactGroup,
  writeRefusalMessage,
  MEMBERS_PAGE_SIZE,
  pageViewOf,
  type ContactGroup,
  type PageView,
} from "@/lib/contact-groups"
import { memberRowsOf, resolveContacts, type MemberRow } from "@/lib/contact-directory"

export type GroupAccess = "loading" | "ready" | "denied" | "missing" | "failed"
export type MembersAccess = "loading" | "ready" | "denied" | "missing" | "failed"

export type MemberWriteOutcome = { ok: true } | { ok: false; message: string }

export type ContactGroupMembers = {
  groupAccess: GroupAccess
  group: ContactGroup | null
  groupError: string | null
  membersAccess: MembersAccess
  rows: MemberRow[]
  view: PageView | null
  membersError: string | null
  // True when the batch that resolves this page's contacts did not answer:
  // the rows are real, their names are not available, and the panel says so
  // instead of letting one unavailable contact read as an empty group.
  identitiesUnavailable: boolean
  // True only when the SERVER says this group holds no members -- never when an
  // empty page is the result of standing past the end of the list.
  membersEmpty: boolean
  page: number
  setPage: (page: number) => void
  reload: () => void
  busy: boolean
  // Both take a contact id that came from a contact SEARCH result. Nothing in
  // this feature accepts a typed id (contract, known limit 1: the backend
  // cannot verify a contactId exists).
  addMember: (contactId: string) => Promise<MemberWriteOutcome>
  removeMember: (contactId: string) => Promise<MemberWriteOutcome>
  // Renaming belongs to the group on screen, so it is done from here with ONE
  // request. The duplicate answer is the server's 409; no list of other groups
  // is fetched to guess at it beforehand.
  rename: (name: string) => Promise<MemberWriteOutcome>
}

// Everything the group request owns, tagged with the group it describes.
type GroupState = {
  groupId: string
  access: GroupAccess
  group: ContactGroup | null
  error: string | null
}

// Everything the members request owns, tagged the same way.
type MembersState = {
  groupId: string
  access: MembersAccess
  rows: MemberRow[]
  view: PageView | null
  error: string | null
  identitiesUnavailable: boolean
  empty: boolean
}

// Where the reader stands, tagged the same way: a page number is a place in
// ONE group's list and means nothing in another's.
type PageState = { groupId: string; page: number }

const freshGroup = (groupId: string): GroupState => ({
  groupId,
  access: "loading",
  group: null,
  error: null,
})

const freshMembers = (groupId: string): MembersState => ({
  groupId,
  access: "loading",
  rows: [],
  view: null,
  error: null,
  identitiesUnavailable: false,
  empty: false,
})

export function useContactGroupMembers(groupId: string): ContactGroupMembers {
  const [groupState, setGroupState] = useState<GroupState>(() => freshGroup(groupId))
  const [membersState, setMembersState] = useState<MembersState>(() => freshMembers(groupId))
  const [pageState, setPageState] = useState<PageState>(() => ({ groupId, page: 1 }))
  const [busy, setBusy] = useState(false)
  // Bumped to re-read the same (group, page) after a write.
  const [epoch, setEpoch] = useState(0)
  // Only the newest request of each kind may paint. A new groupId or a new page
  // bumps these, so an answer for what is no longer being asked is dropped.
  const groupSeq = useRef(0)
  const membersSeq = useRef(0)

  // What may be SHOWN: state that belongs to another group is not this group's
  // state, so it reads as a loading one for as long as its id differs. This is
  // what makes a navigation safe even without a remount -- group A's name,
  // rows, page and refusals are unreachable the moment the id changes.
  const shownGroup = groupState.groupId === groupId ? groupState : freshGroup(groupId)
  const shownMembers = membersState.groupId === groupId ? membersState : freshMembers(groupId)
  const page = pageState.groupId === groupId ? pageState.page : 1

  // The group. An external system (one endpoint), re-read when the id changes.
  useEffect(() => {
    const mine = ++groupSeq.current
    void fetchContactGroup(groupId).then((result) => {
      if (groupSeq.current !== mine) return
      if (!result.ok) {
        const access: GroupAccess =
          result.status === 403 ? "denied" : result.status === 404 ? "missing" : "failed"
        setGroupState({
          groupId,
          access,
          group: null,
          error: access === "failed" ? result.message : null,
        })
        return
      }
      setGroupState({ groupId, access: "ready", group: result.value, error: null })
    })
  }, [groupId, epoch])

  // The members of that group, one page at a time, with their identities
  // resolved in ONE batch.
  useEffect(() => {
    const mine = ++membersSeq.current
    void (async () => {
      const members = await fetchGroupMembers(groupId, page, MEMBERS_PAGE_SIZE)
      if (membersSeq.current !== mine) return
      if (!members.ok) {
        const access: MembersAccess =
          members.status === 403 ? "denied" : members.status === 404 ? "missing" : "failed"
        setMembersState({
          ...freshMembers(groupId),
          access,
          error: access === "failed" ? members.message : null,
        })
        return
      }
      // The page the server actually has. Asking for page 2 of a list that now
      // holds one page (the last member of the last page was removed, or a
      // link named a page that never existed) is corrected HERE, before
      // anything is painted: no "0-25 of 25" and no "Page 2 of 1" is ever
      // rendered, and no "empty group" is claimed about a list that is not.
      const corrected = clampedPage(page, members.value, MEMBERS_PAGE_SIZE)
      if (corrected !== page) {
        setPageState({ groupId, page: corrected })
        return
      }
      const resolved = await resolveContacts(members.value.rows.map((m) => m.contactId))
      if (membersSeq.current !== mine) return
      setMembersState({
        groupId,
        access: "ready",
        error: null,
        identitiesUnavailable: !resolved.ok,
        empty: isGenuinelyEmpty(members.value, page),
        rows: memberRowsOf(members.value.rows, resolved.ok ? resolved.value : {}),
        view: pageViewOf(members.value, MEMBERS_PAGE_SIZE),
      })
    })()
  }, [groupId, page, epoch])

  const reload = useCallback(() => setEpoch((n) => n + 1), [])

  const setPage = useCallback(
    (next: number) => {
      if (!Number.isInteger(next) || next < 1) return
      setPageState({ groupId, page: next })
    },
    [groupId],
  )

  // A membership write, followed by a re-read of the SERVER's list: nothing
  // here is applied optimistically and no count is adjusted in the browser.
  const write = useCallback(
    async (
      action: "add" | "remove",
      run: () => Promise<{ ok: true } | { ok: false; status: number; message: string }>,
    ): Promise<MemberWriteOutcome> => {
      setBusy(true)
      const result = await run()
      setBusy(false)
      // Even a refused write re-reads: a 404 means the list on screen is out of
      // date about that row, whichever of the two things it refers to. The
      // page the reader stands on is re-judged by the same clamp, so removing
      // the last row of the last page lands on a page that exists.
      reload()
      return result.ok
        ? { ok: true }
        : { ok: false, message: membershipRefusalMessage(action, result.status, result.message) }
    },
    [reload],
  )

  // Adding is IDEMPOTENT by contract: an already-active member comes back as
  // the EXISTING row with 200 and nothing is created. The answer carries no
  // "created" flag, so this reports SUCCESS and lets the caller state the
  // resulting fact -- it never claims an addition it cannot prove.
  const addMember = useCallback(
    (contactId: string) =>
      write("add", () =>
        addGroupMember(groupId, contactId).then((r) =>
          r.ok ? ({ ok: true } as const) : ({ ok: false, status: r.status, message: r.message } as const),
        ),
      ),
    [groupId, write],
  )

  const removeMember = useCallback(
    (contactId: string) =>
      write("remove", () =>
        removeGroupMember(groupId, contactId).then((r) =>
          r.ok ? ({ ok: true } as const) : ({ ok: false, status: r.status, message: r.message } as const),
        ),
      ),
    [groupId, write],
  )

  const rename = useCallback(
    async (name: string): Promise<MemberWriteOutcome> => {
      setBusy(true)
      const result = await renameContactGroup(groupId, name)
      setBusy(false)
      if (!result.ok) {
        return { ok: false, message: writeRefusalMessage(result.status, result.message) }
      }
      // The renamed group as the server returned it: no second request, and the
      // card's title cannot disagree with what was just saved.
      const saved = result.value
      setGroupState((prev) =>
        prev.groupId === groupId ? { ...prev, access: "ready", group: saved, error: null } : prev,
      )
      return { ok: true }
    },
    [groupId],
  )

  return {
    groupAccess: shownGroup.access,
    group: shownGroup.group,
    groupError: shownGroup.error,
    membersAccess: shownMembers.access,
    rows: shownMembers.rows,
    view: shownMembers.view,
    membersError: shownMembers.error,
    identitiesUnavailable: shownMembers.identitiesUnavailable,
    membersEmpty: shownMembers.empty,
    page,
    setPage,
    reload,
    busy,
    addMember,
    removeMember,
    rename,
  }
}
