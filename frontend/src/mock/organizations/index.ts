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

import type { CubeMetadata, FieldFormat, FieldMetadata, Row } from "../../lib/cube.ts"
import { ORGANIZATIONS_CUBE } from "../../lib/organization-display.ts"
import contactsJson from "./contacts.json" with { type: "json" }
import fieldsJson from "./fields.json" with { type: "json" }
import organizationsJson from "./organizations.json" with { type: "json" }
import picklistsJson from "./picklists.json" with { type: "json" }

// The vtiger picklists of the fields shown (P1-P5, P7), complete, in the
// order vtiger shows them (checked against the vtiger database; normalized,
// without "--None--"). P6, P8 and P9 went with their fields (under 15% filled).
export type Picklist = { field: string; label: string; values: string[] }
export const PICKLISTS: Record<string, Picklist> = picklistsJson

// Where vtiger places each mock field: its own field name, block, sequence in
// the block and declared length. Layout input for the detail and form steps.
// billingSector is not a vtiger field (field null): it sits right after
// Billing State (docs/plan/organizations-backend.md §12, "Required fields").
export type VtigerPlacement = { field: string | null; block: string; sequence: number; maxLength: number | null }
export const VTIGER_PLACEMENT: Record<string, VtigerPlacement> = Object.fromEntries(
  fieldsJson.map((f) => [f.name, f.vtiger]),
)

// Never sortable or searchable: the server cannot sort or search a column it
// does not have. Every mock is bound for the cube (docs/plan/organizations-backend.md §1).
export const MOCK_FIELDS: FieldMetadata[] = fieldsJson.map((f) => ({
  name: f.name,
  label: f.label,
  type: f.type,
  ...(f.format ? { format: f.format as FieldFormat } : {}),
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
// and opened from here, never from the backend. The JSON is §6 verbatim.
export const DEMO_ORGANIZATIONS: Row[] = organizationsJson

export function demoOrganizationOf(cube: string, id: string): Row | undefined {
  return cube === ORGANIZATIONS_CUBE ? DEMO_ORGANIZATIONS.find((row) => row.id === id) : undefined
}

// The made-up contacts of the demo organizations (Maria Proba, Ion Exemplu on
// org_mock_001), for the Contacts related list. Read-only, never from or to
// the backend, and they have no contact page.
export const DEMO_CONTACTS: Row[] = contactsJson

export function demoContactsOf(organizationId: string): Row[] {
  return DEMO_CONTACTS.filter((contact) => contact.organizationId === organizationId)
}
