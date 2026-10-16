// The contacts list. Same generic component, different cube name;
// the searchable organizationId relation becomes the organization filter.
// The list keeps its query in the URL (useSearchParams), hence Suspense.
import { Suspense } from "react"

import { CubeList } from "@/components/cube-list"
import { Skeleton } from "@/components/ui/skeleton"

const CONTACTS = { one: "contact", other: "contacts" }

export default function ContactsPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Contacts</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CubeList
          cube="crm/contacts"
          createHref="/contacts/new"
          addLabel="Add contact"
          emptyMessage="No contacts yet."
          noun={CONTACTS}
          searchPlaceholder="Name or email starts with…"
        />
      </Suspense>
    </main>
  )
}
