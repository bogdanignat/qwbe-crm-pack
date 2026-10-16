"use client"

// vtiger's two detail tabs: the record's blocks and its related lists. The
// caller keeps the active tab (in the URL, hooks/use-url-tab.ts). While a
// draft is open the other tab is locked: leaving would unmount the form and
// drop the edits silently, so the reader saves or cancels first. A locked tab
// stays focusable (aria-disabled, as DisabledAction), so hover and keyboard
// focus both show why; choosing it does nothing.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const ORGANIZATION_TABS = ["info", "more"] as const
export type OrganizationTab = (typeof ORGANIZATION_TABS)[number]

const TAB_LABELS: Record<OrganizationTab, string> = { info: "Organization Information", more: "More Information" }
const LOCKED_HINT = "Save or cancel the open edit first"

export function OrganizationTabs({
  tab,
  onTabChange,
  locked,
  info,
  more,
}: {
  tab: OrganizationTab
  onTabChange: (tab: string) => void
  locked: boolean
  info: React.ReactNode
  more: React.ReactNode
}) {
  const change = (value: string) => {
    if (!locked) onTabChange(value)
  }

  return (
    <Tabs value={tab} onValueChange={change} className="gap-4">
      <TabsList className="h-auto flex-wrap">
        {ORGANIZATION_TABS.map((value) =>
          locked && value !== tab ? (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value={value}
                  aria-disabled="true"
                  aria-description={LOCKED_HINT}
                  className="min-h-8 cursor-not-allowed opacity-50 hover:text-foreground/70"
                >
                  {TAB_LABELS[value]}
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>{LOCKED_HINT}</TooltipContent>
            </Tooltip>
          ) : (
            <TabsTrigger key={value} value={value} className="min-h-8">
              {TAB_LABELS[value]}
            </TabsTrigger>
          ),
        )}
      </TabsList>
      <TabsContent value="info">{info}</TabsContent>
      <TabsContent value="more">{more}</TabsContent>
    </Tabs>
  )
}
