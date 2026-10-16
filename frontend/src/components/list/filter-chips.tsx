// The active search and filters as chips under the toolbar, each removable,
// plus "Clear all": what narrows the list is always in view.

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { FilterChip } from "@/lib/list-filters"

export function FilterChips({
  chips,
  onRemove,
  onClear,
}: {
  chips: readonly FilterChip[]
  onRemove: (key: string) => void
  onClear: () => void
}) {
  if (chips.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-0.5 pl-2.5 text-sm"
        >
          <span className="text-muted-foreground">{chip.label}:</span>
          <span className="max-w-48 truncate font-medium">{chip.value}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label={`Remove ${chip.label} ${chip.value}`}
            onClick={() => onRemove(chip.key)}
          >
            <XIcon aria-hidden />
          </Button>
        </li>
      ))}
      <li>
        <Button variant="link" size="sm" className="h-7" onClick={onClear}>
          Clear all
        </Button>
      </li>
    </ul>
  )
}
