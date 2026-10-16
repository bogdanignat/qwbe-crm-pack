"use client"

// A field with a list of values (metadata `enum`), edited as a select inside a
// ra-core form. Built on ra-core's useInput, the kit's form field parts and
// the project's Select, because the kit's SelectInput neither shows its
// validation error nor lets the form focus it on a refused save. A stored
// value the list lacks stays first in the list, shown as-is (selectChoicesOf).

import { useRef } from "react"
import { useInput, type Validator } from "ra-core"
import { useFormContext } from "react-hook-form"
import { FormControl, FormError, FormField, FormLabel } from "shadcn-admin-kit"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { FieldMetadata } from "@/lib/cube"
import { selectChoicesOf } from "@/lib/select-choices"

// Radix refuses an empty item value: the "no value" choice uses this one.
const CLEAR = "__clear__"

export function EnumSelectInput({
  field,
  validate,
  required,
}: {
  field: FieldMetadata
  validate?: Validator
  required?: boolean
}) {
  const { id, field: input } = useInput({ source: field.name, validate })
  const { ref, name, onChange, onBlur } = input
  const { defaultValues } = useFormContext().formState
  const value = input.value === null || input.value === undefined ? "" : String(input.value)
  const choices = selectChoicesOf(field.enum ?? [], defaultValues?.[field.name], value)
  // Opening the list moves the focus into it: that is not leaving the field,
  // so the check runs when the list closes or the trigger really loses focus.
  const open = useRef(false)

  return (
    <FormField id={id} name={name} className="w-full min-w-0">
      <FormLabel>{field.label}</FormLabel>
      <Select
        value={value}
        onValueChange={(next) => onChange(next === CLEAR ? "" : next)}
        onOpenChange={(isOpen) => {
          open.current = isOpen
          if (!isOpen) onBlur()
        }}
      >
        <FormControl>
          <SelectTrigger
            ref={ref}
            aria-required={required || undefined}
            onBlur={() => !open.current && onBlur()}
            className="h-9 w-full min-w-0 rounded-md text-base md:text-sm"
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {!required && field.nullable && <SelectItem value={CLEAR}>—</SelectItem>}
          {choices.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FormError />
    </FormField>
  )
}
