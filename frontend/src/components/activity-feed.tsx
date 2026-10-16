"use client"

// The Echo activity feed, one component for every surface: a record's own
// history (cube + entityId) on a detail page, or the general feed (optional
// cube filter) on /echo. Everything goes through lib/echo.ts; no path or
// payload is built here, and no value from the log is ever rendered as HTML.
//
// Authority is the server's on every request. The feed answers 403 for a
// target the caller may not read (the rows already on screen are dropped:
// stale history must not outlive lost access); the comment routes answer 403
// for a write the caller may not make. The controls offered mirror the
// kernel's rules (author edits/deletes own live comment; a moderator -- the
// permission decision source on the target cube is superadmin or cube-admin,
// probed through lib/echo.ts fetchModerator -- deletes any live comment), but
// a refusal is always shown as the server's own message, never hidden.
//
// Paging is cursor-based (`before` = last SCANNED row id). An empty page with
// a non-null cursor is "nothing visible here, more to scan": Load more stays.
// Only the latest request for the current target may paint (sequence guard);
// changing the target or filter resets everything.

import Link from "next/link"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "shadcn-admin-kit"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/hooks/use-current-user"
import { rowHref } from "@/lib/cube"
import {
  COMMENT_MAX,
  actorLabel,
  addComment,
  appendRows,
  commentActions,
  commentState,
  deleteComment,
  describeChanges,
  editComment,
  fetchFeed,
  fetchModerator,
  formatAt,
  isTargetRefusal,
  opLabel,
  withComment,
  type FeedComment,
  type FeedRow,
} from "@/lib/echo"

const PAGE = 50

export const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"

type Status = "loading" | "ready" | "denied" | "failed"

type Props = {
  cube?: string
  // With entityId: one record's history plus the comment box. Requires cube.
  entityId?: string
  title?: string
}

// A target or filter change remounts the feed: every piece of state (rows,
// cursor, errors, denied comment box, in-flight sequence) starts over, so
// nothing of the previous target can survive or paint late.
export function ActivityFeed(props: Props) {
  return <Feed key={`${props.cube ?? ""}|${props.entityId ?? ""}`} {...props} />
}

function Feed({ cube, entityId, title = "Activity" }: Props) {
  const [status, setStatus] = useState<Status>("loading")
  const [rows, setRows] = useState<FeedRow[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // Per cube: true/false once probed, null when the probe failed (stays
  // unknown, not retried in a loop), absent while in flight or not asked.
  const [moderators, setModerators] = useState<Record<string, boolean | null>>({})
  // The server said no to a comment write on this target: the box is replaced
  // by that sentence until the target changes (a reload after the refusal
  // must not bring it back; regained write access needs a navigation).
  const [commentDenied, setCommentDenied] = useState<string | null>(null)
  const seq = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Fresh load of the first page: bumps the sequence so an older in-flight
  // load (a reload after a refused write, a Retry) can no longer paint. The
  // status is left alone: rows already on screen stay until the answer; the
  // initial skeleton comes from the mount state.
  const load = useCallback(() => {
    const mine = ++seq.current
    void fetchFeed({ cube, entityId, limit: PAGE }).then((result) => {
      if (!mounted.current || seq.current !== mine) return
      if (!result.ok) {
        // Denied or gone: nothing of this target stays on screen.
        setRows([])
        setNextBefore(null)
        setError(result.message)
        setStatus(result.status === 403 ? "denied" : "failed")
        return
      }
      setRows(result.value.rows)
      setNextBefore(result.value.nextBefore)
      setError(null)
      setStatus("ready")
    })
  }, [cube, entityId])

  useEffect(() => load(), [load])

  // An admin is superadmin on every cube: every moderator probe would be a 200.
  const { user } = useCurrentUser()
  const me = user?.id ?? null
  const admin = user?.admin ?? false

  // Moderator status per cube on screen, probed once per cube; a probe that
  // fails leaves the cube unknown (no delete offered beyond the author's own).
  // `inFlight` keeps a re-render during a probe from firing it again.
  const inFlight = useRef(new Set<string>())
  const cubesShown = [...new Set([...(cube ? [cube] : []), ...rows.map((r) => r.cube)])].join("\n")
  useEffect(() => {
    if (admin) return
    const pending = cubesShown.split("\n").filter((c) => c !== "" && !(c in moderators) && !inFlight.current.has(c))
    if (pending.length === 0) return
    for (const c of pending) inFlight.current.add(c)
    // Answers are kept even if the deps changed meanwhile: a probe is per
    // cube, not per render, and the cube stays on screen.
    void Promise.all(pending.map(async (c) => [c, await fetchModerator(c)] as const)).then((answers) => {
      for (const [c] of answers) inFlight.current.delete(c)
      if (!mounted.current) return
      setModerators((m) => {
        const next = { ...m }
        for (const [c, r] of answers) next[c] = r.ok ? r.value : null
        return next
      })
    })
  }, [admin, cubesShown, moderators])

  const loadMore = async () => {
    if (nextBefore === null || loadingMore) return
    const mine = seq.current
    setLoadingMore(true)
    const result = await fetchFeed({ cube, entityId, before: nextBefore, limit: PAGE })
    if (!mounted.current) return
    setLoadingMore(false)
    if (seq.current !== mine) return
    if (!result.ok) {
      if (result.status === 403) {
        setRows([])
        setNextBefore(null)
        setStatus("denied")
      }
      setError(result.message)
      return
    }
    setError(null)
    setRows((current) => appendRows(current, result.value.rows))
    setNextBefore(result.value.nextBefore)
  }

  // A refused write whose sentence is the target gate's reloads the list: a
  // 403 on the target then flips the whole feed to "denied" through the same
  // path as the initial load (page one again). Other refusals stay in place.
  const applyComment = (c: FeedComment) => setRows((current) => withComment(current, c))

  if (status === "loading" && rows.length === 0) {
    return <Skeleton role="status" className="h-24 w-full" aria-label={`Loading ${title.toLowerCase()}`} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {entityId === undefined && (
          <CardDescription>Newest first. Only what you may read is shown.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status === "denied" && (
          <p role="alert" className="text-sm text-muted-foreground">
            {error ?? "you cannot read this activity"}
          </p>
        )}
        {status === "failed" && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error ?? "the activity could not be loaded"}
            </p>
            <Button size="sm" variant="outline" className="self-start" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {status === "ready" && (
          <>
            {cube !== undefined && entityId !== undefined && (
              <CommentBox
                cube={cube}
                entityId={entityId}
                denied={commentDenied}
                onAdded={(row) => setRows((current) => appendRows([row], current))}
                onDenied={(message) => {
                  setCommentDenied(message)
                  load()
                }}
              />
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {nextBefore === null ? "No activity yet." : "Nothing visible on this page; there may be more."}
              </p>
            ) : (
              <ol aria-label={title} className="flex flex-col gap-3">
                {rows.map((row) => (
                  <Entry
                    key={row.id}
                    row={row}
                    showTarget={entityId === undefined}
                    me={me}
                    moderator={admin ? true : (moderators[row.cube] ?? undefined)}
                    onChanged={applyComment}
                    onRefused={(message) => {
                      if (isTargetRefusal(message)) load()
                    }}
                  />
                ))}
              </ol>
            )}
            {nextBefore !== null && (
              <Button size="sm" variant="outline" className="self-start" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// One feed row: who, what, when; the target (general feed only); the changed
// fields as plain text; or the comment with its current body and controls.
function Entry({
  row,
  showTarget,
  me,
  moderator,
  onChanged,
  onRefused,
}: {
  row: FeedRow
  showTarget: boolean
  me: string | null
  moderator: boolean | undefined
  onChanged: (c: FeedComment) => void
  onRefused: (message: string) => void
}) {
  const href = showTarget ? rowHref(row.cube, row.rowId) : null
  const target = `${row.entityType} ${row.rowId}`
  const lines = row.comment ? [] : describeChanges(row.changes)
  return (
    <li className="flex flex-col gap-1 border-b pb-3 text-sm last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{actorLabel(row)}</span>
        <span>{opLabel(row.op)}</span>
        {showTarget && (href ? <Link className="underline" href={href}>{target}</Link> : <span>{target}</span>)}
        <time dateTime={row.at} className="text-xs text-muted-foreground">
          {formatAt(row.at)}
        </time>
        {row.version !== null && <span className="text-xs text-muted-foreground">v{row.version}</span>}
      </div>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-4 text-xs">
          {lines.map((line) => (
            <li key={line.field} className="break-words">
              <span className="font-medium">{line.field}</span>:{" "}
              {line.from !== null && <del className="text-muted-foreground">{line.from}</del>}
              {line.from !== null && line.to !== null && " -> "}
              {line.to !== null && <ins className="no-underline">{line.to}</ins>}
              {line.from === null && line.to === null && <span className="text-muted-foreground">(empty)</span>}
            </li>
          ))}
        </ul>
      )}
      {row.comment && (
        <CommentView comment={row.comment} me={me} moderator={moderator} onChanged={onChanged} onRefused={onRefused} />
      )}
    </li>
  )
}

function CommentView({
  comment,
  me,
  moderator,
  onChanged,
  onRefused,
}: {
  comment: FeedComment
  me: string | null
  moderator: boolean | undefined
  onChanged: (c: FeedComment) => void
  onRefused: (message: string) => void
}) {
  const state = commentState(comment)
  const actions = commentActions(comment, me, moderator)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const id = useId()

  if (state === "deleted") {
    return (
      <p className="text-sm italic text-muted-foreground">
        Comment deleted{comment.deletedBy ? ` by ${comment.deletedBy}` : ""}
        {comment.deletedAt ? ` on ${formatAt(comment.deletedAt)}` : ""}
      </p>
    )
  }

  const submitEdit = async (body: string) => {
    setBusy(true)
    setRefusal(null)
    const result = await editComment({ id: comment.id, body })
    setBusy(false)
    if (!result.ok) {
      setRefusal(result.message)
      if (result.status === 403) onRefused(result.message)
      return
    }
    setEditing(false)
    onChanged(result.value)
    toast.success("Comment updated")
  }

  const remove = async () => {
    setBusy(true)
    setRefusal(null)
    const result = await deleteComment(comment.id)
    setBusy(false)
    setConfirming(false)
    if (!result.ok) {
      setRefusal(result.message)
      if (result.status === 403) onRefused(result.message)
      return
    }
    onChanged(result.value)
    toast.success("Comment deleted")
  }

  return (
    <div className="flex flex-col gap-1">
      {editing ? (
        <CommentForm
          id={id}
          label="Edit comment"
          initial={comment.body}
          submitLabel="Save"
          busy={busy}
          onSubmit={submitEdit}
          onCancel={() => {
            setEditing(false)
            setRefusal(null)
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words">{comment.body}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {state === "edited" && comment.editedAt && (
          <Badge variant="secondary" title={`Edited ${formatAt(comment.editedAt)}`}>
            edited
          </Badge>
        )}
        {!editing && actions.edit && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {!editing && actions.delete && !confirming && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
        {confirming && (
          <>
            <Button size="sm" variant="destructive" disabled={busy} onClick={remove}>
              Confirm delete
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      )}
    </div>
  )
}

// The box under a record's history. Whether the caller may comment (the edit
// decision on the target) is discoverable only as a whole-cube listing
// (GET /permissions/entities/{cube}?view=all), not per entity, so the box is
// offered and the server's 403 replaces it with the refusal (the feed
// reloads, so lost read access shows through the same path).
function CommentBox({
  cube,
  entityId,
  denied,
  onAdded,
  onDenied,
}: {
  cube: string
  entityId: string
  denied: string | null
  onAdded: (row: FeedRow) => void
  onDenied: (message: string) => void
}) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // Remounts the form after a successful add so the draft clears.
  const [generation, setGeneration] = useState(0)

  if (denied !== null) {
    return <p className="text-sm text-muted-foreground">You cannot comment on this record: {denied}</p>
  }

  const submit = async (body: string) => {
    setBusy(true)
    setRefusal(null)
    const result = await addComment({ cube, entityId, body })
    setBusy(false)
    if (!result.ok) {
      if (result.status === 403) onDenied(result.message)
      else setRefusal(result.message)
      return
    }
    onAdded(result.value)
    setGeneration((g) => g + 1)
    toast.success("Comment added")
  }

  return (
    <div className="flex flex-col gap-1">
      <CommentForm key={generation} id={id} label="Add a comment" submitLabel="Comment" busy={busy} onSubmit={submit} />
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      )}
    </div>
  )
}

// One labelled textarea with Submit (and optional Cancel). Focus returns to
// the textarea after submit; Escape cancels when a cancel exists.
function CommentForm({
  id,
  label,
  initial = "",
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  id: string
  label: string
  initial?: string
  submitLabel: string
  busy: boolean
  onSubmit: (body: string) => Promise<void>
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const empty = draft.trim() === ""
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (empty || busy) return
        await onSubmit(draft)
        ref.current?.focus()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel && !busy) {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        ref={ref}
        className={TEXTAREA_CLASS}
        rows={3}
        maxLength={COMMENT_MAX}
        // An edit opened in place is ready to type into (the add box is not
        // focused on mount: it must not steal focus from the record).
        autoFocus={onCancel !== undefined}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || empty}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
