// How the organization fields are shown, where the published metadata says
// nothing yet: UI decisions on real fields, independent of the mockup layer
// (src/mock). What the backend publishes itself always wins.

import type { CubeMetadata, FieldFormat } from "./cube.ts"

export const ORGANIZATIONS_CUBE = "crm/organizations"

// In vtiger `rating` is the company's legal status (Activ, Dizolvat/Radiat,
// Insolventa...), not a rating.
const ORGANIZATION_LABELS: Record<string, string> = { rating: "Company status" }

// The fields vtiger shows as tel:, mailto: and http links. The metadata
// publishes them as plain strings (docs/plan/organizations-backend.md).
const ORGANIZATION_FORMATS: Record<string, FieldFormat> = { phone: "phone", email: "email", website: "url" }

export function withOrganizationDisplay(meta: CubeMetadata): CubeMetadata {
  if (meta.cube !== ORGANIZATIONS_CUBE) return meta
  return {
    ...meta,
    fields: meta.fields.map((f) => {
      const format = f.format ?? ORGANIZATION_FORMATS[f.name]
      return {
        ...f,
        label: ORGANIZATION_LABELS[f.name] ?? f.label,
        ...(format ? { format } : {}),
      }
    }),
  }
}
