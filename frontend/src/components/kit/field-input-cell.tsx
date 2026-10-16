// The kit input of one field inside a grid that already shows the label: the
// input's own label stays for screen readers only.

import { KitFieldInput, type KitFieldOptions } from "./field-input"
import type { FieldMetadata } from "@/lib/cube"

export function FieldInputCell({ field, options }: { field: FieldMetadata; options?: KitFieldOptions }) {
  return (
    <div className="min-w-0 [&_[data-slot=form-label]]:sr-only">
      <KitFieldInput field={field} options={options} />
    </div>
  )
}
