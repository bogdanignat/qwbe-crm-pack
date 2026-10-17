"use client"

// The reusable kit-based detail and in-place edit renderer (QWB-53 / QWB-54,
// merged), used by Contacts (Organizations has its vtiger layout in
// components/organizations, built from the same pieces). One entity
// page supplies only its field grouping by name; everything else -- labels,
// values, editability, relation links, runtime custom fields, the title --
// comes from the published cube metadata and the row. The frame, card, field
// display and buttons are REAL shadcn-admin-kit 1.0.7 components; navigation
// between pages stays with Next's router.
//
// The row is loaded through the ra-core data provider (getOne) inside the
// KitContext; the metadata is the app's own published-metadata request, the
// same one every other surface uses. Read mode shows each value with a Copy
// action; the Edit button turns the SAME page into a form (same URL, no
// navigation) with the kit inputs in their sections and one Save/Cancel pair.
// A field the metadata marks non-editable is displayed in both modes and
// never becomes an input. Save PATCHes only the changed fields through the
// provider; a refusal keeps the drafts on screen with qwbe's own message.
// A pencil next to Copy opens ONE field in place (same form, same save path,
// only that field can change); while a single-field draft is open the Edit
// button and the other pencils are hidden, so a draft is never mixed with
// "Edit all" or dropped silently. Escape cancels the single-field draft.

import { useMemo } from "react"
import { PencilIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RecordField,
  SaveButton,
  Skeleton,
  Button,
} from "shadcn-admin-kit"

import {
  canEdit,
  groupFields,
  titleOf,
  type FieldGroupSpec,
  type FieldMetadata,
  type FieldSection,
  type Row,
} from "@/lib/cube.ts"
import { MockTag } from "@/components/mock-tag"
import { displayRowOf, escapeCancels, fieldTextOf } from "@/lib/kit-form.ts"
import { cn } from "@/lib/utils"
import { KitFieldInput } from "./field-input"
import { CopyButton } from "./copy-button"
import { FieldValue } from "./field-value"
import { FocusOnMount } from "./focus-on-mount"
import { relationRefsOf } from "@/lib/relation-batch.ts"
import { useCubeMetadata } from "@/hooks/use-cube-metadata"
import { useEditOnOpen } from "@/hooks/use-edit-on-open"
import { useInPlaceEdit } from "@/hooks/use-in-place-edit"
import { useRelationTitles } from "@/hooks/use-relation-titles"
import { Form, RecordContextProvider, useGetOne } from "ra-core"

export function CubeKitShow({
  cube,
  id,
  groups,
  demo = false,
}: {
  cube: string
  id: string
  // A demo record (mockup data): marked, and read-only -- no Edit, no pencils.
  demo?: boolean
  // Fieldsets by field NAME (lib/cube.ts groupFields); leftovers and custom
  // fields get their own sections, so nothing published is hidden.
  groups: readonly FieldGroupSpec[]
}) {
  const { meta, error: loadError } = useCubeMetadata(cube)
  const {
    data: row,
    error: rowError,
  } = useGetOne(cube, { id })

  const error = loadError ?? (rowError ? String((rowError as Error).message) : null)

  // Relation titles resolve in one batch per target cube (the same hook the
  // list uses); computed from the same metadata.
  const relationRefs = useMemo(
    () => (meta && row ? relationRefsOf([row as Row], meta.fields) : []),
    [meta, row],
  )
  const resolveTitle = useRelationTitles(relationRefs)

  const sections = useMemo(
    () => (meta ? groupFields(meta.fields, groups) : []),
    [meta, groups],
  )
  const flatRow = useMemo(
    () => (meta && row ? displayRowOf(meta, row as Row) : null),
    [meta, row],
  )
  const editableFields = useMemo(
    () => (demo ? [] : sections.flatMap((s) => s.fields).filter(canEdit)),
    [sections, demo],
  )

  // In-place editing (hooks/use-in-place-edit.ts): Edit opens every editable
  // field, a pencil exactly one; Save PATCHes only the changed keys.
  const { editing, refusal, isPending, initial, open, cancel, onSubmit } = useInPlaceEdit({
    cube,
    id,
    row: row as Row | undefined,
    flatRow,
    editableFields,
  })
  // "edit" from a related list opens the record in edit mode (?edit=all).
  useEditOnOpen(flatRow !== null, editableFields.length > 0, () => open("all"))

  if (error) return <p role="alert">{error}</p>
  if (!meta || !row || !flatRow) return <Skeleton className="h-64 w-full" />

  const shown = (field: FieldMetadata) => (
    <RecordField
      key={field.name}
      source={field.name}
      label={
        <>
          {field.label}
          {field.mock && <MockTag />}
        </>
      }
      className="min-w-0 gap-1 break-words text-sm"
      render={(record: Row) => {
        const text = fieldTextOf(field, record, resolveTitle)
        return (
          <span className="flex items-center gap-1">
            <span className="min-w-0 flex-1">
              <FieldValue field={field} record={record} text={text} />
            </span>
            {text !== null && <CopyButton label={field.label} text={text} />}
            {/* The pencil exists only while no draft is open: an open draft
                must be saved or cancelled before another field or Edit all. */}
            {editing === null && !demo && canEdit(field) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground"
                aria-label={`Edit ${field.label}`}
                data-edit-field={field.name}
                onClick={() => open(field.name)}
              >
                <PencilIcon aria-hidden />
              </Button>
            )}
          </span>
        )
      }}
    />
  )

  // One field open in place: its kit input, focused, with its own Save/Cancel
  // and the refusal right under it. Escape cancels this draft, except while
  // its save is pending (like the disabled buttons).
  const single = (field: FieldMetadata) => (
    <FocusOnMount
      key={field.name}
      className="flex min-w-0 flex-col gap-2"
      onKeyDown={(e) => {
        if (escapeCancels(e.key, isPending)) {
          e.preventDefault()
          cancel()
        }
      }}
    >
      <KitFieldInput field={field} />
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      )}
      <div className="flex items-center gap-2">
        <SaveButton label="Save" disabled={isPending} />
        <Button type="button" variant="outline" disabled={isPending} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </FocusOnMount>
  )

  const fieldsets = (cell: (field: FieldMetadata) => React.ReactNode) =>
    sections.map((section) => <Section key={section.legend} section={section} cell={cell} />)

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader className="border-b">
          <p className="label-mono text-muted-foreground">Record details</p>
          <CardTitle className="text-2xl">
            {titleOf(meta, row as Row)}
            {demo && <MockTag>demo</MockTag>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editing === "all" ? (
            <Form defaultValues={initial} onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {refusal && (
                  <p role="alert" className="mr-auto text-sm text-destructive">
                    {refusal}
                  </p>
                )}
                {/* label spelled out: without an i18n provider the kit's
                    default "ra.action.save" key would render verbatim. */}
                <SaveButton label="Save" disabled={isPending} />
                <Button type="button" variant="outline" disabled={isPending} onClick={cancel}>
                  Cancel
                </Button>
              </div>
              {/* A non-editable field keeps its read-only display inside the
                  form, so the whole record stays visible while editing. */}
              <RecordContextProvider value={flatRow}>
                {fieldsets((field) =>
                  canEdit(field) ? <KitFieldInput key={field.name} field={field} /> : shown(field),
                )}
              </RecordContextProvider>
            </Form>
          ) : editing !== null ? (
            <Form
              // Same form and save path as Edit all, scoped to one field;
              // the same key remount on scope change resets the defaults.
              key={editing}
              defaultValues={initial}
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
            >
              <RecordContextProvider value={flatRow}>
                {fieldsets((field) => (field.name === editing ? single(field) : shown(field)))}
              </RecordContextProvider>
            </Form>
          ) : (
            <>
              {editableFields.length > 0 && (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => open("all")}>
                    Edit
                  </Button>
                </div>
              )}
              <RecordContextProvider value={flatRow}>{fieldsets(shown)}</RecordContextProvider>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// One titled section. The optional emphasis is a border accent PLUS the word
// "Important" in the legend, so it never relies on color alone; it is a
// layout choice of the page, not a fact about the record.
function Section({
  section,
  cell,
}: {
  section: FieldSection
  cell: (field: FieldMetadata) => React.ReactNode
}) {
  return (
    <fieldset
      className={cn("min-w-0 rounded-lg border p-4", section.important && "border-l-4 border-l-primary")}
      aria-label={section.important ? `${section.legend} (important)` : undefined}
    >
      <legend className="flex items-center gap-2 px-2 text-sm font-semibold">
        {section.legend}
        {section.important && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Important
          </span>
        )}
      </legend>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">{section.fields.map(cell)}</div>
    </fieldset>
  )
}
