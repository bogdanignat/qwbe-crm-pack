// A published field for the tests, overridable per case.
import type { FieldMetadata } from "./cube.ts"

export const testField = (over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name: "name",
  label: "Name",
  type: "string",
  required: false,
  editable: true,
  sortable: false,
  searchable: false,
  nullable: true,
  enum: null,
  relation: null,
  custom: false,
  ...over,
})
