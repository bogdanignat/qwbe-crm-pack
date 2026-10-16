"use client"

// A list's query (search, filters, sort, page, page size): in the URL for a
// page's own list (lib/list-url.ts), so Back and a reload keep it, or in
// component state for a list embedded under pinned filters, which must not
// write over its host page's URL. Every change goes through `update`, which
// derives the next state from the current one.

import { useCallback, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

import { DEFAULT_LIST_STATE, listStateOf, writeListState, type ListState } from "@/lib/list-url"
import { replaceUrlQuery } from "@/lib/url-query"

export type ListStateChange = (state: ListState) => Partial<ListState>

export function useListState(inUrl: boolean): [ListState, (change: ListStateChange) => void] {
  const searchParams = useSearchParams()
  const fromUrl = useMemo(() => listStateOf(searchParams), [searchParams])
  const [local, setLocal] = useState<ListState>(DEFAULT_LIST_STATE)

  const update = useCallback(
    (change: ListStateChange) => {
      if (!inUrl) return setLocal((s) => ({ ...s, ...change(s) }))
      replaceUrlQuery((query) => {
        const current = listStateOf(query)
        writeListState(query, { ...current, ...change(current) })
      })
    },
    [inUrl],
  )
  return [inUrl ? fromUrl : local, update]
}
