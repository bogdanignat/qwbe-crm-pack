// How the demo rows (mockup data, never on the server) answer a search, the
// way the list contract answers it for real rows: `q` a case-insensitive
// PREFIX match over the search fields, ORed; a filter an exact match. A phone
// also matches by its digits, so "0700000" finds "0700 000 001".
//
// The global search also finds the demo rows by CUI, email and phone
// (DEMO_EXTRA_SEARCH), which the backend `q` does not scan yet
// (docs/plan/organizations-backend.md §7). A list keeps to the fields its
// contract scans, so a demo row never matches where a real one could not.

import type { Row } from "./cube.ts"

export const DEMO_EXTRA_SEARCH = ["cui", "email", "phone"] as const

const digitsOf = (text: string) => text.replace(/\D/g, "")
const PHONE_LIKE = /^[\d\s+().-]{3,}$/

export function matchesPrefix(row: Row, fields: readonly string[], q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (needle === "") return false
  const digits = PHONE_LIKE.test(needle) ? digitsOf(needle) : ""
  return fields.some((field) => {
    const text = String(row[field] ?? "").toLowerCase()
    if (text.startsWith(needle)) return true
    return digits.length >= 3 && digitsOf(text).startsWith(digits)
  })
}

export type DemoQuery = { q: string; filters: Readonly<Record<string, string>> }

// The demo rows a list query keeps: all of them without a query.
export function demoRowsMatching(rows: readonly Row[], searchFields: readonly string[], { q, filters }: DemoQuery): Row[] {
  const active = Object.entries(filters).filter(([, value]) => value !== "")
  return rows.filter(
    (row) =>
      (q.trim() === "" || matchesPrefix(row, searchFields, q)) &&
      active.every(([field, value]) => String(row[field] ?? "") === value),
  )
}
