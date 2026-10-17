// A form field's label: vtiger's red asterisk before a field the metadata
// marks required (with "required" for screen readers), the label, and the
// MOCK marker.

import { FieldMarker } from "@/components/field-marker"
import type { FieldMetadata } from "@/lib/cube"
import { fieldMarkerOf } from "@/lib/field-marker"

export function FormFieldLabel({ field }: { field: FieldMetadata }) {
  const { required } = field
  const marker = fieldMarkerOf(field)
  return (
    <>
      {required && (
        <span aria-hidden className="mr-0.5 text-destructive">
          *
        </span>
      )}
      {field.label}
      {required && <span className="sr-only"> (required)</span>}
      {marker && <FieldMarker marker={marker} />}
    </>
  )
}
