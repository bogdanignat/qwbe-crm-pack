// The Organizations detail page, block by block and row by row, as vtiger 5.4
// shows it (docs/plan/organizations-ui-spec.md §3.2), without the fields under
// 15% filled (dropped, backend.md §1): the rest close up two per row in
// vtiger's sequence, an empty cell only at the end of a block, and the
// Address block keeps billing only, with the Sector after the County for a
// Bucharest address alone (organizationLayoutOf). The mock fields sit in the
// block VTIGER_PLACEMENT gives them; a test keeps the two in step.

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

const blocksWithAddress = (address: readonly FieldRowSpec[]): readonly FieldBlockSpec[] => [
  ORGANIZATION_INFORMATION,
  { title: "Address Information", rows: address },
  { title: "Description Information", rows: [["description"]] },
]

export const ORGANIZATION_BLOCKS = blocksWithAddress([
  ["billingStreet", "billingCity"],
  ["billingState", "billingCode"],
  ["billingCountry", null],
])

const BUCHAREST_BLOCKS = blocksWithAddress([
  ["billingStreet", "billingCity"],
  ["billingState", "billingSector"],
  ["billingCode", "billingCountry"],
])

// Bookkeeping the reader has no use for (externalId is the import identity;
// vtiger has no such field and Schema & API still shows it), and modifiedBy,
// which the header already shows ("Updated ... by ..."), as vtiger does.
// Ownership is vtiger free text holding people's names, 0,5% filled: hidden
// until the backend removes it (organizations-backend.md §1). The Sector is
// hidden by default too: only the Bucharest layout shows it, in the Address
// block. Hidden, it can never join block 1 as an unplaced field
// (fieldBlocksOf), whoever lays the fields out.
export const SECTOR_FIELD = "billingSector"
export const ORGANIZATION_HIDDEN: ReadonlySet<string> = new Set([
  "id", "type", "deleted", "externalId", "modifiedBy", "ownership", SECTOR_FIELD,
])
const BUCHAREST_HIDDEN = new Set([...ORGANIZATION_HIDDEN].filter((name) => name !== SECTOR_FIELD))

// Bucharest's county: vtiger's P2 value ("Bucuresti") today, its ISO
// 3166-2:RO code ("RO-B") once the backend stores codes
// (organizations-backend.md §12). Matched whatever the case, the diacritics
// (ș and ş alike) or a "Municipiul" prefix, as typed or imported.
const BUCHAREST = new Set(["bucuresti", "municipiul bucuresti", "ro-b"])

export function isBucharest(county: unknown): boolean {
  if (typeof county !== "string") return false
  return BUCHAREST.has(county.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase())
}

// The blocks and the hidden fields of one organization: the Sector shows only
// when its county is Bucharest. Display only; the backend enforces the rule.
export function organizationLayoutOf(county: unknown): { blocks: readonly FieldBlockSpec[]; hidden: ReadonlySet<string> } {
  return isBucharest(county)
    ? { blocks: BUCHAREST_BLOCKS, hidden: BUCHAREST_HIDDEN }
    : { blocks: ORGANIZATION_BLOCKS, hidden: ORGANIZATION_HIDDEN }
}
