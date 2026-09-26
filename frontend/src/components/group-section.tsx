"use client"

// One selected permission group: its name, its members page, and the add/remove
// controls. Presentation only -- the requests, the paging, the staleness guards
// and the refusal wording live in hooks/use-group-members.ts.

import { useRef, useState } from "react"
import { toast } from "sonner"

import { MEMBERS_PAGE, useGroupMembers } from "@/hooks/use-group-members"
import { memberMarks, normalizeUsername, type MemberRow, type PermissionGroupRef } from "@/lib/sharing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { MemberItem } from "@/components/member-item"
import { UserPicker } from "@/components/user-picker"

export function GroupSection({
  group,
  busy,
  setBusy,
  onChanged,
}: {
  group: PermissionGroupRef
  busy: boolean
  setBusy: (busy: boolean) => void
  onChanged: () => void
}) {
  const members = useGroupMembers({ group, setBusy, onChanged })
  const [name, setName] = useState(group.name)
  const [username, setUsername] = useState("")
  // What the typed text NAMES, sigil stripped (lib/sharing.ts). `username`
  // itself stays exactly as typed -- it is the input's value and the picker's
  // own heading echoes it -- so the field never rewrites itself under the
  // caret; only the identity derived from it is normalized.
  const target = normalizeUsername(username)
  const pickerRef = useRef<HTMLInputElement | null>(null)

  // `null` from any of the three writes means this section was replaced while
  // the request was in flight (another group selected, or the access scope
  // switched): there is nothing to announce, because every sentence below names
  // THIS group and the operator is now looking at another one.
  const rename = async () => {
    const outcome = await members.rename(name)
    if (outcome === null) return
    if (outcome.ok) toast.success(`Renamed group to ${outcome.group.name}`)
    else toast.error(outcome.message)
  }

  const add = async () => {
    const outcome = await members.add(target)
    if (outcome === null) return
    if (!outcome.ok) {
      toast.error(outcome.message)
      return
    }
    toast.success(`Added @${target} to ${group.name}`)
    setUsername("")
    requestAnimationFrame(() => pickerRef.current?.focus())
  }

  const remove = async (row: MemberRow) => {
    const outcome = await members.remove(row)
    if (outcome === null) return
    if (outcome.ok) toast.success(`Removed @${outcome.username ?? ""} from ${group.name}`)
    else toast.error(outcome.message)
  }

  const { page, rows } = members
  const shownFrom = page && rows.length > 0 ? page.offset + 1 : 0
  const shownTo = page ? page.offset + rows.length : 0
  // Members of the page stay visible in the picker, disabled, with the group's
  // own wording -- the shared picker never says "group" on its own.
  // `marked`/`incomplete` come from the same derivation (lib/sharing.ts), so
  // the notice below counts what was really marked, not the rows.
  const marks = memberMarks(rows, page?.total ?? 0, "Already in group")

  return (
    <section aria-label={`Group ${group.name}`} className="flex flex-col gap-4 border-t pt-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() !== "" && name.trim() !== group.name) void rename()
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="groups-rename">Group name</Label>
          <Input
            id="groups-rename"
            className="w-64"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy || name.trim() === "" || name.trim() === group.name}
        >
          Rename
        </Button>
      </form>

      {members.state.kind === "loading" && (
        <Skeleton role="status" className="h-12 w-full" aria-label="Loading members" />
      )}
      {members.state.kind === "failed" && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive">
            {members.state.message}
          </p>
          <Button size="sm" variant="outline" className="self-start" onClick={members.refetch}>
            Retry
          </Button>
        </div>
      )}
      {page && (
        <>
          {rows.length === 0 && page.total === 0 ? (
            <p className="text-sm text-muted-foreground">Members: none</p>
          ) : (
            <ul aria-label="Members" className="flex flex-col gap-2">
              {rows.map((row) => (
                <MemberItem key={row.membershipId} row={row} busy={busy} onRemove={remove} />
              ))}
            </ul>
          )}
          {(page.total > MEMBERS_PAGE || page.offset > 0) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Showing {shownFrom}-{shownTo} of {page.total}
              </span>
              <Button size="sm" variant="outline" disabled={!members.hasPrevious} onClick={members.previous}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={!members.hasNext} onClick={members.next}>
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (target !== "") void add()
        }}
      >
        <div className="flex flex-col gap-1">
          <UserPicker
            ref={pickerRef}
            purpose={`Adds the account you pick as a member of ${group.name}.`}
            value={username}
            excluded={marks.excluded}
            onChange={setUsername}
          />
          {/* The picker can only mark what this panel has loaded AND could
              resolve to a username: `excluded` is built from the CURRENT member
              page, minus any row whose account lookup failed. Paging the whole
              membership to complete it is a backend/paging change and is out of
              this scope, so the gap is stated instead of hidden -- with the
              backend's own total and the count actually marked, nothing
              inferred. Without this, an unmarked row reads as "not a member
              yet", which is a claim this panel has not checked. */}
          {page !== null && marks.incomplete && (
            <p className="max-w-full text-xs text-muted-foreground sm:max-w-64">
              {marks.marked} of the {page.total} members of this group are marked “Already in group” here. A member on
              another page, or one whose username could not be resolved, is not marked.
            </p>
          )}
        </div>
        <Button type="submit" size="sm" disabled={busy || target === ""}>
          Add member
        </Button>
      </form>
    </section>
  )
}
