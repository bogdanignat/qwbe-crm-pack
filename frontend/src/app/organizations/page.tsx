// The Organizations list (T-1813): vtiger 5.4's ListView in the app's style,
// built in components/organizations/organization-list.tsx. The list keeps its
// query in the URL (useSearchParams), hence Suspense.
import { Suspense } from "react"

import { OrganizationList } from "@/components/organizations/organization-list"
import { Skeleton } from "@/components/ui/skeleton"

export default function OrganizationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Organizations</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <OrganizationList />
      </Suspense>
    </main>
  )
}
