"use client"

// The one organization form (spec §4.5): create, Duplicate and the detail's
// Edit all. vtiger's blocks and field order (as on the detail page), two
// columns that fold to one on a phone, Save / Cancel above and below. Editable
// fields use the kit inputs, which run the generic metadata check
// (lib/validators.ts) on blur and on submit: every value on create, what the
// user changed on Edit. A failed submit focuses the first invalid field; a
// backend refusal puts its per-field issues under the inputs (the first one
// focused) and announces the rest above. Mock fields show disabled, with
// their marker, and are never sent. Needs the ra-core context (KitContext).

import { useMemo } from "react"
import { Form } from "ra-core"
import { useFormState } from "react-hook-form"

import { FieldGrid } from "@/components/field-grid"
import { FormBlock } from "@/components/form-block"
import { FormFieldLabel } from "@/components/form-field-label"
import { FieldInputCell } from "@/components/kit/field-input-cell"
import { FieldRefusals } from "@/components/kit/field-refusals"
import type { KitFieldOptions } from "@/components/kit/field-input"
import { ReadOnlyField } from "@/components/read-only-field"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { canEdit, type FieldMetadata, type Row } from "@/lib/cube"
import { fieldTextOf, shownRefusalOf, type Refusal } from "@/lib/kit-form"
import { editableFieldsOf, formBlocksOf, MULTILINE_FIELDS, type FormValues } from "@/lib/organization-form"
import { ADDRESS_BLOCK_TITLE } from "@/lib/organization-layout"
import { CopyAddressActions } from "./copy-address-actions"
import { FormActions } from "./form-actions"

// One object for "no hints", so the options memo is not rebuilt on every render.
const NO_HINTS: Readonly<Record<string, string>> = {}
// The form resolves no relation titles: only read-only fields go through
// fieldTextOf; an editable (custom) relation field gets FieldInputCell.
const noTitle = () => null

// Off once the record is saved, so leaving for it never asks.
function UnsavedChangesGuard({ saved }: { saved: boolean }) {
  useUnsavedChanges(useFormState().isDirty && !saved)
  return null
}

export function OrganizationForm({
  fields,
  defaultValues,
  record,
  hints = NO_HINTS,
  onSubmit,
  onCancel,
  pending,
  refusal,
  saved = false,
}: {
  // The metadata's fields, the mock ones included.
  fields: readonly FieldMetadata[]
  defaultValues: FormValues
  // The record being edited (flattened), for the values of the read-only
  // fields. Without one the form creates, so it checks every value.
  record?: Row
  // A hint under a field (Organization No on create).
  hints?: Readonly<Record<string, string>>
  onSubmit: (values: FormValues) => void | Promise<void>
  onCancel: () => void
  pending: boolean
  refusal: Refusal | null
  // The save went through: the unsaved-changes prompt is off.
  saved?: boolean
}) {
  const blocks = useMemo(() => formBlocksOf(fields, record), [fields, record])
  const inputs = useMemo(() => editableFieldsOf(blocks), [blocks])
  const shown = useMemo(() => refusal && shownRefusalOf(refusal, inputs, fields), [refusal, inputs, fields])
  const creating = record === undefined
  const options = useMemo(
    () =>
      new Map<string, KitFieldOptions>(
        fields.map((field) => [
          field.name,
          { multiline: MULTILINE_FIELDS.has(field.name), helperText: hints[field.name], checkUnchanged: creating },
        ]),
      ),
    [fields, hints, creating],
  )

  const label = (field: FieldMetadata) => <FormFieldLabel field={field} />
  const value = (field: FieldMetadata) =>
    canEdit(field) ? (
      <FieldInputCell field={field} options={options.get(field.name)} />
    ) : (
      <ReadOnlyField field={field} text={record ? fieldTextOf(field, record, noTitle) : null} />
    )

  return (
    <Form
      defaultValues={defaultValues}
      onSubmit={(values: Record<string, unknown>) => onSubmit(values as FormValues)}
      mode="onBlur"
      noValidate
      className="flex min-w-0 flex-col gap-4"
    >
      <UnsavedChangesGuard saved={saved} />
      <FieldRefusals fieldErrors={shown?.fieldErrors} />
      <FormActions pending={pending} refusal={shown?.message ?? null} onCancel={onCancel} announce />
      {blocks.map((block) => (
        <FormBlock
          key={block.title}
          title={block.title}
          aside={block.title === ADDRESS_BLOCK_TITLE ? <CopyAddressActions fields={fields} /> : undefined}
        >
          <FieldGrid rows={block.rows} label={label} value={value} />
        </FormBlock>
      ))}
      <FormActions pending={pending} refusal={shown?.message ?? null} onCancel={onCancel} announce={false} />
    </Form>
  )
}
