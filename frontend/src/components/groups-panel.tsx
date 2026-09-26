"use client"

// The permission groups of ONE cube (one ACCESS SCOPE), their members, and the
// four writes the kernel offers (create, rename, add member, remove member).
// Everything goes through lib/sharing.ts; no path or payload is built here.
//
// Presentation only: the list, the authority gate, the staleness guards and the
// refusal wording live in hooks/use-permission-groups.ts and
// hooks/use-group-members.ts. This file renders what they return and toasts
// what they answer.
//
// Deliberately absent (no API, or out of scope): group delete, cube admin
// management, audit history.

import { useState } from "react"
import { toast } from "sonner"

import { usePermissionGroups } from "@/hooks/use-permission-groups"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { GroupSection } from "@/components/group-section"

export function GroupsPanel({ cube }: { cube: string }) {
  const admin = usePermissionGroups(cube)
  const [newName, setNewName] = useState("")

  const create = async () => {
    const outcome = await admin.create(newName)
    // null = this panel was replaced while the request was in flight (the
    // access scope was switched). Nothing is announced: the toast would name a
    // scope the operator has already left.
    if (outcome === null) return
    if (outcome.ok) {
      toast.success(`Created group ${outcome.group.name}`)
      setNewName("")
    } else {
      toast.error(outcome.message)
    }
  }

  if (admin.access === "loading")
    return <Skeleton role="status" className="h-24 w-full" aria-label="Loading groups" />
  if (admin.access === "denied")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Groups of this entity are managed by its record owners or an administrator.
          </p>
        </CardContent>
      </Card>
    )
  if (admin.access === "failed")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive">
            {admin.error ?? "the group list could not be loaded"}
          </p>
          <Button size="sm" variant="outline" className="self-start" onClick={admin.reload}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Groups</CardTitle>
        <CardDescription>
          Permission groups of this entity. Sharing a record with a group opens it to every member.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* A background refresh that failed: the list below may be stale. */}
        {admin.error && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              {admin.error}
            </p>
            <Button size="sm" variant="outline" onClick={admin.reload}>
              Retry
            </Button>
          </div>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim() !== "") void create()
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="groups-new-name">New group name</Label>
            <Input
              id="groups-new-name"
              className="w-64"
              value={newName}
              disabled={admin.busy}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={admin.busy || newName.trim() === ""}>
            Create group
          </Button>
        </form>
        {admin.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Groups: none</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="groups-select">Group</Label>
            <Select value={admin.selectedId} onValueChange={admin.select}>
              <SelectTrigger id="groups-select" className="w-64" aria-label="Group">
                <SelectValue placeholder="choose a group" />
              </SelectTrigger>
              <SelectContent>
                {admin.groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {/* key remounts the section on group switch: no member page, draft,
            error or open confirmation of the previous group survives. */}
        {admin.selected && (
          <GroupSection
            key={admin.selected.id}
            group={admin.selected}
            busy={admin.busy}
            setBusy={admin.setBusy}
            onChanged={admin.reload}
          />
        )}
      </CardContent>
    </Card>
  )
}
