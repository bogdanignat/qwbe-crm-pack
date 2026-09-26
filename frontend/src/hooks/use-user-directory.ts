"use client"

// Binds the framework-free directory search (lib/user-directory.ts) to one
// picker instance: open/closed, the debounced query, the four answers, and
// the decorated options.
//
// Everything that talks to the backend or decides what an option means lives
// here or in lib; the picker component only renders what this returns.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  createDirectorySearch,
  suggestionsOf,
  type DirectorySearch,
  type DirectoryState,
  type ExcludedUser,
  type UserSuggestion,
} from "@/lib/user-directory"

export type UserDirectory = {
  open: boolean
  state: DirectoryState
  suggestions: UserSuggestion[]
  // The open control (the chevron) and ArrowDown: shows the first page at
  // once, empty query included, so the list is discoverable without typing.
  openWith: (query: string) => void
  // The input took focus. NOT the same as `openWith`: focus the picker itself
  // moved (a pick, Retry, the open control) must change nothing, and focus
  // arriving at an already-open list must not re-run the search behind it.
  focused: (query: string) => void
  // A keystroke: debounced server-side search over the whole directory.
  queryChanged: (query: string) => void
  // Close (Escape, outside pointer down, a pick): drops the pending timer and
  // any in-flight answer.
  close: () => void
  retry: () => void
  // Put the caret back in the input after a control the picker owns was used,
  // WITHOUT that focus being read as the operator arriving at the field. Every
  // programmatic focus goes through here; nothing else calls `.focus()`.
  refocus: (input: HTMLInputElement | null) => void
}

export function useUserDirectory(excluded: ReadonlyArray<ExcludedUser>): UserDirectory {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<DirectoryState>({ kind: "idle" })
  const search = useRef<DirectorySearch | null>(null)
  // `open` as the event handlers see it. A focus event can land in the same
  // tick as the click that opened or closed the list, before React has
  // re-rendered with the new state, so the handlers read this and not the
  // state variable.
  const openNow = useRef(false)
  // Set just before the picker moves the caret itself. One focus event is
  // then ignored, which is what keeps Retry, a pick and the open control from
  // firing a second, identical request through onFocus.
  const selfFocus = useRef(false)

  const setOpenNow = useCallback((next: boolean) => {
    openNow.current = next
    setOpen(next)
  }, [])

  // The controller is an external, disposable system: created on mount,
  // disposed on unmount, so no answer is ever applied to an unmounted picker
  // (and a StrictMode remount gets a fresh one).
  useEffect(() => {
    const instance = createDirectorySearch({ onState: setState })
    search.current = instance
    return () => {
      instance.dispose()
      if (search.current === instance) search.current = null
    }
  }, [])

  const openWith = useCallback(
    (query: string) => {
      setOpenNow(true)
      search.current?.search(query, { immediate: true })
    },
    [setOpenNow],
  )

  const focused = useCallback(
    (query: string) => {
      // The picker moved the caret here itself: the list is already in the
      // state that action asked for.
      if (selfFocus.current) {
        selfFocus.current = false
        return
      }
      // Focus arriving at a list that is already open (the chevron opened it
      // and then handed the caret back) would otherwise repeat the request
      // that is in flight or has just painted.
      if (openNow.current) return
      openWith(query)
    },
    [openWith],
  )

  const queryChanged = useCallback(
    (query: string) => {
      setOpenNow(true)
      search.current?.search(query)
    },
    [setOpenNow],
  )

  const close = useCallback(() => {
    setOpenNow(false)
    search.current?.cancel()
    setState({ kind: "idle" })
  }, [setOpenNow])

  const retry = useCallback(() => {
    search.current?.retry()
  }, [])

  const refocus = useCallback((input: HTMLInputElement | null) => {
    if (input === null) return
    // Only a focus that actually MOVES fires an event. Arming the guard when
    // the input already holds the caret would leave it armed and swallow the
    // operator's next real focus.
    if (document.activeElement !== input) selfFocus.current = true
    input.focus()
    // focus() is synchronous: if the caret did not actually land, no event is
    // coming and a guard left armed would swallow the operator's next real
    // focus instead -- the list would stop opening on focus, once, for no
    // visible reason.
    if (document.activeElement !== input) selfFocus.current = false
  }, [])

  const suggestions = useMemo(
    () => (state.kind === "ready" ? suggestionsOf(state.rows, excluded) : []),
    [state, excluded],
  )

  return { open, state, suggestions, openWith, focused, queryChanged, close, retry, refocus }
}
