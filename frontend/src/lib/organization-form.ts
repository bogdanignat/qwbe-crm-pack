// The organization form (create, Duplicate, Edit all; spec §4): the detail
// page's blocks without the timestamps, which fields it edits, its starting
// values and the create body. Mock fields are shown
// read-only and never edited or sent (canEdit, createPayloadOf).

import { canEdit, createPayloadOf, type FieldMetadata } from "./cube.ts"
import { fieldBlocksOf, type FieldBlock } from "./field-blocks.ts"
import { initialValuesOf } from "./kit-form.ts"
import { organizationLayoutOf } from "./organization-layout.ts"

export type FormValues = Record<string, string | boolean>

// vtiger's form leaves out Created and Modified Time (spec §4.1).
const FORM_HIDDEN = ["createdAt", "modifiedAt"]

// The values vtiger edits in a text area.
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set(["description", "billingStreet"])

// Hints under fields on create. Organization No is vtiger's auto-number; qwbe
// does not number records yet, so the field is not one to fill.
export const CREATE_HINTS: Readonly<Record<string, string>> = {
  organizationNo: "Generated on save once the backend numbers records",
}

// The detail's layout for the organization's county (the Sector for
// Bucharest only); a new organization has none.
export function formBlocksOf(fields: readonly FieldMetadata[], county?: unknown): FieldBlock[] {
  const { blocks, hidden } = organizationLayoutOf(county)
  return fieldBlocksOf(fields, blocks, new Set([...hidden, ...FORM_HIDDEN]))
}

export function editableFieldsOf(blocks: readonly FieldBlock[]): FieldMetadata[] {
  return blocks.flatMap((b) => b.rows.flat()).filter((f): f is FieldMetadata => f !== null && canEdit(f))
}

// The starting values: the given ones (Duplicate's, as text) or empty.
export function formDefaultsOf(fields: readonly FieldMetadata[], given: Record<string, unknown> = {}): FormValues {
  const row = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v === "true" ? true : v === "false" ? false : v]))
  return initialValuesOf(fields, row)
}

// The POST body: the filled editable fields, coerced; never a mock field.
export function createBodyOf(fields: readonly FieldMetadata[], values: FormValues): Record<string, unknown> {
  const text = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v ?? "")]))
  return createPayloadOf(fields.filter(canEdit), text).payload
}
