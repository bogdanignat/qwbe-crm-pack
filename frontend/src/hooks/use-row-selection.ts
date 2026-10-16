"use client"

// The rows ticked on one list page. The selection belongs to the page it was
// made on: a new query (page, sort, search) starts it empty, so an action can
// never reach rows the reader no longer sees.

import { useState } from "react"

export type RowSelection = ReturnType<typeof useRowSelection>

export function useRowSelection(queryKey: string, pageIds: readonly string[]) {
  const [state, setState] = useState<{ key: string; ids: string[] }>({ key: queryKey, ids: [] })
  const ids = state.key === queryKey ? state.ids.filter((id) => pageIds.includes(id)) : []
  const set = (next: string[]) => setState({ key: queryKey, ids: next })

  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle: (id: string, on: boolean) => set(on ? [...ids, id] : ids.filter((x) => x !== id)),
    allOnPage: pageIds.length > 0 && pageIds.every((id) => ids.includes(id)),
    toggleAll: (on: boolean) => set(on ? [...pageIds] : []),
    clear: () => set([]),
  }
}
