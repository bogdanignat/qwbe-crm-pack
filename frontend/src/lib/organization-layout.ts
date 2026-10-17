// The Organizations detail page, block by block and row by row, as vtiger 5.4
// shows it (docs/plan/organizations-ui-spec.md §3.2), without the fields under
// 15% filled (dropped, backend.md §1): block 1 closes up two per row in
// vtiger's sequence, an empty cell only at the end of a block. The Address
// block pairs billing (left) with shipping (right), as vtiger does, and ends
// with a Sector row for a side whose county is Bucharest (organizationLayoutOf).
// The mock fields sit in the block VTIGER_PLACEMENT gives them; a test keeps
// the two in step.

import type { FieldBlockSpec, FieldRowSpec } from "./field-blocks.ts"

const ORGANIZATION_INFORMATION: FieldBlockSpec = {
  title: "Organization Information",
  rows: [
    ["createdAt", "modifiedAt"],
    ["name", "legalForm"],
    ["vatPayer", "organizationType"],
    ["cui", "rating"],
    ["tradeRegisterNo", "customerCategory"],
    ["assignedTo", "phone"],
    ["otherPhone", "mobilePhone"],
    ["annualRevenue", "fax"],
    ["employees", "caenCode"],
    ["email", "website"],
    ["industry", "emailOptOut"],
    ["industrySpec", "organizationNo"],
  ],
}

// The Address block's title: the form hangs the address copy on it.
export const ADDRESS_BLOCK_TITLE = "Address Information"

const blocksWithAddress = (address: readonly FieldRowSpec[]): readonly FieldBlockSpec[] => [
  ORGANIZATION_INFORMATION,
  { title: ADDRESS_BLOCK_TITLE, rows: address },
  { title: "Description Information", rows: [["description"]] },
]

// Billing | shipping, field by field (vtiger's Address block).
const ADDRESS_ROWS: readonly FieldRowSpec[] = [
  ["billingStreet", "shippingStreet"],
  ["billingCity", "shippingCity"],
  ["billingState", "shippingState"],
  ["billingCode", "shippingCode"],
  ["billingCountry", "shippingCountry"],
]

// The layout without any Sector: no county in Bucharest.
export const ORGANIZATION_BLOCKS = blocksWithAddress(ADDRESS_ROWS)

// Bookkeeping the reader has no use for (externalId is the import identity;
// vtiger has no such field and Schema & API still shows it), and modifiedBy,
// which the header already shows ("Updated ... by ..."), as vtiger does.
// Ownership is vtiger free text holding people's names, 0,5% filled: hidden
// until the backend removes it (organizations-backend.md §1). The two Sectors
// are hidden by default too: only a Bucharest county shows its own, in the
// Address block. Hidden, they can never join block 1 as unplaced fields
// (fieldBlocksOf), whoever lays the fields out.
export const SECTOR_FIELDS: ReadonlySet<string> = new Set(["billingSector", "shippingSector"])
export const ORGANIZATION_HIDDEN: ReadonlySet<string> = new Set([
  "id", "type", "deleted", "externalId", "modifiedBy", "ownership", ...SECTOR_FIELDS,
])

// Bucharest's county: vtiger's P2 value ("Bucuresti") today, its ISO
// 3166-2:RO code ("RO-B") once the backend stores codes
// (organizations-backend.md §12). Matched whatever the case, the diacritics
// (ș and ş alike) or a "Municipiul" prefix, as typed or imported.
const BUCHAREST = new Set(["bucuresti", "municipiul bucuresti", "ro-b"])

export function isBucharest(county: unknown): boolean {
  if (typeof county !== "string") return false
  return BUCHAREST.has(county.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase())
}

// The blocks and the hidden fields of one organization: each side's Sector
// shows only when that side's county is Bucharest, in one last row (billing
// left, shipping right), so an empty cell is only ever at the block's end.
// Display only; the backend enforces the rule.
export type AddressCounties = { billingState?: unknown; shippingState?: unknown }

export function organizationLayoutOf(counties: AddressCounties = {}): {
  blocks: readonly FieldBlockSpec[]
  hidden: ReadonlySet<string>
} {
  const sectors = [
    isBucharest(counties.billingState) ? "billingSector" : null,
    isBucharest(counties.shippingState) ? "shippingSector" : null,
  ]
  if (sectors.every((name) => name === null)) return { blocks: ORGANIZATION_BLOCKS, hidden: ORGANIZATION_HIDDEN }
  return {
    blocks: blocksWithAddress([...ADDRESS_ROWS, sectors]),
    hidden: new Set([...ORGANIZATION_HIDDEN].filter((name) => !sectors.includes(name))),
  }
}
