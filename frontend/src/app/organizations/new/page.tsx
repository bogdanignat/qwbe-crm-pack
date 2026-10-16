// The organization create form. The field list is the F1 basic set, in display
// order; labels, required flags and validation come from the cube metadata,
// so nothing here duplicates the schema. `?duplicate=<id>` (the detail's
// Duplicate) starts the form from that organization's values.
import { CubeCreateForm } from "@/components/cube-create-form"
import { DuplicateOrganizationForm } from "@/components/organizations/duplicate-organization-form"

// externalId stays off the form: it is the import tool's identity, and its
// unique index turns a hand-typed duplicate into a 500, not a form refusal.
const ORGANIZATION_CREATE_FIELDS = ["name", "industry", "phone", "email", "website"]

export default async function NewOrganizationPage({ searchParams }: PageProps<"/organizations/new">) {
  const { duplicate } = await searchParams
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">New organization</h1>
      {typeof duplicate === "string" && duplicate !== "" ? (
        <DuplicateOrganizationForm id={duplicate} fields={ORGANIZATION_CREATE_FIELDS} />
      ) : (
        <CubeCreateForm cube="crm/organizations" fields={ORGANIZATION_CREATE_FIELDS} />
      )}
    </main>
  )
}
