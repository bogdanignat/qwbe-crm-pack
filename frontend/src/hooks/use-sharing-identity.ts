"use client"

// Binds the identity/groups load (lib/sharing-identity.ts) to the sharing
// panel: started once the grant list has answered 200 (never after a 403), and
// disposed on unmount or when the record's cube changes.
//
// The state this returns is deliberately NOT in the effect's dependencies:
// that is exactly what made the two reads cancel each other. The effect depends
// on what the REQUESTS depend on -- the cube and whether the form is wanted at
// all -- so a result landing never restarts it.

import { useEffect, useState } from "react"

import { lookupGroups } from "@/lib/sharing"
import { createIdentityLoad, fetchSessionAccount, type SessionAccount } from "@/lib/sharing-identity"

export type SharingIdentity = {
  // undefined = not asked yet; null = the backend refused (the group form stays
  // hidden); a map = the cube's groups. Unchanged semantics.
  groups: Record<string, string> | null | undefined
  me: SessionAccount | null
}

export function useSharingIdentity(cube: string, enabled: boolean): SharingIdentity {
  const [groups, setGroups] = useState<Record<string, string> | null | undefined>(undefined)
  const [me, setMe] = useState<SessionAccount | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    const load = createIdentityLoad({
      loadGroups: () => lookupGroups(cube),
      loadMe: () => fetchSessionAccount(),
      onGroups: setGroups,
      onMe: setMe,
    })
    load.start()
    return () => load.dispose()
  }, [cube, enabled])

  return { groups, me }
}
