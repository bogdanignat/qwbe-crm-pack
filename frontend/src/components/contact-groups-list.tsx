"use client"

// Contact groups: one page of them, the name search, and the create form.
//
// Business groups of CRM CONTACTS. They are not the kernel's access groups and
// nothing on this page grants anybody access to anything -- see
// lib/contact-groups.ts.
//
// Presentation only: every request, every refusal and the paging arithmetic
// live in hooks/use-contact-groups.ts and lib/contact-groups.ts.

import Link from "next/link"

import { useContactGroups } from "@/hooks/use-contact-groups"
import { ContactGroupNameForm } from "@/components/contact-group-name-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function ContactGroupsList() {
  const list = useContactGroups()
  const { access, groups, view, error, query, settledQuery, pending, setQuery, page, setPage, busy } =
    list

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>New contact group</CardTitle>
          <CardDescription>
            A group is a set of contacts. It gives nobody access to anything.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {access === "denied" ? (
            <p className="text-sm text-muted-foreground">
              You may not manage contact groups.
            </p>
          ) : (
            <ContactGroupNameForm
              label="Group name"
              submitLabel="Create group"
              known={groups}
              busy={busy}
              resetOnSuccess
              onSubmit={list.create}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact groups</CardTitle>
          <CardDescription>Search by name, then open a group to manage its contacts.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex w-full flex-col gap-1 sm:w-72">
            <Label htmlFor="contact-groups-search">Search</Label>
            <Input
              id="contact-groups-search"
              value={query}
              placeholder="Name starts with…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {access === "loading" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2" aria-hidden>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
              <span role="status" className="sr-only">
                Loading contact groups…
              </span>
            </div>
          )}
          {/* A search that has been typed but not yet answered. The rows below
              are still the PREVIOUS answer, so this says so rather than letting
              them read as the result for what is in the box. */}
          {access === "ready" && pending && (
            <p role="status" className="text-sm text-muted-foreground">
              Searching…
            </p>
          )}
          {access === "denied" && (
            <p role="status" className="text-sm text-muted-foreground">
              You may not read contact groups.
            </p>
          )}
          {access === "failed" && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-sm text-destructive">
                {error ?? "the contact groups could not be loaded"}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={list.reload}>
                Retry
              </Button>
            </div>
          )}
          {/* Said about the query the rows ANSWER, and only once they do: while
              a newer text is still pending, the previous answer says nothing
              about it. */}
          {access === "ready" && !pending && groups.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {settledQuery.trim() === ""
                ? "No contact groups yet."
                : `No group matches "${settledQuery}".`}
            </p>
          )}

          {access === "ready" && groups.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      {/* The name renders exactly as it was stored: this app
                          never re-cases a name the operator chose. */}
                      <Link className="underline underline-offset-4" href={`/contact-groups/${group.id}`}>
                        {group.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {group.createdAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {view !== null && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {view.total !== undefined
                  ? `${view.from}-${view.to} of ${view.total}`
                  : `${view.from}-${view.to}`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!view.hasPrevious}
                  onClick={() => setPage(Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page}
                  {view.lastPage !== undefined ? ` of ${view.lastPage}` : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // Without a total, a full page is the only evidence that
                  // another one may exist.
                  disabled={!view.hasNext}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
