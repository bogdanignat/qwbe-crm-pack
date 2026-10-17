// The header strip of a machine panel (T-1817): the recessed band with the
// amber tab (the panel-strip utility, shared with Card), the title as a mono
// uppercase label, and `aside` on the right (a count, a button). The caller
// gives the title its heading level and, for a collapsible block, its toggle.

import { cn } from "@/lib/utils"

export function PanelHeader({
  children,
  aside,
  className,
}: {
  children: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("panel-strip flex min-h-10 flex-wrap items-center gap-2 px-3 py-1", className)}>
      {children}
      {aside}
    </div>
  )
}

// The frame around a panel: 1px border on the card surface.
export const PANEL_FRAME = "min-w-0 rounded-lg border bg-card"
