// The organizations list. Nothing entity-specific here but the cube name:
// columns, sorting, search and paging all come from the cube metadata. The
// demo organizations of the mockup layer ride read-only on the first page.
import { CubeList } from "@/components/cube-list"
import { DEMO_ORGANIZATIONS } from "@/mock/organizations"

export default function OrganizationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Organizations</h1>
      <CubeList
        cube="crm/organizations"
        createHref="/organizations/new"
        addLabel="Add organization"
        emptyMessage="No organizations yet."
        demoRows={DEMO_ORGANIZATIONS}
      />
    </main>
  )
}
