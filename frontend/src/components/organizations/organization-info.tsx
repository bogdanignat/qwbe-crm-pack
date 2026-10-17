"use client"

// The "Organization Information" tab: vtiger's collapsible blocks of label /
// value rows, with a pencil that edits one field in place. Edit all (the
// header button) is the shared organization form instead (OrganizationForm).
// Fields the backend does not publish yet are marked MOCK and never editable.

import { Form } from "ra-core"

import { CollapsibleBlock } from "@/components/collapsible-block"
import { FieldGrid } from "@/components/field-grid"
import { InlineEditor, InlineValue } from "@/components/kit/inline-field"
import { FieldMarker } from "@/components/field-marker"
import type { InPlaceEdit } from "@/hooks/use-in-place-edit"
import type { FieldMetadata, Row } from "@/lib/cube"
import type { FieldBlock } from "@/lib/field-blocks"
import { fieldMarkerOf } from "@/lib/field-marker"
import { fieldTextOf, type ResolveTitle } from "@/lib/kit-form"

export function OrganizationInfo({
  fields,
  blocks,
  record,
  edit,
  editable,
  resolveTitle,
}: {
  // The metadata's fields, for the labels in a refusal.
  fields: readonly FieldMetadata[]
  blocks: readonly FieldBlock[]
  // The row with its custom values at the top level (displayRowOf).
  record: Row
  edit: InPlaceEdit
  editable: (field: FieldMetadata) => boolean
  resolveTitle: ResolveTitle
}) {
  const { editing } = edit

  const label = (field: FieldMetadata) => {
    const marker = fieldMarkerOf(field)
    return (
      <>
        {field.label}
        {marker && <FieldMarker marker={marker} />}
      </>
    )
  }

  const value = (field: FieldMetadata) => {
    if (editing === field.name) {
      return (
        <InlineEditor
          field={field}
          fields={fields}
          refusal={edit.refusal}
          pending={edit.isPending}
          onCancel={edit.cancel}
        />
      )
    }
    return (
      <InlineValue
        field={field}
        record={record}
        text={fieldTextOf(field, record, resolveTitle)}
        onEdit={editing === null && editable(field) ? () => edit.open(field.name) : undefined}
      />
    )
  }

  const content = blocks.map((block) => (
    <CollapsibleBlock key={block.title} storageKey={`organizations.${block.title}`} title={block.title}>
      <FieldGrid rows={block.rows} label={label} value={value} />
    </CollapsibleBlock>
  ))

  if (editing === null) return <div className="flex min-w-0 flex-col gap-4">{content}</div>

  // The key remounts the form for another field, which resets its defaults
  // to the values shown at that moment.
  return (
    <Form key={editing} defaultValues={edit.initial} onSubmit={edit.onSubmit} className="flex min-w-0 flex-col gap-4">
      {content}
    </Form>
  )
}
