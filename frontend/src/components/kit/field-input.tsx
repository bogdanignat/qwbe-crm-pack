"use client"

// The one kit input per editable field, derived from the metadata alone --
// the same classifier the list's inline editor uses (renderKindOf): an enum
// is a select (EnumSelectInput), every boolean a checkbox (CheckboxInput), an
// integer or number a TextInput of type number, a declared relation the kit's
// ReferenceInput + AutocompleteInput, everything else a TextInput. The kit's
// own inputs where they show errors and take focus; the two exceptions are
// built on its form field parts. Used by the in-place form of the
// reusable detail renderer (cube-show.tsx) for every entity.

import { useEffect, useState } from "react"
import type { Validator } from "ra-core"
import { useFormContext } from "react-hook-form"
import { AutocompleteInput, ReferenceInput, TextInput } from "shadcn-admin-kit"

import { relationMeta, renderKindOf, type CubeMetadata, type FieldMetadata } from "@/lib/cube.ts"
import { editedFieldError, fieldError } from "@/lib/validators.ts"
import { CheckboxInput } from "./checkbox-input"
import { EnumSelectInput } from "./enum-select-input"

// A caller may ask for a text area, add a hint under the input, or check the
// value even unchanged (a create form: its defaults are not a stored record).
export type KitFieldOptions = { multiline?: boolean; helperText?: string; checkUnchanged?: boolean }

export function KitFieldInput({ field, options = {} }: { field: FieldMetadata; options?: KitFieldOptions }) {
  const { formState } = useFormContext()
  // The one client check of every form, full or inline (lib/validators.ts);
  // an edit checks only what the user changed from the form's defaults.
  const validate: Validator = (value) =>
    (options.checkUnchanged
      ? fieldError(field, value)
      : editedFieldError(field, value, formState.defaultValues?.[field.name])) ?? undefined

  if (field.relation) {
    // The metadata guarantees a declared target once relation is set.
    return <RelationFieldInput field={field as RelationFieldMetadata} validate={validate} />
  }

  if (renderKindOf(field) === "select") {
    return <EnumSelectInput field={field} validate={validate} required={field.required} />
  }
  // Every boolean, the cube's too: its form value is already a boolean
  // (initialValuesOf). The list cell keeps renderKindOf's text editing for a
  // cube boolean.
  if (field.type === "boolean") return <CheckboxInput field={field} />
  // A number edits in a native number input; the value stays a string in the
  // form and is coerced by type on save (coerce), so a cleared nullable
  // number still travels as null, not 0.
  const numeric = field.type === "integer" || field.type === "number"
  const input = (
    <TextInput
      source={field.name}
      label={field.label}
      validate={validate}
      multiline={options.multiline}
      aria-description={options.helperText}
      aria-required={field.required || undefined}
      type={numeric ? "number" : undefined}
      step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
    />
  )
  // The hint is rendered here: the kit's TextInput leaks its helperText prop
  // onto the DOM input.
  if (!options.helperText) return input
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {input}
      <p className="text-sm text-muted-foreground">{options.helperText}</p>
    </div>
  )
}

// A declared relation edits with the kit's reference picker: the choices come
// from the data provider's getList on the target cube (the `q` filter scans
// exactly the fields the target's manifest declares searchable), the current
// value's title from getOne. The title field is the target's own metadata
// title (the same derivation every relation surface uses), fetched once per
// session.
export type RelationFieldMetadata = FieldMetadata & {
  relation: { target: string; entity: string; summary: string | null }
}

export function RelationFieldInput({
  field,
  validate,
}: {
  field: RelationFieldMetadata
  validate: unknown
}) {
  const [targetMeta, setTargetMeta] = useState<CubeMetadata | null>(null)
  useEffect(() => {
    let alive = true
    relationMeta(field.relation.target).then((meta) => {
      if (alive) setTargetMeta(meta)
    })
    return () => {
      alive = false
    }
  }, [field.relation.target])

  // The target metadata's title field: the first required field, or nothing
  // (AutocompleteInput then falls back to the record representation).
  const titleField = targetMeta?.fields.find((f) => f.required)
  return (
    <ReferenceInput source={field.name} reference={field.relation.target}>
      <AutocompleteInput
        label={field.label}
        validate={validate as never}
        optionText={titleField ? titleField.name : "id"}
        // An empty input on a nullable relation means "unlink"; qwbe refuses
        // an empty string on a non-nullable one with its own message.
        parse={(value: string) => (value === "" ? null : value)}
      />
    </ReferenceInput>
  )
}
