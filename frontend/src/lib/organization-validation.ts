// What the organization form checks before saving (spec §4.2, §4.3), wired by
// field name and format, so a rule applies on its own once its field becomes
// a real editable field (CUI is mock today). Mock fields never reach
// these checks: they are read-only in the form and never sent.

import type { FieldMetadata } from "./cube.ts"
import { cuiError } from "./cui.ts"
import { emailError, integerError, maxLengthError, requiredError } from "./validators.ts"

// vtiger's mandatory fields (typeofdata ~M). TVA is a checkbox: unticked is a
// value, so it is marked but never refused, as in vtiger.
export const ORGANIZATION_REQUIRED: ReadonlySet<string> = new Set([
  "name",
  "legalForm",
  "vatPayer",
  "cui",
  "assignedTo",
  "industry",
  "billingState",
])

// vtiger's declared lengths (LE~N), used where the metadata publishes none.
export const ORGANIZATION_MAX_LENGTHS: Readonly<Record<string, number>> = {
  cui: 20,
  tradeRegisterNo: 20,
  industrySpec: 50,
  mobilePhone: 15,
}

// vtiger's per-field rules. Email (vtiger's E~O) goes by its
// `format`, which organization-display and the mock attach until it is published.
const BY_NAME: Readonly<Record<string, (value: string) => string | null>> = { cui: cuiError }

export function isRequiredField(field: FieldMetadata): boolean {
  return field.required || ORGANIZATION_REQUIRED.has(field.name)
}

export function maxLengthOf(field: FieldMetadata): number | undefined {
  return field.maxLength ?? ORGANIZATION_MAX_LENGTHS[field.name]
}

// The first problem with one value, or null. A boolean has nothing to check.
export function organizationFieldError(field: FieldMetadata, value: unknown): string | null {
  if (field.type === "boolean") return null
  if (isRequiredField(field)) {
    const missing = requiredError(field.label, value)
    if (missing) return missing
  }
  const text = value === null || value === undefined ? "" : String(value)
  if (text.trim() === "") return null
  const max = maxLengthOf(field)
  const checks = [
    max === undefined ? null : maxLengthError(field.label, text, max),
    BY_NAME[field.name]?.(text) ?? null,
    field.format === "email" ? emailError(text) : null,
    field.type === "integer" ? integerError(text) : null,
  ]
  return checks.find((error) => error !== null) ?? null
}
