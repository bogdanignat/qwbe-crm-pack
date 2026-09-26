"use client"

// ONE contact group: its name (renameable), its members, and the two
// membership writes.
//
// A member row is a CONTACT -- name and company, linked to the contact's own
// detail page. No username, no account, no access: adding someone here gives
// them nothing, and the copy on this page says so rather than leaving an
// operator to assume a group is a permission.
//
// Presentation only: the requests, the batch that resolves a page of
// contactIds, the refusals and the paging arithmetic live in
// hooks/use-contact-group-members.ts and the two lib modules.

import { useMemo, useRef, useState } from "react"
import Link from "next/link"

import { useContactGroupMembers } from "@/hooks/use-contact-group-members"
import { ContactGroupNameForm } from "@/components/contact-group-name-form"
import { ContactPicker } from "@/components/contact-picker"
import {
  memberAddedMessage,
  memberLabelOf,
  memberRemoveLabel,
  memberRemovedMessage,
  type ContactSuggestion,
  type ExcludedContact,
  type MemberRow,
} from "@/lib/contact-directory"
import { hrefForRelation } from "@/lib/cube"
import { CONTACTS_CUBE } from "@/lib/contact-directory"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type ContactGroupDetailProps = { groupId: string }

export function ContactGroupDetail({ groupId }: ContactGroupDetailProps) {
  const members = useContactGroupMembers(groupId)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState("")
  // The contact the operator actually picked. The ONLY id this page ever
  // posts: there is no field in which an id can be typed, because the backend
  // cannot verify that one exists (contract, known limit 1).
  const [picked, setPicked] = useState<ContactSuggestion | null>(null)
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  // The memberships THIS PAGE holds. Deliberately bounded: marking every member
  // of a large group would mean downloading the whole membership list, which is
  // exactly the N+1/whole-cube download this feature refuses. A member on
  // another page is therefore still offered, and adding it is harmless --
  // adding is idempotent, the server returns the existing row, and the message
  // states the resulting fact without claiming anything was created.
  const excluded = useMemo<ExcludedContact[]>(
    () =>
      members.rows.map((row) => ({
        id: row.contactId,
        reason: "Already in this group",
      })),
    [members.rows],
  )

  const pick = (contact: ContactSuggestion) => {
    setPicked(contact)
    setText(contact.name)
    setNote(null)
  }

  // Any typing after a pick drops the pick: the id that is posted must be the
  // row the operator chose, never one left behind under different text.
  const retype = (next: string) => {
    setText(next)
    setPicked(null)
    setNote(null)
  }

  const add = async () => {
    if (picked === null) return
    const result = await members.addMember(picked.id)
    if (result.ok) {
      // The neutral fact, for EVERY success: adding is idempotent and a 200
      // carries no "created" flag, so "was added" would be a claim this page
      // cannot back up for a contact that was already a member.
      setNote({ kind: "ok", text: memberAddedMessage(picked.name) })
      setPicked(null)
      setText("")
      return
    }
    setNote({ kind: "error", text: result.message })
  }

  const remove = async (row: MemberRow) => {
    const result = await members.removeMember(row.contactId)
    setNote(
      result.ok
        ? { kind: "ok", text: memberRemovedMessage(row) }
        : { kind: "error", text: result.message },
    )
  }

  if (members.groupAccess === "loading") {
    return (
      <div className="flex flex-col gap-2">
        {/* The skeleton is decoration; the one sentence under it is what a
            screen reader is told while the group is being read. */}
        <Skeleton className="h-32 w-full" aria-hidden />
        <span role="status" className="sr-only">
          Loading this contact group…
        </span>
      </div>
    )
  }
  if (members.groupAccess === "denied") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        You may not see this contact group.
      </p>
    )
  }
  if (members.groupAccess === "missing") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          This contact group does not exist.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/contact-groups">Back to contact groups</Link>
        </Button>
      </div>
    )
  }
  if (members.groupAccess === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" className="text-sm text-destructive">
          {members.groupError ?? "this contact group could not be loaded"}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={members.reload}>
          Retry
        </Button>
      </div>
    )
  }

  const group = members.group
  const view = members.view

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          {/* Exactly as stored: spacing and casing are the operator's. */}
          <CardTitle>{group?.name ?? "Contact group"}</CardTitle>
          <CardDescription>
            A set of contacts. Membership is not access: nobody gains a permission by being
            listed here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {group !== null && (
            <ContactGroupNameForm
              // key: a group loaded later (or a different group) must not
              // leave the previous name in the field.
              key={group.id}
              label="Rename group"
              submitLabel="Rename"
              initialName={group.name}
              // No `known`: this page holds no list of other groups, and
              // fetching one just to guess at a duplicate would be a request
              // whose answer the server gives authoritatively anyway (409).
              selfId={group.id}
              busy={members.busy}
              onSubmit={async (name) => {
                const result = await members.rename(name)
                return result.ok ? { ok: true } : { ok: false, message: result.message }
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a contact</CardTitle>
          <CardDescription>
            Only contacts that already exist can be added. Adding one grants no access to any
            record.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <ContactPicker
            ref={pickerRef}
            value={text}
            excluded={excluded}
            onValueChange={retype}
            onPick={pick}
            purpose="Adds a contact to this group."
          />
          <Button type="button" size="sm" disabled={picked === null || members.busy} onClick={add}>
            Add to group
          </Button>
          {note !== null && (
            <p
              role="status"
              className={`w-full text-xs ${note.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {note.text}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Contacts in this group. A contact can belong to several groups.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {members.membersAccess === "loading" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2" aria-hidden>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
              <span role="status" className="sr-only">
                Loading the contacts in this group…
              </span>
            </div>
          )}
          {members.membersAccess === "denied" && (
            <p role="status" className="text-sm text-muted-foreground">
              You may not see the contacts in this group. Reading members needs permission to read
              contacts as well.
            </p>
          )}
          {members.membersAccess === "missing" && (
            <p role="status" className="text-sm text-muted-foreground">
              This contact group no longer exists.
            </p>
          )}
          {members.membersAccess === "failed" && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-sm text-destructive">
                {members.membersError ?? "the members could not be loaded"}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={members.reload}>
                Retry
              </Button>
            </div>
          )}
          {/* Said only when the SERVER says the group holds nothing. An empty
              PAGE is not an empty group: the hook corrects a page that is past
              the end before anything is painted. */}
          {members.membersAccess === "ready" && members.membersEmpty && (
            <p role="status" className="text-sm text-muted-foreground">
              This group has no contacts yet. An empty group is perfectly valid.
            </p>
          )}
          {members.identitiesUnavailable && (
            <p role="status" className="text-sm text-destructive">
              The contact names could not be loaded, so the rows below show what the group holds
              and nothing more.
            </p>
          )}

          {members.membersAccess === "ready" && members.rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Membership</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.rows.map((row) => {
                  const label = memberLabelOf(row)
                  const href = hrefForRelation(CONTACTS_CUBE, row.contactId)
                  return (
                    <TableRow key={row.membershipId}>
                      <TableCell>
                        {row.contact !== null && href !== null ? (
                          <Link className="underline underline-offset-4" href={href}>
                            {label.primary}
                          </Link>
                        ) : (
                          // A membership the contacts cube did not return: the
                          // row is real, the person is not available. It is
                          // never rendered as a link to a page that would 404,
                          // and never as the raw id pretending to be a name.
                          <span className="text-muted-foreground">{label.primary}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {label.secondary ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={members.busy}
                          // Its own sentence when the contact is unavailable:
                          // "Remove Contact unavailable from this group" would
                          // read as if someone were named that.
                          aria-label={memberRemoveLabel(row)}
                          onClick={() => remove(row)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
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
                  onClick={() => members.setPage(Math.max(1, members.page - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {members.page}
                  {view.lastPage !== undefined ? ` of ${view.lastPage}` : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!view.hasNext}
                  onClick={() => members.setPage(members.page + 1)}
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
