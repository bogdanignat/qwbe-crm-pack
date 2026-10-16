// The Organizations detail page, block by block and row by row, as vtiger 5.4
// shows it (docs/plan/organizations-ui-spec.md §3.2). The mock fields sit in
// the block VTIGER_PLACEMENT gives them; a test keeps the two in step.

import type { FieldBlockSpec } from "./field-blocks.ts"

export const ORGANIZATION_BLOCKS: readonly FieldBlockSpec[] = [
  {
    title: "Organization Information",
    rows: [
      ["createdAt", "modifiedAt"],
      ["name", "otherIndustry"],
      ["legalForm", "otherIndustrySpec"],
      ["vatPayer", "organizationType"],
      ["cui", "rating"],
      ["tradeRegisterNo", "customerCategory"],
      ["bank", "productCategory"],
      ["iban", "assignedTo"],
      ["phone", "parentOrganizationId"],
      ["otherPhone", "ownership"],
      ["mobilePhone", "annualRevenue"],
      ["fax", "employees"],
      ["otherFax", "caenCode"],
      ["email", "tickerSymbol"],
      ["otherEmail", "turnoverEur"],
      ["website", "notifyOwner"],
      ["industry", "emailOptOut"],
      ["industrySpec", "organizationNo"],
    ],
  },
  {
    title: "Address Information",
    rows: [
      ["billingStreet", "shippingStreet"],
      ["billingPoBox", "shippingPoBox"],
      ["billingCity", "shippingCity"],
      ["billingState", "shippingState"],
      ["billingCode", "shippingCode"],
      ["billingCountry", "shippingCountry"],
    ],
  },
  { title: "Description Information", rows: [["description"]] },
]

// Bookkeeping the reader has no use for (externalId is the import identity;
// vtiger has no such field and Schema & API still shows it), and modifiedBy,
// which the header already shows ("Updated ... by ..."), as vtiger does.
export const ORGANIZATION_HIDDEN = new Set(["id", "type", "deleted", "externalId", "modifiedBy"])
