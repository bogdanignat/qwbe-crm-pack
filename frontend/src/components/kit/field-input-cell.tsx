// The kit input of one field inside a grid that already shows the label: the
// input's own label stays for screen readers only.

import { KitFieldInput } from "./field-input"
import type { FieldMetadata } from "@/lib/cube"

export function FieldInputCell({ field }: { field: FieldMetadata }) {
  return (
    <div className="min-w-0 [&_[data-slot=form-label]]:sr-only">
      <KitFieldInput field={field} />
    </div>
  )
}
