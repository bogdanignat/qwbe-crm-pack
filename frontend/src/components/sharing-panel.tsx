"use client"

// Record sharing on a CRM detail page: who this record is shared with (one
// chip per grant), share with @username or a group, revoke. Everything goes
// through lib/sharing.ts; no path or payload is built here.
//
// Authority comes from ONE signal: the grant list. 200 = this account manages
// access (owner, cube admin or superadmin); 403 = a neutral sentence and no
// further sharing request. The panel never infers "owner" or "shared with
// you" from roles: the backend is the only gate.
//
// What it deliberately does NOT do (no API for it, or out of scope): show
// group members, audit history, the owner's name, transfer ownership, or
// grant the cube write capability (QWB-63) -- sharing opens the record only.

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "shadcn-admin-kit"

import {
  CUSTOM_ACTIONS,
  actionsForLevel,
  chipsOf,
  createGroupGrant,
  createUserGrant,
  fetchGrantPage,
  grantActionsLabel,
  grantsPageView,
  lookupGroups,
  lookupUserNames,
  revokeGrant,
  type EntityAction,
  type GrantChip,
  type GrantsPageView,
  type ShareLevel,
} from "@/lib/sharing"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { UserPicker } from "@/components/user-picker"
import { useCurrentUser } from "@/hooks/use-current-user"

const PAGE = 50

const CAPABILITY_NOTE =
  "Sharing opens this record only. Editing also needs the cube write capability, managed separately. A grantee cannot manage or re-share this record."
const TOTAL_NOTE = "TOTAL includes transfer: this grantee can take ownership of the record."

type Access = "loading" | "manage" | "denied" | "failed"

const ALL_LEVELS: ReadonlyArray<ShareLevel> = ["total", "read", "custom"]
const LEVEL_LABELS: Record<ShareLevel, string> = {
  total: "Full access (TOTAL)",
  read: "Read only",
  custom: "Custom",
}

// The optional props narrow the form for entities where TOTAL is wrong (a
// saved view: read by default, edit at most). Every default keeps the record
// sharing semantics exactly as before.
export type SharingOptions = {
  levels?: ReadonlyArray<ShareLevel>
  customActions?: ReadonlyArray<EntityAction>
  defaultLevel?: ShareLevel
  title?: string
  note?: string
}

export function SharingPanel({
  cube,
  entityType,
  id,
  levels = ALL_LEVELS,
  customActions = CUSTOM_ACTIONS,
  defaultLevel = "total",
  title = "Sharing",
  note = CAPABILITY_NOTE,
}: {
  cube: string
  entityType: string
  id: string
} & SharingOptions) {
  const [access, setAccess] = useState<Access>("loading")
  const [page, setPage] = useState<GrantsPageView | null>(null)
  const [offset, setOffset] = useState(0)
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  // undefined = not asked yet; null = refused (group form hidden).
  const [groups, setGroups] = useState<Record<string, string> | null | undefined>(undefined)
  const { user: me } = useCurrentUser()
  const [error, setError] = useState<string | null>(null)
  // One flag serialises every mutation: Share, Confirm and Revoke are all
  // disabled while any of them is in flight.
  const [busy, setBusy] = useState(false)
  // Only the latest list load may paint (same guard as relation-typeahead).
  const seq = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(
    (at: number) => {
      const mine = ++seq.current
      let alive = true
      void (async () => {
        const result = await fetchGrantPage({ cube, entityType, entityId: id, offset: at, limit: PAGE })
        if (!alive || seq.current !== mine) return
        if (!result.ok) {
          if (result.status === 403) {
            setAccess("denied")
          } else {
            setAccess((a) => (a === "manage" ? a : "failed"))
            setError(result.message)
          }
          return
        }
        const view = grantsPageView(result.value)
        const names = await lookupUserNames(
          view.rows.flatMap((r) => (r.subject.kind === "user" ? [r.subject.userId] : [])),
        )
        if (!alive || seq.current !== mine) return
        setUserNames(names)
        setPage(view)
        setAccess("manage")
        setError(null)
        // The last row of a later page was revoked: step back one page.
        if (view.rows.length === 0 && at > 0) setOffset(Math.max(0, at - PAGE))
      })()
      return () => {
        alive = false
      }
    },
    [cube, entityType, id],
  )

  useEffect(() => load(offset), [load, offset])

  // Groups are needed only by the management form, so they are fetched once
  // the list has answered 200 -- never after a 403. The session identity comes
  // from the request the page's other panels share (useCurrentUser).
  useEffect(() => {
    if (access !== "manage" || groups !== undefined) return
    let alive = true
    void lookupGroups(cube).then((g) => {
      if (alive) setGroups(g)
    })
    return () => {
      alive = false
    }
  }, [access, groups, cube])

  const refetch = () => load(offset)

  const revoke = async (chip: GrantChip) => {
    setBusy(true)
    try {
      const result = await revokeGrant(chip.grantId)
      if (!mounted.current) return
      // A toast, not the banner: the refetch below clears the banner on a
      // successful list load, which would erase the failure a moment later.
      if (!result.ok) {
        toast.error(result.message)
      } else {
        toast.success(`Revoked access for ${chipTitle(chip)}`)
      }
      // The list is the source of truth after any mutation; a 403 flips the
      // panel to the neutral sentence through the same path.
      refetch()
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (access === "loading") return <Skeleton role="status" className="h-24 w-full" aria-label="Loading sharing" />
  if (access === "denied")
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Access to this record is managed by its owner or an administrator.
          </p>
        </CardContent>
      </Card>
    )
  if (access === "failed")
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive">
            {error ?? "the grant list could not be loaded"}
          </p>
          <Button size="sm" variant="outline" className="self-start" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )

  const chips = chipsOf(page?.rows ?? [], userNames, groups ?? {})
  const total = page?.total
  const shownTo = (page?.offset ?? 0) + (page?.rows.length ?? 0)
  const canNext = page !== null && (page.hasMore === true || (page.hasMore === null && page.rows.length === PAGE))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>You manage access to this record. {note}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {chips.length === 0 ? (
          <p className="text-sm text-muted-foreground">Shared with: none</p>
        ) : (
          <ul aria-label="Shared with" className="flex flex-col gap-2">
            {chips.map((chip) => (
              <ChipRow key={chip.grantId} chip={chip} busy={busy} onRevoke={() => revoke(chip)} />
            ))}
          </ul>
        )}
        {(total === undefined || total > PAGE || (page?.offset ?? 0) > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {(page?.offset ?? 0) + (chips.length > 0 ? 1 : 0)}-{shownTo} of {total ?? "?"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={(page?.offset ?? 0) === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={!canNext} onClick={() => setOffset(offset + PAGE)}>
              Next
            </Button>
          </div>
        )}
        <ShareForm
          cube={cube}
          entityType={entityType}
          id={id}
          me={me}
          groups={groups ?? null}
          chips={chips}
          busy={busy}
          setBusy={setBusy}
          onShared={refetch}
          levels={levels}
          customActions={customActions}
          defaultLevel={defaultLevel}
          note={note}
        />
      </CardContent>
    </Card>
  )
}

const chipTitle = (chip: GrantChip) => (chip.kind === "user" ? `@${chip.label}` : `group ${chip.label}`)

// One grant row: subject, level badge, two-step inline revoke.
function ChipRow({ chip, busy, onRevoke }: { chip: GrantChip; busy: boolean; onRevoke: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const title = chipTitle(chip)
  const focusTrigger = () =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-revoke="${chip.grantId}"]`)?.focus(),
    )
  const cancel = () => {
    setConfirming(false)
    focusTrigger()
  }
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && confirming) cancel()
      }}
    >
      <span className="font-medium">{title}</span>
      {chip.total ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge tabIndex={0}>{chip.actions}</Badge>
          </TooltipTrigger>
          <TooltipContent>{TOTAL_NOTE}</TooltipContent>
        </Tooltip>
      ) : (
        <Badge variant="secondary">{chip.actions}</Badge>
      )}
      {confirming ? (
        <span role="group" aria-label={`Confirm revoke ${title}`} className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {chip.kind === "group" ? `Revokes access for every member of ${chip.label}. ` : ""}
            Other grants, direct or through a group, may still give access.
          </span>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            aria-label={`Confirm revoke ${title}`}
            onClick={() => {
              setConfirming(false)
              onRevoke()
            }}
          >
            Confirm revoke
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancel revoke ${title}`} onClick={cancel}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={busy}
          data-revoke={chip.grantId}
          aria-label={`Revoke access for ${title}`}
          onClick={() => setConfirming(true)}
        >
          Revoke
        </Button>
      )}
    </li>
  )
}

function ShareForm({
  cube,
  entityType,
  id,
  me,
  groups,
  chips,
  busy,
  setBusy,
  onShared,
  levels,
  customActions,
  defaultLevel,
  note,
}: {
  cube: string
  entityType: string
  id: string
  me: { id: string; username: string } | null
  groups: Record<string, string> | null
  chips: GrantChip[]
  busy: boolean
  setBusy: (b: boolean) => void
  onShared: () => void
} & Required<Omit<SharingOptions, "title">>) {
  const [kind, setKind] = useState<"user" | "group">("user")
  const [username, setUsername] = useState("")
  const [groupId, setGroupId] = useState("")
  const [level, setLevel] = useState<ShareLevel>(defaultLevel)
  const [custom, setCustom] = useState<EntityAction[]>(["read"])
  const [confirming, setConfirming] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const radioName = useId()

  const groupEntries = Object.entries(groups ?? {})
  const actions = actionsForLevel(level, custom)
  const subjectLabel = kind === "user" ? `@${username.trim()}` : `group ${groups?.[groupId] ?? groupId}`

  const switchKind = (next: "user" | "group") => {
    setKind(next)
    // Group grants have no backend default (G3): the form starts at read only.
    setLevel(next === "group" ? "read" : defaultLevel)
    setConfirming(false)
    setFormError(null)
  }

  // Client-side guards before the confirmation step. The server does not
  // reject duplicates, and neither does this fully: `chips` is the loaded page
  // only, and the user check compares the typed username against resolved
  // names, so it is off for grants on other pages or whose name lookup was
  // refused. A duplicate is additive and shows as its own revokable chip.
  const begin = () => {
    const name = username.trim()
    if (kind === "user") {
      if (name === "") return setFormError("choose a user")
      if (me && name === me.username) return setFormError("you already manage this record")
      if (chips.some((c) => c.kind === "user" && c.label === name))
        return setFormError(`already shared directly with @${name} on this page`)
    } else {
      if (groupId === "") return setFormError("choose a group")
      if (chips.some((c) => c.kind === "group" && c.subjectId === groupId))
        return setFormError(`already shared with group ${groups?.[groupId] ?? groupId} on this page`)
    }
    if (actions.length === 0) return setFormError("choose at least one action")
    setFormError(null)
    setConfirming(true)
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const ref = { cube, entityType, entityId: id, actions }
      const result =
        kind === "user"
          ? await createUserGrant({ ...ref, username: username.trim() })
          : await createGroupGrant({ ...ref, groupId })
      if (!result.ok) {
        // The draft survives a refusal: qwbe's own message under the form.
        setFormError(result.message)
        setConfirming(false)
        if (result.status === 403) onShared()
        return
      }
      toast.success(`Shared with ${subjectLabel}`)
      setUsername("")
      setGroupId("")
      setConfirming(false)
      onShared()
      requestAnimationFrame(() => pickerRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!confirming) begin()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && confirming) setConfirming(false)
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Share with</span>
        <Button type="button" size="sm" variant={kind === "user" ? "default" : "outline"} aria-pressed={kind === "user"} onClick={() => switchKind("user")}>
          User
        </Button>
        {groupEntries.length > 0 && (
          <Button type="button" size="sm" variant={kind === "group" ? "default" : "outline"} aria-pressed={kind === "group"} onClick={() => switchKind("group")}>
            Group
          </Button>
        )}
      </div>
      {kind === "user" ? (
        <UserPicker
          ref={pickerRef}
          value={username}
          exclude={[...(me ? [me.username] : []), ...chips.filter((c) => c.kind === "user").map((c) => c.label)]}
          onChange={(v) => {
            setUsername(v)
            setConfirming(false)
          }}
        />
      ) : (
        <Select
          value={groupId}
          onValueChange={(v) => {
            setGroupId(v)
            setConfirming(false)
          }}
        >
          <SelectTrigger className="w-64" aria-label="Group">
            <SelectValue placeholder="choose a group" />
          </SelectTrigger>
          <SelectContent>
            {groupEntries.map(([gid, name]) => (
              <SelectItem key={gid} value={gid}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="sr-only">Access level</legend>
        {levels.map((value) => (
          <label key={value} className="flex items-center gap-1">
            <input
              type="radio"
              name={radioName}
              value={value}
              checked={level === value}
              onChange={() => {
                setLevel(value)
                setConfirming(false)
              }}
            />
            {LEVEL_LABELS[value]}
          </label>
        ))}
      </fieldset>
      {level === "custom" && (
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Custom actions</legend>
          {customActions.map((a) => (
            <label key={a} className="flex items-center gap-1">
              <Checkbox
                checked={custom.includes(a)}
                onCheckedChange={(c) => {
                  setCustom(c === true ? [...custom, a] : custom.filter((x) => x !== a))
                  setConfirming(false)
                }}
              />
              {a}
            </label>
          ))}
        </fieldset>
      )}
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      {confirming ? (
        <div role="group" aria-label="Confirm share" className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
          <p>
            Share with <strong>{subjectLabel}</strong>: {grantActionsLabel(actions)} ({actions.join(", ")}).
            {kind === "group" ? " Applies to every member of the group." : ""}
          </p>
          {actions.includes("transfer") && (
            <p className="font-semibold text-destructive">
              Includes transfer: the grantee can take ownership of this record away from the current owner.
            </p>
          )}
          <p className="text-xs text-muted-foreground">{note}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} aria-label="Confirm share" onClick={confirm}>
              Confirm share
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label="Cancel share" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" size="sm" className="self-start" disabled={busy}>
          Share
        </Button>
      )}
    </form>
  )
}
