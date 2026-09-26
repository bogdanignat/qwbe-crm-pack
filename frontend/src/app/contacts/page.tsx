// The contacts list. Same generic component, different cube name;
// the searchable organizationId relation becomes the organization filter.
import Link from "next/link"

import { CubeList } from "@/components/cube-list"
import { Button } from "@/components/ui/button"

export default function ContactsPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Contacts</h1>
        {/* The grouping surface for these contacts, reached from the section
            that owns them as well as from the main navigation. */}
        <Button asChild size="sm" variant="outline">
          <Link href="/contact-groups">Contact groups</Link>
        </Button>
      </div>
      <CubeList
        cube="crm/contacts"
        createHref="/contacts/new"
        addLabel="Add contact"
        emptyMessage="No contacts yet."
      />
    </main>
  )
}
