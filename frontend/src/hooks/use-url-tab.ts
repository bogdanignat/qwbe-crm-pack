"use client"

// A tab kept in the URL (?tab=more), so a reload or a shared link opens the
// same tab. The first tab is the default and keeps the URL clean.

import { useSearchParams } from "next/navigation"
import { useCallback } from "react"

import { replaceUrlQuery } from "@/lib/url-query"

export function useUrlTab<T extends string>(tabs: readonly T[], param = "tab"): [T, (tab: string) => void] {
  const asked = useSearchParams().get(param)
  const tab = tabs.find((t) => t === asked) ?? tabs[0]

  const setTab = useCallback(
    (next: string) =>
      replaceUrlQuery((query) => {
        if (next === tabs[0]) query.delete(param)
        else query.set(param, next)
      }),
    [tabs, param],
  )
  return [tab, setTab]
}
