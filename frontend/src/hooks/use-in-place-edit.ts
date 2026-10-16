"use client"

// In-place editing of one record (QWB-53 / QWB-54), shared by the detail
// renderers: Edit opens every editable field ("all"), a pencil opens exactly
// one. The form mounts on open, so its defaults are the values shown at that
// moment, and unmounts on Save or Cancel, which is what discards a draft. A
// refusal keeps it mounted with qwbe's own message. Only the fields in scope
// can change or travel: the PATCH carries the changed, coerced keys alone.
// Needs the ra-core context (KitContext).

import { useMemo, useState } from "react"
import { useUpdate } from "ra-core"
import { toast } from "sonner"

import type { FieldMetadata, Row } from "@/lib/cube"
import {
  changedPayloadOf,
  fieldsInEditOf,
  initialValuesOf,
  refusalTextOf,
  type EditScope,
} from "@/lib/kit-form"

export type InPlaceEdit = ReturnType<typeof useInPlaceEdit>

export function useInPlaceEdit({
  cube,
  id,
  row,
  flatRow,
  editableFields,
}: {
  cube: string
  id: string
  row: Row | undefined
  flatRow: Row | null
  editableFields: readonly FieldMetadata[]
}) {
  const [editing, setEditing] = useState<EditScope>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [update, { isPending }] = useUpdate()
  const fieldsInEdit = useMemo(() => fieldsInEditOf(editableFields, editing), [editableFields, editing])
  const initial = useMemo(
    () => (flatRow ? initialValuesOf(fieldsInEdit, flatRow) : {}),
    [fieldsInEdit, flatRow],
  )

  // Opening a draft drops any refusal left by an earlier one (a save that
  // answered after its form was already closed), so it cannot surface under
  // the wrong field.
  function open(scope: Exclude<EditScope, null>) {
    setRefusal(null)
    setEditing(scope)
  }

  function cancel() {
    const closed = editing
    setRefusal(null)
    setEditing(null)
    // Focus goes back to the pencil that opened a single field (it re-renders
    // after the state change, hence the frame delay).
    if (closed && closed !== "all") {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-edit-field="${CSS.escape(closed)}"]`)?.focus()
      })
    }
  }

  async function onSubmit(values: Record<string, string | boolean>) {
    const { payload, missing } = changedPayloadOf(fieldsInEdit, initial, values)
    if (missing.length > 0) {
      setRefusal(`Required: ${missing.join(", ")}`)
      return
    }
    if (Object.keys(payload).length === 0) {
      cancel()
      return
    }
    try {
      // Pessimistic through ra-core so the getOne cache -- and the page --
      // shows what qwbe actually stored (custom values fold into `custom`).
      await update(
        cube,
        { id, data: payload, previousData: row },
        { returnPromise: true, mutationMode: "pessimistic" },
      )
      toast.success("Saved")
      cancel()
    } catch (e: unknown) {
      setRefusal(refusalTextOf(e, fieldsInEdit))
    }
  }

  return { editing, refusal, isPending, initial, open, cancel, onSubmit }
}
