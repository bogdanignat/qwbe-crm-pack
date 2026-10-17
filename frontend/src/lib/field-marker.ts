// What a field still lacks on the backend: a mock is not published yet and
// will be a cube field (docs/plan/organizations-backend.md §1). A published
// field, custom or not, has no marker.

import type { FieldMetadata } from "./cube.ts"

export type FieldMarker = { label: string; description: string }

export const MOCK_MARKER: FieldMarker = {
  label: "Mock",
  description: "Not published by the backend yet; it will be a cube field.",
}

export function fieldMarkerOf(field: FieldMetadata): FieldMarker | null {
  return field.mock ? MOCK_MARKER : null
}
