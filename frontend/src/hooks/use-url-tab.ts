"use client"

// A tab kept in the URL (?tab=more), so a reload or a shared link opens the
// same tab. The first tab is the default and keeps the URL clean. The switch
// uses the history API, which Next keeps in sync with useSearchParams,
// without a server round trip.

import { usePathname, useSearchParams } from "next/navigation"
import { useCallback } from "react"

export function useUrlTab<T extends string>(tabs: readonly T[], param = "tab"): [T, (tab: string) => void] {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const asked = searchParams.get(param)
  const tab = tabs.find((t) => t === asked) ?? tabs[0]

  const setTab = useCallback(
    (next: string) => {
      const query = new URLSearchParams(searchParams.toString())
      if (next === tabs[0]) query.delete(param)
      else query.set(param, next)
      const search = query.toString()
      window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname)
    },
    [pathname, searchParams, tabs, param],
  )
  return [tab, setTab]
}
