// The empty list, never a silent empty table. Nothing yet: say so and offer
// the create action. Nothing matching: say what was searched and offer to
// clear it, not to create.

import Link from "next/link"
import { PlusIcon, SearchXIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function ListEmpty({
  filtered,
  message,
  createHref,
  addLabel,
  onClear,
}: {
  filtered: boolean
  message: string
  createHref?: string
  addLabel: string
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      {filtered ? (
        <>
          <SearchXIcon aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing matches the current search and filters.</p>
          <Button variant="outline" onClick={onClear}>
            Clear search and filters
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{message}</p>
          {createHref && (
            <Button asChild>
              <Link href={createHref}>
                <PlusIcon aria-hidden /> {addLabel}
              </Link>
            </Button>
          )}
        </>
      )}
    </div>
  )
}
