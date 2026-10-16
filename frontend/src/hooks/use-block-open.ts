"use client"

// The open/closed state of one collapsible block, remembered in this browser
// (lib/block-state.ts). Open on the server and on the first client render, so
// hydration matches; the remembered state applies right after.

import { useCallback, useSyncExternalStore } from "react"

import { readBlockOpen, writeBlockOpen } from "@/lib/block-state"

// Same-tab writes do not fire the storage event, so the blocks of this page
// are told directly.
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useBlockOpen(key: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => readBlockOpen(key),
    () => true,
  )
  const setOpen = useCallback(
    (next: boolean) => {
      writeBlockOpen(key, next)
      for (const listener of listeners) listener()
    },
    [key],
  )
  return [open, setOpen]
}
