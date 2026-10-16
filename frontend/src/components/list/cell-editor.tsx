"use client"

// One list cell in edit mode: a select for an enum, a checkbox for a boolean,
// a text input for the rest. Enter saves, Escape leaves.
//
// A click OUTSIDE the editor commits a text value (or dismisses the others),
// caught as a capture pointerdown on the document. Not on blur: a trusted
// click on the edit button queues a browser focus change that can land
// seconds later and would close the editor before anyone types. Radix portals
// (the open select's options) are not "outside": choosing there IS the edit.

import { useEffect, useRef } from "react"

import { renderKindOf, type FieldMetadata } from "@/lib/cube"
import type { EditState } from "@/hooks/use-cell-edits"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Radix forbids an empty-string SelectItem value; "clear" rides on this.
const CLEAR = "__clear__"

export function CellEditor({
  field,
  edit,
  onSave,
  onClose,
}: {
  field: FieldMetadata
  edit: EditState
  onSave: (value: string) => void
  onClose: () => void
}) {
  const kind = renderKindOf(field)
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!root.current || !(target instanceof Node) || root.current.contains(target)) return
      if (target.parentElement?.closest("[data-radix-popper-content-wrapper], [role='listbox']")) return
      const input = root.current.querySelector("input")
      if (kind === "text" && input) onSave(input.value)
      else onClose()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [kind, onSave, onClose])

  return (
    <div ref={root} className="flex flex-col gap-1">
      {kind === "select" ? (
        <Select
          value={edit.value === "" ? CLEAR : edit.value}
          onValueChange={(v) => {
            onClose()
            onSave(v === CLEAR ? "" : v)
          }}
        >
          <SelectTrigger className="w-40" aria-label={field.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* An optional field can be cleared ("not required" is the only signal). */}
            {!field.required && <SelectItem value={CLEAR}>—</SelectItem>}
            {(field.enum ?? []).map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : kind === "checkbox" ? (
        <Checkbox
          autoFocus
          aria-label={field.label}
          checked={edit.value === "true"}
          onCheckedChange={(checked) => {
            onClose()
            onSave(checked ? "true" : "false")
          }}
        />
      ) : (
        <Input
          autoFocus
          defaultValue={edit.value}
          aria-label={field.label}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(e.currentTarget.value)
            if (e.key === "Escape") onClose()
          }}
        />
      )}
    </div>
  )
}
