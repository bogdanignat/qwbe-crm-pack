"use client"

// Echo, a developer page (T-1813): the activity feed across every cube. It sits
// under Administration and opens for admins only; the kernel still hides every
// row the caller may not read.

import { EchoFeed } from "@/components/echo-feed"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/hooks/use-current-user"
import { PageMain } from "@/components/page-main"

export default function EchoPage() {
  const me = useCurrentUser()
  return (
    <PageMain>
      <h1 className="text-xl font-semibold">Echo</h1>
      {me.status === "loading" ? (
        <Skeleton className="h-64 w-full" />
      ) : me.user?.admin ? (
        <EchoFeed />
      ) : (
        <p className="text-sm text-muted-foreground">Echo is a developer page for administrators.</p>
      )}
    </PageMain>
  )
}
