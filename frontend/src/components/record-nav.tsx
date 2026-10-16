// vtiger's previous / next record arrows on a detail page, through the list
// the record was opened from. An end of that list is a disabled arrow.

import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

function Arrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <Button variant="outline" size="icon" disabled aria-label={`${label} (none)`}>
        {children}
      </Button>
    )
  }
  return (
    <Button variant="outline" size="icon" asChild>
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  )
}

export function RecordNav({ previousHref, nextHref, noun }: { previousHref: string | null; nextHref: string | null; noun: string }) {
  return (
    <nav aria-label={`${noun} navigation`} className="flex gap-1">
      <Arrow href={previousHref} label={`Previous ${noun}`}>
        <ChevronLeftIcon aria-hidden />
      </Arrow>
      <Arrow href={nextHref} label={`Next ${noun}`}>
        <ChevronRightIcon aria-hidden />
      </Arrow>
    </nav>
  )
}
