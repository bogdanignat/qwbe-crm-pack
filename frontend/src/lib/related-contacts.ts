// The Contacts related list of an organization (vtiger's first related list,
// spec §3.5): vtiger's columns, read from the contacts cube where it publishes
// the field. A column the cube does not publish yet stays, marked mock and
// empty, so the gap is visible instead of silently dropped.

import type { CubeMetadata, FieldFormat, FieldMetadata } from "./cube.ts"

export const CONTACTS_CUBE = "crm/contacts"
export const CONTACTS_PAGE_SIZE = 10

export type ContactColumn = { label: string; field: FieldMetadata | null }

// vtiger shows the phones and the email as links; the contacts metadata
// publishes no format yet, so the column brings one (a published one wins).
const VTIGER_COLUMNS: readonly { label: string; name: string; format?: FieldFormat }[] = [
  { label: "Last Name", name: "lastName" },
  { label: "First Name", name: "firstName" },
  { label: "Mobile", name: "mobilePhone", format: "phone" },
  { label: "Email", name: "email", format: "email" },
  { label: "Office Phone", name: "phone", format: "phone" },
  { label: "Title", name: "title" },
  { label: "Assigned To", name: "assignedTo" },
]

// The cube keeps one `name` today: until it publishes lastName and firstName,
// a single "Name" column takes their place, so the contact still has a title.
export function contactColumnsOf(meta: CubeMetadata): ContactColumn[] {
  const byName = new Map(meta.fields.map((f) => [f.name, f]))
  const columns = VTIGER_COLUMNS.map(({ label, name, format }) => {
    const field = byName.get(name)
    return { label, field: field ? { ...field, format: field.format ?? format } : null }
  })
  const [last, first, ...rest] = columns
  if (last.field || first.field) return columns
  return [{ label: "Name", field: byName.get("name") ?? null }, ...rest]
}

// "1-10 of 23", "0 of 0" for an empty list. A page without a total says only
// the range.
export function contactsRangeOf(page: number, rows: number, total: number | undefined): string {
  const first = (page - 1) * CONTACTS_PAGE_SIZE + 1
  const range = rows === 0 ? "0" : `${first}-${first + rows - 1}`
  return total === undefined ? range : `${range} of ${total}`
}

// vtiger orders a related list by last name. The cube sorts by `name` (first
// name first) until it publishes a sortable lastName; then that one wins,
// with no frontend change (organizations-backend.md §8).
export function contactsSortOf(meta: CubeMetadata): string | undefined {
  const sortable = meta.list?.sort ?? meta.fields.filter((f) => f.sortable).map((f) => f.name)
  return ["lastName", "name"].find((name) => sortable.includes(name))
}

// The demo contacts in the same order, sorted here (they are not on the server).
export function sortedRowsOf<T extends Record<string, unknown>>(rows: readonly T[], field: string | undefined): T[] {
  if (!field) return [...rows]
  return [...rows].sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? ""), "ro"))
}
