// The Organizations list as vtiger 5.4 opens it (spec §2.6): the "All"
// filter's columns plus CUI and Billing State, the mass actions of
// Accounts::getListButtons, and Edit from a row opening the detail page in
// edit mode.

import { rowHref } from "./cube.ts"
import { editAllHref } from "./edit-link.ts"
import { UNLISTED_COLUMNS } from "./list-columns.ts"
import { ORGANIZATIONS_CUBE } from "./organization-display.ts"
import { SECTOR_FIELD } from "./organization-layout.ts"

export const ORGANIZATION_LIST_COLUMNS = [
  "organizationNo",
  "name",
  "cui",
  "billingCity",
  "billingState",
  "website",
  "phone",
  "assignedTo",
] as const

// Hidden as on the detail page: the import identity, Ownership, and the
// Sector, which a column cannot show for Bucharest rows alone.
export const ORGANIZATION_LIST_UNLISTED: ReadonlySet<string> = new Set([
  ...UNLISTED_COLUMNS, "externalId", "ownership", SECTOR_FIELD,
])

// All need backend endpoints that do not exist yet (organizations-backend.md §3).
export const ORGANIZATION_MASS_ACTIONS = ["Delete", "Mass Edit", "Send Mail", "Mailer Export", "Send SMS"] as const

export function organizationEditHref(id: string): string {
  return editAllHref(rowHref(ORGANIZATIONS_CUBE, encodeURIComponent(id)) ?? "/organizations")
}
