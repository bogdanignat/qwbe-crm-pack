"use client"

// The records before and after this one in the list it was opened from
// (lib/list-context.ts), or null without one. Read from this tab's
// sessionStorage; the server render has none, so the arrows come after mount.

import { useMemo, useSyncExternalStore } from "react"

import { listContextKey, neighborsOf, parseListContext, type Neighbors } from "@/lib/list-context"

// The stored context only changes when a list renders, never under this page.
const subscribe = () => () => undefined

export function useListNeighbors(cube: string, id: string): Neighbors | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(listContextKey(cube))
      } catch {
        return null
      }
    },
    () => null,
  )
  return useMemo(() => neighborsOf(parseListContext(raw), id), [raw, id])
}
