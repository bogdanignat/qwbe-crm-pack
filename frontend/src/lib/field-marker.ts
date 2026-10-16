// What a field still lacks on the backend, by Bogdan's cube/custom split
// (docs/plan/organizations-backend.md §1): a mock bound for the cube, or a
// mock bound to become a runtime custom field. A published field has none.

import type { FieldMetadata } from "./cube.ts"

export type FieldMarker = { kind: "mock" | "custom"; label: string; description: string }

export const MOCK_MARKER: FieldMarker = {
  kind: "mock",
  label: "Mock",
  description: "Not published by the backend yet; it will be a cube field.",
}

export const CUSTOM_MARKER: FieldMarker = {
  kind: "custom",
  label: "Custom",
  description: "Not published by the backend yet; it will be a runtime custom field.",
}

export function fieldMarkerOf(field: FieldMetadata): FieldMarker | null {
  if (!field.mock) return null
  return field.custom ? CUSTOM_MARKER : MOCK_MARKER
}
