// The Organizations list (T-1813): vtiger 5.4's ListView in the app's style,
// built in components/organizations/organization-list.tsx. The list keeps its
// query in the URL (useSearchParams), hence Suspense.
import { Suspense } from "react"

import { OrganizationList } from "@/components/organizations/organization-list"
import { Skeleton } from "@/components/ui/skeleton"
import { PageMain } from "@/components/page-main"

export default function OrganizationsPage() {
  return (
    <PageMain>
      <h1 className="text-xl font-semibold">Organizations</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <OrganizationList />
      </Suspense>
    </PageMain>
  )
}
