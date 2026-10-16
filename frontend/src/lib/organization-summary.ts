// What the Organizations detail header says about one record, as vtiger says
// it: "[ACC No] Name", "Updated <when> by <who>", and the two facts a reader
// checks first (company status, legal form).

import { valueTextOf, type Row } from "./cube.ts"
import { formatDateTime, isIsoDateTime } from "./date-time.ts"

const textOf = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const text = valueTextOf(value).trim()
  return text === "" ? null : text
}

export function organizationTitleOf(row: Row): { number: string | null; name: string } {
  return { number: textOf(row.organizationNo), name: textOf(row.name) ?? String(row.id) }
}

// "Updated 02.11.2025, 17:40 by Agent Vanzari 1". Without a modification
// time (the cube does not publish one yet) the creation time is the honest
// fallback, and it says so.
export function updatedLineOf(row: Row): string | null {
  if (isIsoDateTime(row.modifiedAt)) {
    const by = textOf(row.modifiedBy)
    const when = formatDateTime(row.modifiedAt)
    return by ? `Updated ${when} by ${by}` : `Updated ${when}`
  }
  if (isIsoDateTime(row.createdAt)) return `Created ${formatDateTime(row.createdAt)}`
  return null
}

export type HeaderBadge = { label: string; value: string }

// The rating is the company's legal status in vtiger (hence "Company status").
export function headerBadgesOf(row: Row): HeaderBadge[] {
  const badges = [
    { label: "Company status", value: textOf(row.rating) },
    { label: "Form", value: textOf(row.legalForm) },
  ]
  return badges.filter((b): b is HeaderBadge => b.value !== null)
}

// Send Mail: a mailto: to the organization's own email, or null without one.
export function mailtoOf(row: Row): string | null {
  const email = textOf(row.email)
  return email ? `mailto:${email}` : null
}
