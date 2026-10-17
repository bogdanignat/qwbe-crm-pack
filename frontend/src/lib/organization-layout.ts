// The Organizations detail page, block by block and row by row, as vtiger 5.4
// shows it (docs/plan/organizations-ui-spec.md §3.2), without the fields under
// 15% filled (dropped, backend.md §1): the rest close up two per row in
// vtiger's sequence, an empty cell only at the end of a block, and the
// Address block keeps billing only. The mock fields sit in the block
// VTIGER_PLACEMENT gives them; a test keeps the two in step.

import type { FieldBlockSpec } from "./field-blocks.ts"

export const ORGANIZATION_BLOCKS: readonly FieldBlockSpec[] = [
  {
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
  },
  {
    title: "Address Information",
    rows: [
      ["billingStreet", "billingCity"],
      ["billingState", "billingCode"],
      ["billingCountry", null],
    ],
  },
  { title: "Description Information", rows: [["description"]] },
]

// Bookkeeping the reader has no use for (externalId is the import identity;
// vtiger has no such field and Schema & API still shows it), and modifiedBy,
// which the header already shows ("Updated ... by ..."), as vtiger does.
export const ORGANIZATION_HIDDEN = new Set(["id", "type", "deleted", "externalId", "modifiedBy"])
