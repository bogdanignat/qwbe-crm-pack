"use client"

// The permission groups of ONE cube: the list, who may administer it, and the
// one write this level offers (create). Extracted from components/groups-panel
// unchanged in behaviour -- the panel renders what this returns and decides
// nothing about authority, staleness or refusals.
//
// Authority comes from the backend only. The list's 200/403 gates the panel;
// every later request is judged by its own answer (the kernel re-checks cube
// access per group on each call, and a group can vanish or be refused between
// two clicks), so a refusal is shown from the server's answer and the list is
// re-read -- never an optimistic update.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  createGroup,
  fetchGroups,
  groupWriteRefusalMessage,
  retainSelectedGroup,
  type PermissionGroupRef,
} from "@/lib/sharing"

export type GroupsAccess = "loading" | "manage" | "denied" | "failed"

export type GroupWriteOutcome =
  | { ok: true; group: PermissionGroupRef }
  | { ok: false; status: number; message: string }

// `null` = the panel that asked for this write is gone (the access scope was
// switched while the request was in flight). Its answer has no screen left to
// appear on and must not be announced over the scope that replaced it, so the
// caller says nothing. See hooks/use-group-members.ts SettledMemberWrite.

export type PermissionGroupsAdmin = {
  access: GroupsAccess
  groups: PermissionGroupRef[]
  // Why the LIST could not be (re-)read. A write refusal never lands here: it
  // is returned to the caller of `create`.
  error: string | null
  selectedId: string
  selected: PermissionGroupRef | null
  select: (groupId: string) => void
  reload: () => void
  // One flag for the whole panel: while any write of this cube's groups is in
  // flight, no other write may be started from it. `setBusy` is safe to call
  // after the caller unmounted (a member section that was replaced mid-write
  // still has to release the flag it set, or the panel stays disabled).
  busy: boolean
  setBusy: (busy: boolean) => void
  create: (name: string) => Promise<GroupWriteOutcome | null>
}

export function usePermissionGroups(cube: string): PermissionGroupsAdmin {
  const [access, setAccess] = useState<GroupsAccess>("loading")
  const [groups, setGroups] = useState<PermissionGroupRef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [busy, setBusyState] = useState(false)
  // Only the latest list load may paint.
  const seq = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The busy flag of a panel that no longer exists is nobody's business, but a
  // caller that set it must always be allowed to clear it; the guard lives here
  // instead of at every call site.
  const setBusy = useCallback((next: boolean) => {
    if (mounted.current) setBusyState(next)
  }, [])

  const load = useCallback(() => {
    const mine = ++seq.current
    void fetchGroups(cube).then((result) => {
      if (!mounted.current || seq.current !== mine) return
      if (!result.ok) {
        if (result.status === 403) {
          setAccess("denied")
        } else {
          // A background refresh that failed must not take a working panel
          // away; it says the list may be stale instead.
          setAccess((a) => (a === "manage" ? a : "failed"))
          setError(result.message)
        }
        return
      }
      setGroups(result.value)
      setAccess("manage")
      setError(null)
      // A selected group the list no longer carries is dropped, so no request
      // ever targets a group of a stale list.
      setSelectedId((current) => retainSelectedGroup(result.value, current))
    })
  }, [cube])

  useEffect(() => load(), [load])

  const create = useCallback(
    async (name: string): Promise<GroupWriteOutcome | null> => {
      setBusy(true)
      try {
        const result = await createGroup({ cube, name })
        // A panel unmounted mid-request touches no state and says nothing.
        if (!mounted.current) return null
        if (result.ok) setSelectedId(result.value.id)
        // The list is the source of truth after ANY attempt: a 409 means
        // someone else's group holds the name and the list should show it, and
        // a 403 flips the panel to the neutral sentence through the same path.
        load()
        return result.ok
          ? { ok: true, group: result.value }
          : { ok: false, status: result.status, message: groupWriteRefusalMessage(result.status, result.message) }
      } finally {
        // Every path releases the flag, a throw included: a stuck busy flag
        // disables the create form and every write below it with no message.
        setBusy(false)
      }
    },
    [cube, load, setBusy],
  )

  const selected = groups.find((group) => group.id === selectedId) ?? null

  return { access, groups, error, selectedId, selected, select: setSelectedId, reload: load, busy, setBusy, create }
}
