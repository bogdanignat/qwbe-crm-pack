"use client"

// False until the client has hydrated. Before that, a click on a rendered
// button can land on DOM that hydration is about to replace (a trusted click,
// handler attached, React still not running it), so an editable list cell
// renders as plain text until this turns true, after the first paint.

import { useEffect, useState } from "react"

export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 0)
    return () => clearTimeout(t)
  }, [])
  return hydrated
}
