// The menu icon of each page, by href. The registry (lib/app-pages.ts) stays
// free of UI; a test checks that every page has one.

import { Activity, Building2, Settings, Users, type LucideIcon } from "lucide-react"

export const PAGE_ICONS: Record<string, LucideIcon> = {
  "/organizations": Building2,
  "/contacts": Users,
  "/echo": Activity,
  "/settings": Settings,
}
