// Creating an organization (spec §4.5): the shared organization form, empty or
// started from an existing organization (?duplicate=<id>, the detail's
// Duplicate). It lives in the ra-core context the kit inputs need.
import { KitContext } from "@/components/kit/kit-context"
import { NewOrganization } from "@/components/organizations/new-organization"
import { PageMain } from "@/components/page-main"

export default async function NewOrganizationPage({ searchParams }: PageProps<"/organizations/new">) {
  const { duplicate } = await searchParams
  const duplicateOf = typeof duplicate === "string" && duplicate !== "" ? duplicate : null
  return (
    <PageMain>
      <h1 className="text-xl font-semibold">{duplicateOf ? "Duplicate organization" : "New organization"}</h1>
      <KitContext>
        <NewOrganization duplicateOf={duplicateOf} />
      </KitContext>
    </PageMain>
  )
}
