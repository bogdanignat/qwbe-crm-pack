"use client"

// One member row of a permission group, with a two-step remove. The target is
// the row's account id, resolved to a username by the adapter right before the
// request; a row whose lookup failed shows the opaque id and can still be
// removed if the directory answers at click time. The operator never types the
// target.

import { useEffect, useRef, useState } from "react"

import { Badge } from "shadcn-admin-kit"

import { memberLabelOf, type MemberRow } from "@/lib/sharing"
import { Button } from "@/components/ui/button"

export function MemberItem({
  row,
  busy,
  onRemove,
}: {
  row: MemberRow
  busy: boolean
  onRemove: (row: MemberRow) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const member = memberLabelOf(row)
  // Controls are named by the HANDLE, never by the display name: a control
  // whose accessible name moves when the directory renames someone cannot be
  // addressed twice by the same words. The display name still leads visually
  // (`member.primary`), it just does not name the buttons.
  const label = member.control
  const removeRef = useRef<HTMLButtonElement | null>(null)
  const refocus = useRef(false)
  // The Remove button only exists once the confirm step is closed, so focus is
  // restored after that render, not in the same tick.
  useEffect(() => {
    if (!confirming && refocus.current) {
      refocus.current = false
      removeRef.current?.focus()
    }
  }, [confirming])
  const cancel = () => {
    refocus.current = true
    setConfirming(false)
  }
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && confirming) cancel()
      }}
    >
      <span className="font-medium">{member.primary}</span>
      {member.secondary && <span className="text-muted-foreground">{member.secondary}</span>}
      {member.unresolved && <Badge variant="secondary">username unresolved</Badge>}
      {confirming ? (
        <span role="group" aria-label={`Confirm remove ${label}`} className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            aria-label={`Confirm remove ${label}`}
            onClick={() => {
              setConfirming(false)
              onRemove(row)
            }}
          >
            Confirm remove
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancel remove ${label}`} onClick={cancel}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          ref={removeRef}
          className="ml-auto"
          disabled={busy}
          aria-label={`Remove ${label}`}
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      )}
    </li>
  )
}
