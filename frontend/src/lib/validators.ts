// The client-side check every cube form shares, driven by the published
// metadata alone: required, maxLength, the email format and whole numbers.
// Business rules (a CUI's check digit, uniqueness) belong to the backend,
// whose refusal shows under the field it names. Pure, so the same rule runs
// in a test, in the full form and in the inline editor. A create checks every
// value (fieldError), an edit only what the user changed (editedFieldError).

import type { FieldMetadata } from "./cube.ts"

export function requiredError(label: string, value: unknown): string | null {
  return value === null || value === undefined || String(value).trim() === "" ? `${label} is required` : null
}

export function maxLengthError(label: string, value: string, max: number): string | null {
  return value.length > max ? `${label} can be at most ${max} characters` : null
}

export function emailError(value: string): string | null {
  const email = value.trim()
  return email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter an email address like name@example.com"
}

export function integerError(value: string): string | null {
  const n = value.trim()
  return n === "" || /^-?\d+$/.test(n) ? null : "Enter a whole number"
}

// The first problem with one value, or null. A boolean has nothing to check:
// unticked is a value.
export function fieldError(field: FieldMetadata, value: unknown): string | null {
  if (field.type === "boolean") return null
  if (field.required) {
    const missing = requiredError(field.label, value)
    if (missing) return missing
  }
  const text = value === null || value === undefined ? "" : String(value)
  if (text.trim() === "") return null
  const checks = [
    field.maxLength === undefined ? null : maxLengthError(field.label, text, field.maxLength),
    field.format === "email" ? emailError(text) : null,
    field.type === "integer" ? integerError(text) : null,
  ]
  return checks.find((error) => error !== null) ?? null
}

// An edit checks only a value the user changed: one the record already held
// (a required field left empty before it became required, a legacy email) is
// not the user's to fix now, and the backend still decides. Compared as the
// save diff compares (changedPayloadOf): trimmed text.
export function editedFieldError(field: FieldMetadata, value: unknown, initial: unknown): string | null {
  return String(value ?? "").trim() === String(initial ?? "").trim() ? null : fieldError(field, value)
}
