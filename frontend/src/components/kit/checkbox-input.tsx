"use client"

// A boolean field inside a ra-core form: a checkbox, as vtiger shows it, the
// same control the read-only (mock) booleans use. The form value is a real
// boolean (initialValuesOf).

import { useInput } from "ra-core"
import { FormControl, FormError, FormField, FormLabel } from "shadcn-admin-kit"

import { Checkbox } from "@/components/ui/checkbox"
import type { FieldMetadata } from "@/lib/cube"

export function CheckboxInput({ field }: { field: FieldMetadata }) {
  const { id, field: input } = useInput({ source: field.name })
  const { ref, name, value, onChange, onBlur } = input
  return (
    <FormField id={id} name={name}>
      <div className="flex min-h-9 items-center gap-2">
        <FormControl>
          <Checkbox
            ref={ref}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            onBlur={onBlur}
          />
        </FormControl>
        <FormLabel>{field.label}</FormLabel>
      </div>
      <FormError />
    </FormField>
  )
}
