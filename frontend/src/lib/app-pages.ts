// The pages the app has, in menu order (T-1812): the one list the sidebar, "+ New",
// the global search and the relation links (lib/cube.ts) derive from. A page with a
// `cube` is a CRM module: its records open at `${href}/<id>`. `newLabel` puts it in
// "+ New" (its form is `${href}/new`), `search` in the global search.
// A vtiger module gets an entry here once it has a page; the missing ones are in
// docs/plan/organizations-backend.md §7.

// The vtiger 5.4 groups that have a page today; "Administration" is the admin-only
// block at the bottom of the menu.
export type MenuGroup = "Sales" | "Tools" | "Administration"

export type AppPage = {
  href: string
  label: string
  group: MenuGroup
  cube?: string
  newLabel?: string
  search?: boolean
}

export const APP_PAGES: readonly AppPage[] = [
  {
    href: "/organizations",
    label: "Organizations",
    group: "Sales",
    cube: "crm/organizations",
    newLabel: "New Organization",
    search: true,
  },
  { href: "/contacts", label: "Contacts", group: "Sales", cube: "crm/contacts", newLabel: "New Contact", search: true },
  { href: "/echo", label: "Echo", group: "Tools" },
  { href: "/settings", label: "Settings", group: "Administration" },
]
