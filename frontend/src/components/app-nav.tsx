// The bar every signed-in page carries: where you are, where else you can go, and the way out.
//
// Without it the app was a dead end -- login landed on the identity page and nothing linked to the
// lists, so the only way to reach them was to type the URL. The entries are the app's routes, not
// the cubes: a new cube gets a page when someone writes one, and that page adds itself here.
//
// It renders from the root layout, so a page added later carries the bar without doing anything,
// and the detail pages get it too. The signed-out pages are the exception, listed below.

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

const ENTRIES = [
  { href: "/organizations", label: "Organizations" },
  { href: "/contacts", label: "Contacts" },
  // Business groups OF CONTACTS, next to the contacts they group. Not the
  // permission groups in Settings, which group user accounts.
  { href: "/contact-groups", label: "Contact groups" },
  { href: "/echo", label: "Echo" },
  { href: "/settings", label: "Settings" },
] as const

// Routes reachable without a session: a bar offering Organizations and "Log out" to someone who
// is not signed in would only produce a redirect back here.
const SIGNED_OUT = ["/login"]

export function AppNav() {
  const pathname = usePathname()
  if (SIGNED_OUT.includes(pathname)) return null
  return (
    <nav className="border-b" aria-label="Main">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 p-3">
        <span className="mr-2 font-semibold">CRM</span>
        {ENTRIES.map((entry) => {
          // A detail page (/organizations/<id>) keeps its section marked as current.
          const current = pathname === entry.href || pathname.startsWith(`${entry.href}/`)
          return (
            <Button
              key={entry.href}
              asChild
              variant={current ? "secondary" : "ghost"}
              size="sm"
              aria-current={current ? "page" : undefined}
            >
              <Link href={entry.href}>{entry.label}</Link>
            </Button>
          )
        })}
        <Separator orientation="vertical" className="mx-2 h-6" />
        <Button asChild variant="ghost" size="sm">
          <Link href="/me">Profile</Link>
        </Button>
        <form action="/api/logout" method="post" className="ml-auto">
          <Button type="submit" variant="outline" size="sm">
            Log out
          </Button>
        </form>
      </div>
    </nav>
  )
}
