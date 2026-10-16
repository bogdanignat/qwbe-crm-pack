"use client"

// The signed-in user for a component, from the one shared /auth/me request
// (lib/current-user.ts). `failed` is the signal that the identity could not be
// read, so a caller can say so instead of waiting forever.

import { useEffect, useState } from "react"

import { fetchCurrentUser, type CurrentUser } from "@/lib/current-user"

export type CurrentUserState =
  | { status: "loading"; user: null }
  | { status: "failed"; user: null }
  | { status: "ready"; user: CurrentUser }

export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({ status: "loading", user: null })
  useEffect(() => {
    let alive = true
    void fetchCurrentUser().then((user) => {
      if (alive) setState(user ? { status: "ready", user } : { status: "failed", user: null })
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}
