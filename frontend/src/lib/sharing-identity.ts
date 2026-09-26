// The two reads the sharing panel's management form needs once the grant list
// has answered 200: the cube's permission groups, and who the operator is.
//
// They are INDEPENDENT LIFETIMES on purpose. Both used to be started by one
// component effect whose dependencies included the groups state it set, so the
// first answer to land re-ran the effect, the cleanup cancelled the other
// answer still in flight, and the re-run refused to start it again (the guard
// "groups already known" was now true). Whenever the groups answered first --
// the ordinary case, a small cached list against a session lookup -- the
// identity was silently lost, and with it the "You manage this record" mark on
// the operator's own account in the picker: the panel then offered the operator
// a share with themselves. Here one answer can never cancel the other, because
// there is only ONE lifetime and it belongs to the load, not to either result.
//
// Framework-free (no React import): the hook binds it to a component and this
// file is testable with node --test alone, both completion orders included.

import { apiFetch } from "./cube.ts"

export type SessionAccount = {
  id: string
  username: string
}

// Boundary parse of /auth/me. An unreadable or half body is NOT an identity: a
// missing username would make the picker mark the wrong account, or none, and
// the panel's "you already manage this record" guard would compare against
// undefined. No identity at all is the honest answer, and the backend
// re-validates every mutation anyway.
export function sessionAccountOf(raw: unknown): SessionAccount | null {
  if (typeof raw !== "object" || raw === null) return null
  const row = raw as Record<string, unknown>
  const id = typeof row.id === "string" ? row.id : ""
  const username = typeof row.username === "string" ? row.username : ""
  if (id === "" || username === "") return null
  return { id, username }
}

// Who the operator is, or null. Never throws: a refusal, a network failure and
// an unreadable body all degrade to "identity unknown", which only costs the
// picker its owner mark -- it never opens anything up, and no authority is
// inferred from it (the grant list alone decides that).
export async function fetchSessionAccount(doFetch: typeof fetch = apiFetch): Promise<SessionAccount | null> {
  try {
    const response = await doFetch("/api/qwbe/auth/me")
    if (!response.ok) return null
    return sessionAccountOf(await response.json().catch(() => null))
  } catch {
    return null
  }
}

export type IdentityLoad = {
  // Starts both reads once. A second call is a no-op, so a re-render can never
  // duplicate a request.
  start: () => void
  // Drops BOTH answers and forbids any later one: used on unmount and when the
  // load is no longer wanted. Nothing else cancels anything.
  dispose: () => void
}

export function createIdentityLoad(opts: {
  loadGroups: () => Promise<Record<string, string> | null>
  loadMe: () => Promise<SessionAccount | null>
  onGroups: (groups: Record<string, string> | null) => void
  onMe: (me: SessionAccount) => void
}): IdentityLoad {
  let disposed = false
  let started = false

  return {
    start() {
      if (started || disposed) return
      started = true
      void opts.loadGroups().then(
        (groups) => {
          if (!disposed) opts.onGroups(groups)
        },
        // lookupGroups already degrades a refusal to null; a rejection here
        // would be a bug in it, and "groups refused" is the safe reading: the
        // group form stays hidden, the user form keeps working.
        () => {
          if (!disposed) opts.onGroups(null)
        },
      )
      void opts.loadMe().then(
        (me) => {
          // Only a real identity is published: null leaves `me` as it was, so
          // no code downstream has to tell "not asked yet" from "unknown".
          if (!disposed && me !== null) opts.onMe(me)
        },
        () => undefined,
      )
    },
    dispose() {
      disposed = true
    },
  }
}
