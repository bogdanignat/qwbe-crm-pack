// One organization, assembled from metadata, with its contacts derived by
// filtering the contacts cube on organizationId. No related-list endpoint
// exists by design; the pinned filter IS the derived list.
//
// The page supplies only the field grouping, the way users read an
// organization in the source system (identity, how to reach it, billing
// address, notes); the reusable kit renderer (components/kit/cube-show.tsx,
// the same one Contacts uses) does the rest: display with Copy, in-place
// Edit/Save/Cancel, relation links, runtime custom fields. Names only:
// labels, types, required flags and editability keep coming from the cube
// metadata, a name removed on the backend is skipped, and a field this list
// does not name (or a custom field defined at runtime) still shows, in its
// own section.
import Link from "next/link"

import { ActivityFeed } from "@/components/activity-feed"
import { CubeList } from "@/components/cube-list"
import { CubeKitShow } from "@/components/kit/cube-show"
import { KitContext } from "@/components/kit/kit-context"
import { SchemaApiPanel } from "@/components/schema-api-panel"
import { SharingPanel } from "@/components/sharing-panel"
import { type FieldGroupSpec, routeOf } from "@/lib/cube"
import { demoOrganizationOf } from "@/mock/organizations"

const ORGANIZATION_GROUPS: FieldGroupSpec[] = [
  {
    legend: "Organization",
    fields: ["name", "organizationNo", "organizationType", "industry", "rating", "ownership", "employees"],
    // Demonstration of the section emphasis on the primary group: a layout
    // accent, not a statement about any record.
    important: true,
  },
  { legend: "Contact details", fields: ["phone", "email", "website", "emailOptOut"] },
  { legend: "Billing address", fields: ["billingStreet", "billingCity", "billingCode", "billingCountry"] },
  { legend: "Notes", fields: ["description"] },
  { legend: "Source system", fields: ["externalId"] },
]

export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <Detail id={params} />
    </main>
  )
}

async function Detail({ id }: { id: Promise<{ id: string }> }) {
  const { id: resolved } = await id
  // A demo organization (mockup layer) is read from the mock and shown alone:
  // sharing, activity and contacts would ask qwbe about an id it does not have.
  if (demoOrganizationOf("crm/organizations", resolved)) {
    return (
      <KitContext>
        <CubeKitShow cube="crm/organizations" id={resolved} groups={ORGANIZATION_GROUPS} demo />
      </KitContext>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <KitContext>
        <CubeKitShow cube="crm/organizations" id={resolved} groups={ORGANIZATION_GROUPS} />
      </KitContext>
      <SharingPanel cube="crm/organizations" entityType="Organization" id={resolved} />
      <ActivityFeed cube="crm/organizations" entityId={resolved} />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contacts</h2>
        <CubeList cube="crm/contacts" fixedFilters={{ organizationId: resolved }} />
        <Link className="text-sm underline" href={routeOf("crm/contacts")}>
          All rows
        </Link>
      </section>
      <SchemaApiPanel cube="crm/organizations" id={resolved} />
    </div>
  )
}
