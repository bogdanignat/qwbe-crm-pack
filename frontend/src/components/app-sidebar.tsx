// The main menu: the vtiger 5.4 module groups (spec §1.2, §1.5), holding the pages
// of the registry (lib/app-pages.ts). The modules still missing are listed in
// docs/plan/organizations-backend.md; a group with no page yet does not appear.
// On a narrow screen the shadcn Sidebar renders itself as a drawer (Sheet).

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { APP_PAGES, type AppPage } from "@/lib/app-pages"
import { PAGE_ICONS } from "@/components/page-icons"

export function PageIcon({ href }: { href: string }) {
  const Icon = PAGE_ICONS[href]
  return Icon ? <Icon aria-hidden /> : null
}

// The groups in registry order; the admin-only block goes to the bottom.
const GROUPS = [...new Set(APP_PAGES.map((page) => page.group))]
  .filter((group) => group !== "Administration")
  .map((label) => ({ label, entries: APP_PAGES.filter((page) => page.group === label) }))
const ADMIN_PAGES = APP_PAGES.filter((page) => page.group === "Administration")

function NavLink({ entry }: { entry: AppPage }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  // A detail page (/organizations/<id>) keeps its module marked as current.
  const current = pathname === entry.href || pathname.startsWith(`${entry.href}/`)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={current}>
        <Link href={entry.href} aria-current={current ? "page" : undefined} onClick={() => setOpenMobile(false)}>
          <PageIcon href={entry.href} />
          <span>{entry.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar({ admin }: { admin: boolean }) {
  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/organizations" className="px-2 py-1 text-base font-semibold">
          crm-pack
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main">
          {GROUPS.map((group) => (
            <Collapsible key={group.label} defaultOpen className="group/collapsible">
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="w-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                    {group.label}
                    <ChevronRight
                      aria-hidden
                      className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90"
                    />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.entries.map((entry) => (
                        <NavLink key={entry.href} entry={entry} />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ))}
        </nav>
      </SidebarContent>
      {/* Only an admin sees this block; the pages and the backend still check the permission. */}
      {admin && (
        <SidebarFooter>
          <nav aria-label="Administration">
            <SidebarMenu>
              {ADMIN_PAGES.map((entry) => (
                <NavLink key={entry.href} entry={entry} />
              ))}
            </SidebarMenu>
          </nav>
        </SidebarFooter>
      )}
    </Sidebar>
  )
}
