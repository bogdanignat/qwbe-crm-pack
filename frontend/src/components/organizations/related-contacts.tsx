"use client"

// The Contacts related list (vtiger's "More Information" tab): the contacts
// whose organizationId is this organization, a count in the header, vtiger's
// columns, paging, and "Add Contact" opening the contact form with the
// organization already chosen. A demo organization is not in the backend, so
// it asks nothing: its made-up contacts come from the mock, read-only.

import Link from "next/link"
import { useState } from "react"
import { useGetList } from "ra-core"
import { ChevronLeft, ChevronRight, UserPlus } from "lucide-react"

import { CollapsibleBlock } from "@/components/collapsible-block"
import { DisabledAction } from "@/components/disabled-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCubeMetadata } from "@/hooks/use-cube-metadata"
import { rowHref, type Row } from "@/lib/cube"
import { editAllHref } from "@/lib/edit-link"
import {
  CONTACTS_CUBE,
  CONTACTS_PAGE_SIZE,
  contactColumnsOf,
  contactsRangeOf,
  contactsSortOf,
  sortedRowsOf,
} from "@/lib/related-contacts"
import { demoContactsOf } from "@/mock/organizations"
import { ContactsTable } from "./contacts-table"

export function RelatedContacts({ organizationId, demo }: { organizationId: string; demo: boolean }) {
  const [page, setPage] = useState(1)
  const { meta, error: metaError } = useCubeMetadata(CONTACTS_CUBE)
  const sortBy = meta ? contactsSortOf(meta) : undefined
  const { data, total, isPending, error } = useGetList<Row & { id: string }>(
    CONTACTS_CUBE,
    {
      pagination: { page, perPage: CONTACTS_PAGE_SIZE },
      sort: sortBy ? { field: sortBy, order: "ASC" } : undefined,
      filter: { organizationId },
    },
    // The order comes from the metadata: ask once it is known.
    { enabled: !demo && meta !== undefined },
  )
  const demoRows = demo ? sortedRowsOf(demoContactsOf(organizationId), sortBy) : []
  const rows = demo ? demoRows.slice((page - 1) * CONTACTS_PAGE_SIZE, page * CONTACTS_PAGE_SIZE) : (data ?? [])
  const count = demo ? demoRows.length : total
  const lastPage = count === undefined ? undefined : Math.max(1, Math.ceil(count / CONTACTS_PAGE_SIZE))
  const hasNext = lastPage === undefined ? rows.length === CONTACTS_PAGE_SIZE : page < lastPage
  const failure = metaError ?? (error ? (error as Error).message : null)

  const addContact = demo ? (
    <DisabledAction size="sm" variant="outline" reason="Demo records are read-only">
      <UserPlus aria-hidden /> Add Contact
    </DisabledAction>
  ) : (
    <Button size="sm" variant="outline" asChild>
      <Link href={`/contacts/new?organizationId=${encodeURIComponent(organizationId)}`}>
        <UserPlus aria-hidden /> Add Contact
      </Link>
    </Button>
  )

  return (
    <CollapsibleBlock
      storageKey="organizations.related.Contacts"
      title={
        <>
          Contacts
          {count !== undefined && (
            <Badge variant="secondary" aria-label={`${count} contacts`}>
              {count}
            </Badge>
          )}
        </>
      }
      aside={addContact}
    >
      {failure ? (
        <p role="alert" className="p-3 text-sm text-destructive">
          {failure}
        </p>
      ) : !meta || (!demo && isPending) ? (
        <Skeleton className="m-3 h-24" />
      ) : rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No contacts.</p>
      ) : (
        <>
          <ContactsTable
            columns={contactColumnsOf(meta)}
            rows={rows}
            hrefOf={(row) => (demo ? null : rowHref(CONTACTS_CUBE, String(row.id)))}
            editHrefOf={(row) => {
              const href = demo ? null : rowHref(CONTACTS_CUBE, encodeURIComponent(String(row.id)))
              return href && editAllHref(href)
            }}
          />
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-muted-foreground">
            <span>Showing {contactsRangeOf(page, rows.length, count)}</span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label="Next page"
                disabled={!hasNext}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight aria-hidden />
              </Button>
            </span>
          </div>
        </>
      )}
    </CollapsibleBlock>
  )
}
