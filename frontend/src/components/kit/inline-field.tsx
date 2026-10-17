"use client"

// One value cell of a detail grid, in its two in-place states. InlineValue
// shows the value with Copy and, for an editable field, a pencil; both appear
// on hover (or keyboard focus) where there is a mouse, and stay visible on a
// touch screen. InlineEditor is the field opened by its pencil: the kit input,
// focused, with its own Save/Cancel and the refusal right under it (an issue
// on this field as the input's own error, announced through a live region
// since the kit's error line has none; the rest named by label). Both live
// inside the ra-core context (KitContext); the editor inside the page's Form.

import { useMemo } from "react"
import { PencilIcon } from "lucide-react"
import { SaveButton } from "shadcn-admin-kit"

import { Button } from "@/components/ui/button"
import type { FieldMetadata, Row } from "@/lib/cube"
import { CHECK_FIELDS, escapeCancels, shownRefusalOf, type Refusal } from "@/lib/kit-form"
import { CopyButton } from "./copy-button"
import { FieldValue } from "./field-value"
import { FieldInputCell } from "./field-input-cell"
import { FieldRefusals } from "./field-refusals"
import { FocusOnMount } from "./focus-on-mount"

// The icons never cover the value. With a mouse they sit in a gutter the
// value keeps free on its right (28px each, so the gutter stays narrow) and
// appear on hover or keyboard focus, so showing them moves nothing. On a touch
// screen they follow the value inline, always visible, 36px for a finger; the
// negative margin keeps them from making the row taller.
const ACTIONS =
  "-my-2 ml-1 inline-flex align-middle pointer-fine:absolute pointer-fine:top-1/2 pointer-fine:right-0 pointer-fine:m-0 pointer-fine:-translate-y-1/2 pointer-fine:opacity-0 pointer-fine:group-hover/value:opacity-100 pointer-fine:focus-within:opacity-100"
const ICON = "size-9 shrink-0 cursor-pointer text-muted-foreground pointer-fine:size-7"

export function InlineValue({
  field,
  record,
  text,
  onEdit,
}: {
  field: FieldMetadata
  record: Row
  text: string | null
  // Absent when the field cannot be edited now (read-only, mock, demo, or
  // another draft is open).
  onEdit?: () => void
}) {
  return (
    <div className="group/value relative min-h-5 break-words pointer-fine:pr-14">
      <FieldValue field={field} record={record} text={text} />
      {(text !== null || onEdit) && (
        <span className={ACTIONS}>
          {text !== null && <CopyButton label={field.label} text={text} className={ICON} />}
          {onEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ICON}
              aria-label={`Edit ${field.label}`}
              data-edit-field={field.name}
              onClick={onEdit}
            >
              <PencilIcon aria-hidden />
            </Button>
          )}
        </span>
      )}
    </div>
  )
}

// Escape cancels this draft, except while its save is pending (like the
// disabled buttons).
export function InlineEditor({
  field,
  fields,
  refusal,
  pending,
  onCancel,
}: {
  field: FieldMetadata
  // The cube's fields, for the labels of issues on other fields.
  fields: readonly FieldMetadata[]
  refusal: Refusal | null
  pending: boolean
  onCancel: () => void
}) {
  const shown = useMemo(() => refusal && shownRefusalOf(refusal, [field], fields), [refusal, field, fields])
  // One input: its own error says it all, so no "check the fields" line.
  const message = shown && shown.message !== CHECK_FIELDS ? shown.message : null
  return (
    <FocusOnMount
      className="flex min-w-0 flex-col gap-2"
      onKeyDown={(e) => {
        if (escapeCancels(e.key, pending)) {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <div aria-live="polite">
        <FieldInputCell field={field} />
      </div>
      <FieldRefusals fieldErrors={shown?.fieldErrors} />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <SaveButton label="Save" disabled={pending} />
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </FocusOnMount>
  )
}
