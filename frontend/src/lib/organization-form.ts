// The organization form (create, Duplicate, Edit all; spec §4): the detail
// page's blocks without the timestamps, which fields it edits, its starting
// values, the create body and vtiger's address copy. Mock fields are shown
// read-only and never edited or sent (canEdit, createPayloadOf).

import { canEdit, createPayloadOf, type FieldMetadata } from "./cube.ts"
import { fieldBlocksOf, type FieldBlock } from "./field-blocks.ts"
import { initialValuesOf } from "./kit-form.ts"
import { ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN } from "./organization-layout.ts"

export type FormValues = Record<string, string | boolean>

// vtiger's form leaves out Created and Modified Time (spec §4.1).
const FORM_HIDDEN = new Set([...ORGANIZATION_HIDDEN, "createdAt", "modifiedAt"])

// The values vtiger edits in a text area.
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set(["description", "billingStreet", "shippingStreet"])

// Hints under fields on create. Organization No is vtiger's auto-number; qwbe
// does not number records yet, so the field is not one to fill.
export const CREATE_HINTS: Readonly<Record<string, string>> = {
  organizationNo: "Generated on save once the backend numbers records",
}

export function formBlocksOf(fields: readonly FieldMetadata[]): FieldBlock[] {
  return fieldBlocksOf(fields, ORGANIZATION_BLOCKS, FORM_HIDDEN)
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

// vtiger's two address radios: billing to shipping, or back.
export const ADDRESS_PAIRS: readonly (readonly [string, string])[] = [
  ["billingStreet", "shippingStreet"],
  ["billingPoBox", "shippingPoBox"],
  ["billingCity", "shippingCity"],
  ["billingState", "shippingState"],
  ["billingCode", "shippingCode"],
  ["billingCountry", "shippingCountry"],
]

export type CopyDirection = "billingToShipping" | "shippingToBilling"

const pairsFor = (direction: CopyDirection) =>
  ADDRESS_PAIRS.map(([billing, shipping]) => (direction === "billingToShipping" ? [billing, shipping] : [shipping, billing]))

// The copy is offered only when every target field can be edited.
export function canCopyAddress(fields: readonly FieldMetadata[], direction: CopyDirection): boolean {
  const byName = new Map(fields.map((f) => [f.name, f]))
  return pairsFor(direction).every(([, to]) => {
    const field = byName.get(to)
    return field !== undefined && canEdit(field)
  })
}

// The target values the copy sets, from the current form values.
export function copiedAddress(values: FormValues, direction: CopyDirection): FormValues {
  return Object.fromEntries(pairsFor(direction).map(([from, to]) => [to, values[from] ?? ""]))
}
