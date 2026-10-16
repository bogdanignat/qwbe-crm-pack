// How the organization fields are shown, where the published metadata says
// nothing yet: UI decisions on real fields. What the backend publishes itself
// always wins. The one tie to the mockup layer is vtiger's picklist values for
// three real fields (ORGANIZATION_ENUMS), until the backend publishes them.

import type { CubeMetadata, FieldFormat } from "./cube.ts"
import picklists from "../mock/organizations/picklists.json" with { type: "json" }

export const ORGANIZATIONS_CUBE = "crm/organizations"

// One convention: vtiger's en_us labels, where the published ones differ
// (docs/plan/organizations-backend.md §2 asks the backend for them). In
// vtiger `rating` is the company's legal status (Activ, Dizolvat/Radiat,
// Insolventa...), not a rating. The two amounts carry their currency: one
// currency, EUR, for now (it will be configured at qwbe level 0).
const ORGANIZATION_LABELS: Record<string, string> = {
  name: "Organization Name",
  createdAt: "Created Time",
  organizationType: "Type",
  billingStreet: "Billing Address",
  billingCode: "Billing Postal Code",
  rating: "Company status",
  annualRevenue: "Annual Revenue (EUR)",
  turnoverEur: "Account Turnover (EUR)",
}

// The fields vtiger shows as tel:, mailto: and http links, and the IBAN shown
// in groups of four. The metadata publishes them as plain strings
// (docs/plan/organizations-backend.md).
const ORGANIZATION_FORMATS: Record<string, FieldFormat> = {
  phone: "phone",
  email: "email",
  website: "url",
  iban: "iban",
}

// vtiger's picklists for the real fields published as plain strings: Type
// (P3), Industry (P4) and Company status (P5). With an `enum` they edit as a
// select everywhere (renderKindOf). Ownership stays free text, as in vtiger.
const ORGANIZATION_ENUMS: Record<string, string[]> = {
  organizationType: picklists.P3.values,
  industry: picklists.P4.values,
  rating: picklists.P5.values,
}

export function withOrganizationDisplay(meta: CubeMetadata): CubeMetadata {
  if (meta.cube !== ORGANIZATIONS_CUBE) return meta
  return {
    ...meta,
    fields: meta.fields.map((f) => {
      const format = f.format ?? ORGANIZATION_FORMATS[f.name]
      const values = f.enum && f.enum.length > 0 ? f.enum : (ORGANIZATION_ENUMS[f.name] ?? f.enum)
      return {
        ...f,
        label: ORGANIZATION_LABELS[f.name] ?? f.label,
        ...(format ? { format } : {}),
        enum: values,
      }
    }),
  }
}
