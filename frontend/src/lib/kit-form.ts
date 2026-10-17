// Field-grouping and payload logic for the kit-based renderers (QWB-54).
//
// The kit renderers (components/kit) are reusable: an entity page supplies only
// its field grouping, while labels, types, enums, required flags and custom
// fields come from the published cube metadata -- the same metadata the list,
// detail and inline editor already use. Schema metadata stays authoritative:
// nothing here hard-codes a field of a specific cube.

import { canEdit, coerce, customValueOf, fieldDisplayTextOf, type FieldMetadata, type Row } from "./cube.ts"

// Field grouping lives in cube.ts (groupFields, FieldGroupSpec): ONE
// distribution of the published fields over a page's named sections, with the
// leftovers and the runtime custom fields in their own sections, shared by
// the kit renderer for both entities. Nothing published is ever hidden; a
// non-editable field is displayed, never edited (canEdit).

// A row flattened for display and form defaults: published custom fields move
// from the row's `custom` sub-object to the top level (the same place the form
// and the kit's source-based fields read from). An ORPHAN custom value (one
// whose definition was deleted, or a key added after this frontend was
// written) has no published field and is left out: it never renders and never
// breaks the page.
export function displayRowOf(meta: { fields: FieldMetadata[] }, row: Row): Row {
  const flat: Row = { ...row }
  const custom = row.custom
  if (custom && typeof custom === "object") {
    for (const field of meta.fields) {
      if (!field.custom) continue
      const value = (custom as Row)[field.name]
      if (value !== undefined) flat[field.name] = value
    }
  }
  return flat
}

// Form default values for an edit form: strings for text and enum inputs, a
// real boolean for the checkbox kind (the same classifier the inline editor
// uses). A missing value becomes an empty string; a null stays "" and is
// turned back into null for nullable fields by updatePayloadOf on save.
export function initialValuesOf(
  fields: readonly FieldMetadata[],
  flatRow: Row,
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {}
  for (const field of fields) {
    if (field.type === "boolean") {
      values[field.name] = flatRow[field.name] === true
    } else {
      const value = flatRow[field.name]
      values[field.name] = value === null || value === undefined ? "" : String(value)
    }
  }
  return values
}

// The body of an update request, built from the form's values with the SAME
// coerce the inline editor saves with. A cleared field becomes null when the
// metadata says nullable, is skipped when it does not (a non-nullable field
// cannot carry null, and an empty string would only earn qwbe's refusal). A
// cleared REQUIRED field is never sent: the kit input refuses it before a save.
export function updatePayloadOf(
  fields: readonly FieldMetadata[],
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    // A mock field has no backend column: it never travels in a PATCH.
    if (field.mock) continue
    if (field.type === "boolean") {
      payload[field.name] = values[field.name] === true
      continue
    }
    const value = String(values[field.name] ?? "").trim()
    if (value === "") {
      if (field.nullable && !field.required) payload[field.name] = null
      // ponytail: a non-nullable optional field is skipped, not sent as "",
      // because qwbe would refuse the empty string; if a cube ever needs to
      // send "" on purpose, this is the line to change.
    } else {
      payload[field.name] = coerce(field, value)
    }
  }
  return payload
}

// What the in-place form is editing: nothing, every editable field ("all",
// the Edit button), or exactly one field by name (its pencil). The form's
// defaults, diff and refusal mapping all take the scoped list, so a single
// field draft can never carry or change another field.
export type EditScope = "all" | string | null

export function fieldsInEditOf(
  editable: readonly FieldMetadata[],
  scope: EditScope,
): readonly FieldMetadata[] {
  if (scope === null) return []
  if (scope === "all") return editable
  return editable.filter((f) => f.name === scope)
}

// The in-place form's save body: updatePayloadOf restricted to the fields
// whose value differs from what the form started with, so an untouched field
// is never re-sent (and never re-validated server-side). An unchanged
// required field left empty by the row itself is therefore neither sent nor
// refused: the kit input checks only changed values (editedFieldError).
export function changedPayloadOf(
  fields: readonly FieldMetadata[],
  initial: Record<string, string | boolean>,
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  const changed = fields.filter(
    (field) => String(values[field.name] ?? "").trim() !== String(initial[field.name] ?? "").trim(),
  )
  return updatePayloadOf(changed, values)
}

// Whether a key press closes the single-field draft: Escape, but only while
// no save is in flight. Cancelling under a pending request unmounts the form
// while the request still runs, so a later refusal would land with nothing to
// show it on (the Save/Cancel buttons are disabled for the same reason).
export function escapeCancels(key: string, pending: boolean): boolean {
  return key === "Escape" && !pending
}

// Copies text through the Clipboard API and returns the failure text, or
// null on success. The API is absent outside secure contexts (the lab UI
// reached over plain http by LAN address), where `navigator.clipboard` is
// undefined; that case is reported in words instead of throwing on
// `undefined.writeText`. It does not make copying work there.
export const CLIPBOARD_UNAVAILABLE = "Copy needs https or localhost"

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<string | null> {
  if (!clipboard) return CLIPBOARD_UNAVAILABLE
  try {
    await clipboard.writeText(text)
    return null
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e)
  }
}

// The displayed text of one field in a flattened row, or null when empty: a
// relation shows the target's title (or its id until resolved), a boolean
// yes/no, a timestamp the local date and time, a number grouped by thousands,
// anything else its text. This
// is exactly what Copy copies.
export type ResolveTitle = (target: string, id: string) => string | null

export function fieldTextOf(field: FieldMetadata, record: Row, resolveTitle: ResolveTitle): string | null {
  const value = record[field.name]
  if (value === null || value === undefined || value === "") return null
  if (field.relation) {
    const id = String(value)
    return resolveTitle(field.relation.target, id) ?? id
  }
  if (field.type === "boolean") return value ? "yes" : "no"
  return fieldDisplayTextOf(field, value)
}

// What qwbe answered to a save: its message and the per-field issues by field
// name (fieldErrorsOf, HttpError body.errors in the data provider).
export type FieldErrors = Record<string, string>
export type Refusal = { message: string; errors: FieldErrors }

// Announced above the form when every issue sits under its own field.
export const CHECK_FIELDS = "Check the highlighted fields"

export function refusalOfError(e: unknown): Refusal {
  const message = e instanceof Error ? e.message : String(e)
  const body = (e as { body?: unknown } | null)?.body as { errors?: FieldErrors } | null | undefined
  return { message, errors: body?.errors ?? {} }
}

// A refusal as one form shows it. The issues on the inputs it renders go
// under them, in the form's order (FieldRefusals focuses the first); the
// message above stays qwbe's own when no issue found an input, names the
// other issues by their label, or asks to check the highlighted fields.
// `inputs` are the rendered inputs alone, so a field the form does not show
// never holds an error that would block its submit.
export function shownRefusalOf(
  refusal: Refusal,
  inputs: readonly FieldMetadata[],
  fields: readonly FieldMetadata[],
): { message: string; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {}
  for (const input of inputs) {
    if (Object.hasOwn(refusal.errors, input.name)) fieldErrors[input.name] = refusal.errors[input.name]
  }
  const elsewhere = Object.entries(refusal.errors)
    .filter(([name]) => !Object.hasOwn(fieldErrors, name))
    .map(([name, text]) => `${fields.find((f) => f.name === name)?.label ?? name}: ${text}`)
  if (elsewhere.length > 0) return { message: `${refusal.message} (${elsewhere.join("; ")})`, fieldErrors }
  return { message: Object.keys(fieldErrors).length > 0 ? CHECK_FIELDS : refusal.message, fieldErrors }
}

// The create form's starting values copied from an existing row (Duplicate):
// only what a user may edit and the backend stores -- never the id, the
// bookkeeping columns or a mock field -- minus the names the caller skips (an
// import identity, an auto-generated record number). Text, as the form holds it.
export function duplicateValuesOf(
  fields: readonly FieldMetadata[],
  row: Row,
  skip: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (!canEdit(field) || skip.has(field.name)) continue
    const value = customValueOf(row, field)
    if (value === null || value === undefined || typeof value === "object") continue
    values[field.name] = String(value)
  }
  return values
}
