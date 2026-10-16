// One organization, laid out as vtiger 5.4 shows it (T-1814): header, the
// "Organization Information" and "More Information" tabs, the Actions box and
// the activity feed (components/organizations/organization-detail.tsx). The
// contacts are derived by filtering the contacts cube on organizationId; no
// related-list endpoint exists by design.
//
// Sharing lives on the More Information tab. A demo organization (mockup
// layer) is read from the mock: qwbe does not have its id, so it gets a
// read-only Sharing preview there and no Schema & API panel; nothing is asked
// of qwbe about it. The tab reads the URL (useSearchParams), hence Suspense.
import { Suspense } from "react"

import { KitContext } from "@/components/kit/kit-context"
import { OrganizationDetail } from "@/components/organizations/organization-detail"
import { SchemaApiPanel } from "@/components/schema-api-panel"
import { Skeleton } from "@/components/ui/skeleton"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import { demoOrganizationOf } from "@/mock/organizations"

export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <Detail id={params} />
    </main>
  )
}

async function Detail({ id }: { id: Promise<{ id: string }> }) {
  const { id: resolved } = await id
  const demo = demoOrganizationOf(ORGANIZATIONS_CUBE, resolved) !== undefined
  return (
    <div className="flex flex-col gap-6">
      <KitContext>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <OrganizationDetail id={resolved} demo={demo} />
        </Suspense>
      </KitContext>
      {!demo && <SchemaApiPanel cube={ORGANIZATIONS_CUBE} id={resolved} />}
    </div>
  )
}
