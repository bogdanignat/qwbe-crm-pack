// The frame every signed-in page renders in (T-1812, spec §1.5): the module menu on
// the left, and on top the global search, "+ New" (vtiger's Quick Create) and the
// account menu. It renders from the root layout, so a page added later gets it for
// free; the signed-out pages are the exception, listed below.

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, LogOut, Plus, UserRound } from "lucide-react"

import { AppSidebar, PageIcon } from "@/components/app-sidebar"
import { SearchPalette } from "@/components/search-palette"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCurrentUser, type CurrentUserState } from "@/hooks/use-current-user"
import { APP_PAGES } from "@/lib/app-pages"

// Routes reachable without a session: a menu there would only lead back to /login.
const SIGNED_OUT = ["/login"]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (SIGNED_OUT.includes(pathname)) return children
  return <SignedInShell>{children}</SignedInShell>
}

function SignedInShell({ children }: { children: React.ReactNode }) {
  const me = useCurrentUser()
  return (
    // One TooltipProvider for every tooltip of the signed-in pages.
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar admin={me.user?.admin ?? false} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger aria-label="Toggle menu" />
            <div className="flex min-w-0 flex-1">
              <SearchPalette />
            </div>
            <NewMenu />
            <UserMenu me={me} />
          </header>
          {children}
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}

function NewMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {APP_PAGES.filter((page) => page.newLabel).map((page) => (
          <DropdownMenuItem key={page.href} asChild>
            <Link href={`${page.href}/new`}>
              <PageIcon href={page.href} />
              {page.newLabel}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The account menu names the user; while /auth/me is on its way it says so, and
// when it fails the menu still offers Preferences and Sign out.
function UserMenu({ me }: { me: CurrentUserState }) {
  const username = me.user?.username ?? null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu${username ? ` for ${username}` : ""}`}>
          <Avatar>
            <AvatarFallback>{(username ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuLabel>
          <span className="block text-xs font-normal text-muted-foreground">Signed in as</span>
          <span className="block text-sm font-medium text-foreground">
            {me.status === "failed" ? "Unknown user" : (username ?? "...")}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/me">
            <UserRound aria-hidden />
            Preferences
          </Link>
        </DropdownMenuItem>
        {/* The same POST /api/logout the old bar's form sent: it ends the qwbe
            session and clears the cookie. */}
        <DropdownMenuItem asChild>
          <button type="submit" form="sign-out" className="w-full">
            <LogOut aria-hidden />
            Sign out
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
      <form id="sign-out" action="/api/logout" method="post" hidden />
    </DropdownMenu>
  )
}
