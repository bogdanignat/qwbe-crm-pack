// The contact create form. Same generic component and cube metadata as the
// organization one; organizationId renders as the typeahead picker over the
// organizations cube (the relation declared in the contact manifest).
// `?organizationId=<id>` (an organization's "Add Contact") preselects it.
import { CubeCreateForm } from "@/components/cube-create-form"

export default async function NewContactPage({ searchParams }: PageProps<"/contacts/new">) {
  const { organizationId } = await searchParams
  const initialValues: Record<string, string> =
    typeof organizationId === "string" && organizationId !== "" ? { organizationId } : {}
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">New contact</h1>
      {/* externalId stays off the form: it is
          the import tool's identity, and its unique index turns a hand-typed
          duplicate into a 500, not a form refusal. */}
      <CubeCreateForm
        cube="crm/contacts"
        fields={["name", "email", "phone", "company", "organizationId"]}
        initialValues={initialValues}
      />
    </main>
  )
}
