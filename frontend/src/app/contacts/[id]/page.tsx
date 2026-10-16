// One contact (QWB-54). The page supplies only the contact's field grouping;
// the frame, card, field display with Copy, in-place Edit/Save/Cancel,
// relation links and title come from the reusable kit renderer (the same one
// Organizations uses), assembled from the cube's published metadata. The
// organization shows as a link resolved through the relation metadata on
// organizationId. A field this list does not name, or a custom field defined
// at runtime, still shows in its own section.
import { Suspense } from "react"

import { ActivityFeed } from "@/components/activity-feed"
import { CubeKitShow } from "@/components/kit/cube-show"
import { KitContext } from "@/components/kit/kit-context"
import { SchemaApiPanel } from "@/components/schema-api-panel"
import { SharingPanel } from "@/components/sharing-panel"
import { Skeleton } from "@/components/ui/skeleton"
import type { FieldGroupSpec } from "@/lib/cube"

const CONTACT_GROUPS: FieldGroupSpec[] = [
  // Demonstration of the section emphasis on the primary group: a layout
  // accent, not a statement about any record.
  { legend: "Identity", fields: ["name", "email", "phone"], important: true },
  { legend: "Organization", fields: ["organizationId"] },
  { legend: "Details", fields: ["company"] },
]

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <Detail id={params} />
    </main>
  )
}

async function Detail({ id }: { id: Promise<{ id: string }> }) {
  const { id: resolved } = await id
  return (
    <div className="flex flex-col gap-6">
      <KitContext>
        {/* ?edit=all (an "edit" link) is read with useSearchParams, hence Suspense. */}
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <CubeKitShow cube="crm/contacts" id={resolved} groups={CONTACT_GROUPS} />
        </Suspense>
      </KitContext>
      <SharingPanel cube="crm/contacts" entityType="Contact" id={resolved} />
      <ActivityFeed cube="crm/contacts" entityId={resolved} />
      <SchemaApiPanel cube="crm/contacts" id={resolved} />
    </div>
  )
}
