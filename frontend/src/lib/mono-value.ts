// Which values read in the mono font (T-1817): numbers, dates, phone numbers
// and codes (an organization number, a CUI), so digits line up in a
// column. A code is one word of capitals, digits and separators, with a digit.
// A relation is never mono: its raw value is an id, but what shows is the
// linked record's name.

import type { FieldMetadata } from "./cube.ts"
import { isIsoDateTime } from "./date-time.ts"

const NUMERIC_TYPES = new Set(["integer", "number"])
const MONO_FORMATS = new Set(["phone"])
const CODE = /^(?=.*\d)[A-Z0-9][A-Z0-9./-]*$/

export function isMonoValue(field: FieldMetadata, value: unknown): boolean {
  if (field.relation) return false
  if (NUMERIC_TYPES.has(field.type) || isIsoDateTime(value)) return true
  if (field.format && MONO_FORMATS.has(field.format)) return true
  return typeof value === "string" && CODE.test(value.trim())
}
