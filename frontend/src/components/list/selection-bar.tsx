// The bar that appears once rows are ticked (vtiger's mass buttons): how many,
// a way to untick them all, and the list's mass actions.

import { Button } from "@/components/ui/button"

export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number
  onClear: () => void
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div
      role="region"
      aria-label="Selection"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"
    >
      <span className="text-sm font-medium" aria-live="polite">
        {count} selected
      </span>
      <Button variant="link" size="sm" className="h-8 px-1" onClick={onClear}>
        Clear selection
      </Button>
      <div className="flex flex-wrap gap-2 sm:ml-auto">{children}</div>
    </div>
  )
}
