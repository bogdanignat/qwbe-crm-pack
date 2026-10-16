"use client"

// The columns one list shows (lib/list-columns.ts): an applied saved view's,
// else the reader's pick (kept in this browser), else the caller's defaults
// trimmed by the Settings hide-list. While a view is active the picker edits
// the view's columns (so "Save view" stores what is on screen) and "Reset
// columns" returns to the view's own; the reader's pick is left alone. Only
// with no view active does Reset clear the pick.

import { useEffect, useMemo, useState } from "react"

import { columnsFromFields, type CubeMetadata } from "@/lib/cube"
import { readPrefs } from "@/lib/field-prefs"
import {
  columnsNamed,
  defaultColumnNamesOf,
  readColumnChoice,
  toggledColumns,
  writeColumnChoice,
} from "@/lib/list-columns"

export type ListColumns = ReturnType<typeof useListColumns>

export function useListColumns(cube: string, meta: CubeMetadata | null, defaults?: readonly string[]) {
  const [hidden, setHidden] = useState<string[]>([])
  const [choice, setChoice] = useState<string[] | null>(null)
  // The active view (null: none), its own columns, and the picker's edits to them.
  const [view, setView] = useState<{ columns: string[] | null } | null>(null)
  const [viewColumns, setViewColumns] = useState<string[] | null>(null)
  // localStorage exists on the client only, and the first render must agree
  // with the server's: read after mount.
  useEffect(() => {
    const t = setTimeout(() => {
      setHidden(readPrefs(cube).hidden)
      setChoice(readColumnChoice(cube))
    }, 0)
    return () => clearTimeout(t)
  }, [cube])

  const all = useMemo(() => (meta ? columnsFromFields(meta.fields) : []), [meta])
  const names = viewColumns ?? choice ?? defaultColumnNamesOf(all, defaults, hidden)
  const key = names.join("|")
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `names`
  const columns = useMemo(() => columnsNamed(all, names), [all, key])
  const title = meta?.fields.find((f) => f.required)?.name

  const pick = (name: string, on: boolean) => {
    const next = toggledColumns(names, name, on, title)
    if (view) return setViewColumns(next)
    setChoice(next)
    writeColumnChoice(cube, next)
  }

  const reset = () => {
    if (view) return setViewColumns(view.columns)
    setChoice(null)
    writeColumnChoice(cube, null)
  }

  // A view applied (its columns may be null: it keeps the list's own), or none.
  const applyView = (columns: string[] | null | undefined) => {
    setView(columns === undefined ? null : { columns })
    setViewColumns(columns ?? null)
  }

  return { all, names, columns, title, pick, reset, applyView }
}
