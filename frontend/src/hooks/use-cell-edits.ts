"use client"

// Inline editing in a list: the one cell open at a time, and the refusal
// qwbe gave a cell, shown in it until a save succeeds. Errors belong to the
// query they were made under: a new page, sort or filter drops them.

import { useState } from "react"

import { apiFetch, recordApiPath, saveCell, type FieldMetadata, type Row } from "@/lib/cube"

export type EditState = { id: string; field: string; value: string }
export type CellEdits = ReturnType<typeof useCellEdits>

export function useCellEdits(
  cube: string,
  queryKey: string,
  onSaved: (id: string, field: FieldMetadata, value: unknown) => void,
) {
  const [edit, setEdit] = useState<EditState | null>(null)
  const [errors, setErrors] = useState<{ key: string; byCell: Record<string, string> }>({ key: queryKey, byCell: {} })
  const byCell = errors.key === queryKey ? errors.byCell : {}
  // After the save's await: the state of that moment, not of the render. An
  // answer for a query no longer in view lands under its old key, unseen.
  const setCell = (cell: string, message: string | null) =>
    setErrors((current) => {
      const next = { ...(current.key === queryKey ? current.byCell : {}) }
      if (message === null) delete next[cell]
      else next[cell] = message
      return { key: queryKey, byCell: next }
    })

  const save = async (row: Row, field: FieldMetadata, next: string) => {
    setEdit(null)
    const id = String(row.id)
    const rowPath = recordApiPath(cube, id)
    if (!rowPath) return
    // saveCell derives the pre-edit value itself, so a custom field emptied
    // to "" is a real change and reaches qwbe.
    const result = await saveCell({ rowPath, row, field, next, doFetch: apiFetch })
    if (result.status === "saved") {
      onSaved(id, field, result.value)
      setCell(`${id}:${field.name}`, null)
    } else if (result.status === "refused") {
      setCell(`${id}:${field.name}`, result.message)
    }
  }

  return { edit, setEdit, errorOf: (id: string, field: string) => byCell[`${id}:${field}`], save }
}
