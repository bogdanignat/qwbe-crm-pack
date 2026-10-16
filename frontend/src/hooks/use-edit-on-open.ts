"use client"

// "Edit" from a list row opens the record's page in edit mode (?edit=all,
// lib/edit-link.ts): once the record can be edited, the draft opens and
// the parameter leaves the URL, so a reload shows the record, not a form. A
// record that cannot be edited (a demo one) just drops the parameter. The URL
// is rewritten from its current state (lib/url-query.ts): opening the draft
// switches the tab too, and neither write may undo the other.

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"

import { EDIT_ALL_PARAM } from "@/lib/edit-link"
import { replaceUrlQuery } from "@/lib/url-query"

export function useEditOnOpen(ready: boolean, canEditAll: boolean, openAll: () => void) {
  const asked = useSearchParams().get(EDIT_ALL_PARAM) === "all"
  const done = useRef(false)

  useEffect(() => {
    if (!asked || !ready || done.current) return
    done.current = true
    if (canEditAll) openAll()
    replaceUrlQuery((query) => query.delete(EDIT_ALL_PARAM))
  }, [asked, ready, canEditAll, openAll])
}
