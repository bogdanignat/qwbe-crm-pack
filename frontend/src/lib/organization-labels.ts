// UI labels for organization fields that differ from the published ones. A UI
// decision on real fields, independent of the mockup layer (src/mock).

import type { CubeMetadata } from "./cube.ts"

export const ORGANIZATIONS_CUBE = "crm/organizations"

// In vtiger `rating` is the company's legal status (Activ, Dizolvat/Radiat,
// Insolventa...), not a rating.
const ORGANIZATION_LABELS: Record<string, string> = { rating: "Company status" }

export function withOrganizationLabels(meta: CubeMetadata): CubeMetadata {
  if (meta.cube !== ORGANIZATIONS_CUBE) return meta
  return {
    ...meta,
    fields: meta.fields.map((f) =>
      ORGANIZATION_LABELS[f.name] ? { ...f, label: ORGANIZATION_LABELS[f.name] } : f,
    ),
  }
}
