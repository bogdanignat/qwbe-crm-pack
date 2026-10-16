"use client"

// The "Organization Information" tab: vtiger's collapsible blocks of label /
// value rows, with in-place editing. Edit (the header button) turns every
// editable value into its input under one Save / Cancel bar; a pencil opens a
// single field. Fields the backend does not publish yet are marked (MOCK for
// the cube, CUSTOM for a future custom field) and never editable.

import { Form } from "ra-core"
import { SaveButton } from "shadcn-admin-kit"

import { CollapsibleBlock } from "@/components/collapsible-block"
import { FieldGrid } from "@/components/field-grid"
import { FieldInputCell } from "@/components/kit/field-input-cell"
import { InlineEditor, InlineValue } from "@/components/kit/inline-field"
import { FieldMarker } from "@/components/field-marker"
import { Button } from "@/components/ui/button"
import type { InPlaceEdit } from "@/hooks/use-in-place-edit"
import type { FieldMetadata, Row } from "@/lib/cube"
import type { FieldBlock } from "@/lib/field-blocks"
import { fieldMarkerOf } from "@/lib/field-marker"
import { fieldTextOf, type ResolveTitle } from "@/lib/kit-form"

export function OrganizationInfo({
  blocks,
  record,
  edit,
  editable,
  resolveTitle,
}: {
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
    if (editing === "all" && editable(field)) return <FieldInputCell field={field} />
    if (editing === field.name) {
      return <InlineEditor field={field} refusal={edit.refusal} pending={edit.isPending} onCancel={edit.cancel} />
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

  // One form for both scopes; the key remounts it on a scope change, which
  // resets its defaults to the values shown at that moment.
  return (
    <Form key={editing} defaultValues={edit.initial} onSubmit={edit.onSubmit} className="flex min-w-0 flex-col gap-4">
      {editing === "all" && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background p-2">
          {edit.refusal && (
            <p role="alert" className="mr-auto text-sm text-destructive">
              {edit.refusal}
            </p>
          )}
          {/* label spelled out: without an i18n provider the kit's default
              "ra.action.save" key would render verbatim. */}
          <SaveButton label="Save" disabled={edit.isPending} />
          <Button type="button" variant="outline" disabled={edit.isPending} onClick={edit.cancel}>
            Cancel
          </Button>
        </div>
      )}
      {content}
    </Form>
  )
}
