"use client"

// The detail header, vtiger's: "[ACC No] Organization Name", "Updated <when>
// by <who>", the company status and legal form, and Edit / Duplicate / Delete
// on the right, after vtiger's previous / next arrows when the record was
// opened from the list (they walk the list page it was on).

import Link from "next/link"
import { CopyPlus, PencilIcon, Trash2 } from "lucide-react"

import { DisabledAction } from "@/components/disabled-action"
import { MockTag } from "@/components/mock-tag"
import { RecordNav } from "@/components/record-nav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusLight } from "@/components/ui/status-light"
import type { Row } from "@/lib/cube"
import { headerBadgesOf, organizationTitleOf, updatedLineOf } from "@/lib/organization-summary"

const DEMO_READ_ONLY = "Demo records are read-only"

export function OrganizationHeader({
  row,
  demo,
  onEdit,
  duplicateHref,
  nav,
}: {
  row: Row
  demo: boolean
  // Absent while a draft is open: it must be saved or cancelled first.
  onEdit?: () => void
  duplicateHref: string
  // The neighbours in the list it was opened from; null without one.
  nav: { previousHref: string | null; nextHref: string | null } | null
}) {
  const { number, name } = organizationTitleOf(row)
  const updated = updatedLineOf(row)
  const badges = headerBadgesOf(row)

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-xl font-semibold break-words">
          {number && <span className="mr-1.5 font-mono text-muted-foreground">[{number}]</span>}
          {name}
          {demo && <MockTag>demo</MockTag>}
        </h1>
        {updated && <p className="text-sm text-muted-foreground">{updated}</p>}
        {badges.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Status">
            {badges.map((badge) => (
              <li key={badge.label} title={badge.label}>
                {badge.tone ? (
                  <StatusLight tone={badge.tone}>
                    <span className="sr-only">{badge.label}: </span>
                    {badge.value}
                  </StatusLight>
                ) : (
                  <Badge variant="outline" className="font-mono">
                    <span className="sr-only">{badge.label}: </span>
                    {badge.value}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {nav && <RecordNav {...nav} noun="organization" />}
        {demo ? (
          <DisabledAction variant="outline" reason={DEMO_READ_ONLY}>
            <PencilIcon aria-hidden /> Edit
          </DisabledAction>
        ) : (
          <Button variant="outline" disabled={!onEdit} onClick={onEdit}>
            <PencilIcon aria-hidden /> Edit
          </Button>
        )}
        {demo ? (
          <DisabledAction variant="outline" reason={DEMO_READ_ONLY}>
            <CopyPlus aria-hidden /> Duplicate
          </DisabledAction>
        ) : (
          <Button variant="outline" asChild>
            <Link href={duplicateHref}>
              <CopyPlus aria-hidden /> Duplicate
            </Link>
          </Button>
        )}
        <DisabledAction variant="outline">
          <Trash2 aria-hidden /> Delete
        </DisabledAction>
      </div>
    </header>
  )
}
