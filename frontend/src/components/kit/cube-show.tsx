"use client"

// The reusable kit-based detail and in-place edit renderer (QWB-53 / QWB-54,
// merged): the SAME component renders Contacts and Organizations. One entity
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

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { CopyIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

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
  apiFetch,
  canEdit,
  groupFields,
  hrefForRelation,
  metadataApiPath,
  titleOf,
  type CubeMetadata,
  type FieldGroupSpec,
  type FieldMetadata,
  type FieldSection,
  type Row,
  requestFailure,
  valueTextOf,
} from "@/lib/cube.ts"
import { withMockFields } from "@/mock/organizations"
import { withOrganizationLabels } from "@/lib/organization-labels"
import { MockTag } from "@/components/mock-tag"
import {
  changedPayloadOf,
  copyText,
  displayRowOf,
  escapeCancels,
  fieldsInEditOf,
  initialValuesOf,
  type EditScope,
} from "@/lib/kit-form.ts"
import { cn } from "@/lib/utils"
import { KitFieldInput } from "./field-input"
import { relationRefsOf } from "@/lib/relation-batch.ts"
import { useRelationTitles } from "@/hooks/use-relation-titles"
import { Form, RecordContextProvider, useGetOne, useUpdate } from "ra-core"

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
  const [meta, setMeta] = useState<CubeMetadata | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const {
    data: row,
    error: rowError,
  } = useGetOne(cube, { id })

  useEffect(() => {
    let alive = true
    apiFetch(metadataApiPath(cube))
      .then(async (r) => {
        if (!r.ok) throw await requestFailure("metadata", r)
        return withOrganizationLabels(withMockFields((await r.json()) as CubeMetadata))
      })
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [cube])

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

  // In-place editing: the form mounts when Edit (all fields) or a pencil (one
  // field) is pressed, so its defaults are the values shown at that moment,
  // and unmounts on Save or Cancel, which is what discards unsaved drafts. A
  // refusal leaves it mounted. Only the fields in scope can change or travel.
  const [editing, setEditing] = useState<EditScope>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [update, { isPending }] = useUpdate()
  const fieldsInEdit = useMemo(() => fieldsInEditOf(editableFields, editing), [editableFields, editing])
  const initial = useMemo(
    () => (flatRow ? initialValuesOf(fieldsInEdit, flatRow) : {}),
    [fieldsInEdit, flatRow],
  )

  // Opening a draft drops any refusal left by an earlier one (a save that
  // answered after its form was already closed), so it cannot surface under
  // the wrong field.
  function open(scope: Exclude<EditScope, null>) {
    setRefusal(null)
    setEditing(scope)
  }

  function cancel() {
    const closed = editing
    setRefusal(null)
    setEditing(null)
    // Focus goes back to the pencil that opened a single field (it re-renders
    // after the state change, hence the frame delay).
    if (closed && closed !== "all") {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-edit-field="${CSS.escape(closed)}"]`)?.focus()
      })
    }
  }

  async function onSubmit(values: Record<string, string | boolean>) {
    const { payload, missing } = changedPayloadOf(fieldsInEdit, initial, values)
    if (missing.length > 0) {
      setRefusal(`Required: ${missing.join(", ")}`)
      return
    }
    if (Object.keys(payload).length === 0) {
      cancel()
      return
    }
    try {
      // Pessimistic through ra-core so the getOne cache -- and this page --
      // shows what qwbe actually stored (custom values fold into `custom`).
      await update(
        cube,
        { id, data: payload, previousData: row as Row },
        { returnPromise: true, mutationMode: "pessimistic" },
      )
      toast.success("Saved")
      cancel()
    } catch (e: unknown) {
      setRefusal(refusalTextOf(e, fieldsInEdit))
    }
  }

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
        const text = textOf(field, record, resolveTitle)
        return (
          <span className="flex items-center gap-1">
            <span className="min-w-0 flex-1">{showValueOf(field, record, text)}</span>
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
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader className="border-b">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Record details</p>
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

// Moves keyboard focus to the first focusable control inside on mount, so a
// field opened with the pencil is ready to type into (the kit inputs do not
// take an autoFocus prop).
function FocusOnMount({ children, ...rest }: React.ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea, [role=combobox], button")?.focus()
  }, [])
  return (
    <div ref={ref} {...rest}>
      {children}
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

// The refusal shown on the form: qwbe's own message, followed by each
// per-field issue the provider mapped (HttpError body.errors) under the
// field's label, so the user learns WHICH input was refused.
function refusalTextOf(e: unknown, fields: readonly FieldMetadata[]): string {
  const message = e instanceof Error ? e.message : String(e)
  const errors = (e as { body?: { errors?: Record<string, string> } }).body?.errors ?? {}
  const details = Object.entries(errors).map(([name, text]) => {
    const label = fields.find((f) => f.name === name)?.label ?? name
    return `${label}: ${text}`
  })
  return details.length > 0 ? `${message} (${details.join("; ")})` : message
}

// A discreet copy action next to a value: named for screen readers, sized
// for a finger (36px), never enters edit mode, reports a clipboard refusal
// (no Clipboard API on an insecure origin, denied permission) instead of
// failing silently.
function CopyButton({ label, text }: { label: string; text: string }) {
  async function copy() {
    const failure = await copyText(text)
    if (failure === null) toast.success(`${label} copied`)
    else toast.error(`Copy failed: ${failure}`)
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-9 shrink-0 text-muted-foreground"
      aria-label={`Copy ${label}`}
      onClick={copy}
    >
      <CopyIcon aria-hidden />
    </Button>
  )
}

// The displayed text of one field in the flattened row, or null when empty:
// a relation shows the target's title resolved through the relation metadata,
// a boolean yes/no, anything else its text. This is exactly what Copy copies.
type ResolveTitle = (target: string, id: string) => string | null

function textOf(field: FieldMetadata, record: Row, resolveTitle: ResolveTitle): string | null {
  const value = record[field.name]
  if (value === null || value === undefined || value === "") return null
  if (field.relation) {
    const id = String(value)
    return resolveTitle(field.relation.target, id) ?? id
  }
  if (field.type === "boolean") return value ? "yes" : "no"
  return valueTextOf(value)
}

// The rendered value: the text, linked to the target's page for a relation
// when this app has a route for it (Next's Link -- the organization relation
// keeps its navigation), a dash when empty.
function showValueOf(field: FieldMetadata, record: Row, text: string | null): React.ReactNode {
  if (text === null) return "—"
  const href = field.relation ? hrefForRelation(field.relation.target, String(record[field.name])) : null
  return href ? (
    <Link className="underline" href={href}>
      {text}
    </Link>
  ) : (
    text
  )
}
