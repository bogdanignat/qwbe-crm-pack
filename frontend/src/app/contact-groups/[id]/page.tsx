// One contact group: rename it, see its contacts a page at a time, add an
// existing contact, remove a membership. There is no delete: the cube
// publishes no delete-group endpoint.
import Link from "next/link"

import { ContactGroupDetail } from "@/components/contact-group-detail"
import { Button } from "@/components/ui/button"

export default function ContactGroupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href="/contact-groups">← Contact groups</Link>
        </Button>
      </div>
      <Detail params={params} />
    </main>
  )
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // key: going from one group to another must not reuse the previous group's
  // component instance. Without it the picked contact, the typed text, the
  // status note and the page number of the PREVIOUS group survive the
  // navigation. The hook guards its own answers by id as well, so a slow
  // response for the old group cannot paint here either way.
  return <ContactGroupDetail key={id} groupId={id} />
}
