"use client"

// Settings > ACCESS GROUPS: groups of USER ACCOUNTS, per access scope.
//
// Two different things are called "groups" in this app and this panel is the
// first one:
//   - ACCESS groups (here) are sets of user ACCOUNTS. Sharing a record with one
//     opens that record to every member. They are the kernel's permission
//     groups, the SAME API and the same ids the host app administers
//     (qwbe /permissions), mirrored here -- never a second store.
//   - CONTACT groups (/contact-groups) are business sets of CONTACTS: data, not
//     access. Nothing here touches them.
//
// The scope selector is its own control, separate from the Entity selector the
// custom fields use: custom fields are defined per cube through the customfields
// API, access groups are administered per cube through the permissions API, and
// the two lists of cubes are not the same list. The scopes come from the live
// catalogue (hooks/use-access-scopes.ts); the server still decides, per scope,
// whether this operator may administer its groups.

import { useState } from "react"

import { useAccessScopes } from "@/hooks/use-access-scopes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { GroupsPanel } from "@/components/groups-panel"

export function AccessGroupsPanel() {
  const catalogue = useAccessScopes()
  // No scope is chosen for the operator: the first list to arrive may be the
  // fallback one, and a panel that silently started administering a scope
  // nobody picked would be reading authority into a default.
  const [scope, setScope] = useState("")
  const chosen = catalogue.scopes.some((s) => s.cube === scope) ? scope : ""

  return (
    <section className="flex flex-col gap-4" aria-label="Access groups">
      <Card>
        <CardHeader>
          <CardTitle>Access groups</CardTitle>
          <CardDescription>
            Groups of user accounts, per access scope. A record shared with a group is open to every member of that
            group. These are the same groups, with the same ids, that the host app administers under /permissions.
            Business sets of contacts are a different thing and live under Contact groups.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {catalogue.pending && <Skeleton role="status" className="h-9 w-full sm:w-72" aria-label="Loading scopes" />}
          {catalogue.error !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-sm text-destructive">
                Access scopes unavailable: {catalogue.error}
              </p>
              <Button
                size="sm"
                variant="outline"
                aria-label="Read the access scopes again"
                onClick={catalogue.retry}
              >
                Retry
              </Button>
            </div>
          )}
          {!catalogue.pending && catalogue.error === null && catalogue.scopes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No access scope of this pack is installed and enabled, so there is nothing to administer here.
            </p>
          )}
          {catalogue.scopes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="access-scope">Access scope</Label>
              <Select value={chosen} onValueChange={setScope}>
                <SelectTrigger id="access-scope" className="w-full sm:w-72" aria-label="Access scope">
                  <SelectValue placeholder="choose a scope" />
                </SelectTrigger>
                <SelectContent>
                  {catalogue.scopes.map((s) => (
                    <SelectItem key={s.cube} value={s.cube}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* A fallback list is never presented as the installed one, and it is
              never a dead end: the same Retry the error path offers is offered
              here, because the 403 behind it is normally fixed while this page
              stays open. */}
          {catalogue.notice !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-xs text-muted-foreground">
                {catalogue.notice}
              </p>
              <Button
                size="sm"
                variant="outline"
                aria-label="Read the installed access scopes again"
                disabled={catalogue.refreshing}
                onClick={catalogue.retry}
              >
                Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {/* key remounts the whole panel on scope switch, so no group list,
          selected group, member page, error or open remove confirmation of the
          previous scope survives (the same rule the custom fields panel
          follows, QWB-60). */}
      {chosen !== "" && <GroupsPanel key={chosen} cube={chosen} />}
    </section>
  )
}
