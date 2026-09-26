"use client"

// Binds the framework-free contact search (lib/contact-directory.ts) to one
// picker instance: open/closed, the debounced query, the four answers, and
// the decorated options.
//
// Everything that talks to the backend or decides what an option means lives
// here or in lib; the picker component only renders what this returns.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  contactSuggestionsOf,
  createContactSearch,
  type ContactSearch,
  type ContactSearchState,
  type ContactSuggestion,
  type ExcludedContact,
} from "@/lib/contact-directory"

export type ContactDirectory = {
  open: boolean
  state: ContactSearchState
  suggestions: ContactSuggestion[]
  // The open control (the chevron) and ArrowDown: shows the first page at
  // once, empty query included, so the list is discoverable without typing.
  openWith: (query: string) => void
  // The input took focus. NOT the same as `openWith`: focus the picker moved
  // itself (a pick, Retry, the open control) must change nothing, and focus
  // arriving at an already-open list must not re-run the search behind it.
  focused: (query: string) => void
  queryChanged: (query: string) => void
  close: () => void
  retry: () => void
  // Put the caret back after a control the picker owns was used, WITHOUT that
  // focus being read as the operator arriving at the field. Every programmatic
  // focus goes through here; nothing else calls `.focus()`.
  refocus: (input: HTMLInputElement | null) => void
}

export function useContactSearch(excluded: ReadonlyArray<ExcludedContact>): ContactDirectory {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ContactSearchState>({ kind: "idle" })
  const search = useRef<ContactSearch | null>(null)
  // `open` as the event handlers see it: a focus event can land in the same
  // tick as the click that opened or closed the list, before React has
  // re-rendered with the new state.
  const openNow = useRef(false)
  // Set just before the picker moves the caret itself, so one focus event is
  // ignored -- that is what keeps Retry, a pick and the open control from
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
    const instance = createContactSearch({ onState: setState })
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
      if (selfFocus.current) {
        selfFocus.current = false
        return
      }
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
    // Only a focus that actually MOVES fires an event; arming the guard when
    // the input already holds the caret would leave it armed and swallow the
    // operator's next real focus.
    if (document.activeElement !== input) selfFocus.current = true
    input.focus()
    if (document.activeElement !== input) selfFocus.current = false
  }, [])

  const suggestions = useMemo(
    () => (state.kind === "ready" ? contactSuggestionsOf(state.rows, excluded) : []),
    [state, excluded],
  )

  return { open, state, suggestions, openWith, focused, queryChanged, close, retry, refocus }
}
