// Contact groups: business sets of CRM contacts, reached from the Contacts
// section of the main navigation.
//
// NOT the kernel's access groups (Settings > permission groups): those group
// user ACCOUNTS for authorization. Nothing on this page grants access.
import { ContactGroupsList } from "@/components/contact-groups-list"

export default function ContactGroupsPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Contact groups</h1>
      <ContactGroupsList />
    </main>
  )
}
