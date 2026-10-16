// The Organizations mockup layer (T-1811): the fields and records the vtiger
// 5.4 UI needs but the crm/organizations cube does not publish yet.
//
// Everything here is fictitious or picklist data from
// docs/plan/organizations-ui-spec.md (§5.2, §5.3, §6). What the backend must
// add for this file to disappear is in docs/plan/organizations-backend.md.
//
// - Mock fields use the published metadata shape plus `mock: true`. They are
//   merged UNDER the real metadata: a field the backend publishes under the
//   same name wins and its mock vanishes, with no frontend change.
// - Demo records are read-only and never come from or go to the backend.

import type { CubeMetadata, FieldMetadata, Row } from "../../lib/cube.ts"
import { ORGANIZATIONS_CUBE } from "../../lib/organization-labels.ts"
import fieldsJson from "./fields.json" with { type: "json" }
import organizationsJson from "./organizations.json" with { type: "json" }
import picklistsJson from "./picklists.json" with { type: "json" }

// P1-P9 from §5.3, in the order vtiger shows them. `total` is the size of the
// real list; P4, P6 and P9 carry only the first 20 values the spec lists.
export type Picklist = { field: string; label: string; total: number; values: string[] }
export const PICKLISTS: Record<string, Picklist> = picklistsJson

// Where vtiger places each mock field: its own field name, block, sequence in
// the block and declared length. Layout input for the detail and form steps.
export type VtigerPlacement = { field: string; block: string; sequence: number; maxLength: number | null }
export const VTIGER_PLACEMENT: Record<string, VtigerPlacement> = Object.fromEntries(
  fieldsJson.map((f) => [f.name, f.vtiger]),
)

// Never sortable or searchable: the server cannot sort or search a column it
// does not have.
export const MOCK_FIELDS: FieldMetadata[] = fieldsJson.map((f) => ({
  name: f.name,
  label: f.label,
  type: f.type,
  required: f.required,
  editable: f.editable,
  sortable: false,
  searchable: false,
  nullable: f.nullable,
  enum: f.picklist ? PICKLISTS[f.picklist].values : null,
  relation: f.relation,
  custom: false,
  mock: true,
}))

// The metadata the UI renders for a cube: unchanged for any other cube; for
// organizations the published fields followed by every mock field the backend
// does not publish yet, in vtiger order.
export function withMockFields(meta: CubeMetadata): CubeMetadata {
  if (meta.cube !== ORGANIZATIONS_CUBE) return meta
  const published = new Set(meta.fields.map((f) => f.name))
  return { ...meta, fields: [...meta.fields, ...MOCK_FIELDS.filter((f) => !published.has(f.name))] }
}

// The three demo organizations of §6, shown read-only on the list's first page
// and opened from here, never from the backend.
export const DEMO_ORGANIZATIONS: Row[] = organizationsJson

export function demoOrganizationOf(cube: string, id: string): Row | undefined {
  return cube === ORGANIZATIONS_CUBE ? DEMO_ORGANIZATIONS.find((row) => row.id === id) : undefined
}
