"use client"

// While a form holds unsaved changes, leaving asks first: closing or reloading
// the tab (beforeunload, the browser's own prompt) and following a link inside
// the app (a capture-phase click on <a href>, before Next's Link sees it). The
// browser's Back button is not covered: the App Router has no hook for it.

import { useEffect } from "react"

export const LEAVE_PROMPT = "Leave this page? Your changes are not saved."

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!link || link.getAttribute("target") === "_blank" || link.getAttribute("href")?.startsWith("#")) return
      if (window.confirm(LEAVE_PROMPT)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [dirty])
}
