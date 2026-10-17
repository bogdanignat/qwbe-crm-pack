"use client"

// A titled block that opens and closes from its header, as vtiger's detail
// blocks do. Open by default; the viewer's choice is remembered per block in
// this browser (hooks/use-block-open.ts). `aside` sits on the header's right
// (a count, a button) and stays outside the toggle.

import { ChevronRight } from "lucide-react"

import { PANEL_FRAME, PanelHeader } from "@/components/kit/panel-header"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useBlockOpen } from "@/hooks/use-block-open"
import { cn } from "@/lib/utils"

export function CollapsibleBlock({
  storageKey,
  title,
  aside,
  children,
}: {
  storageKey: string
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useBlockOpen(storageKey)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("group/block", PANEL_FRAME)}>
      <PanelHeader
        aside={aside}
        className="flex-nowrap rounded-t-lg px-1.5 group-data-[state=closed]/block:rounded-b-lg group-data-[state=closed]/block:border-b-0"
      >
        <h3 className="min-w-0 flex-1">
          <CollapsibleTrigger className="label-mono flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-foreground outline-none hover:text-foreground/80 focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/block:rotate-90"
            />
            {title}
          </CollapsibleTrigger>
        </h3>
      </PanelHeader>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
