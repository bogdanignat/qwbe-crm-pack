"use client"

// The one generic list, driven entirely by cube metadata.
//
// It takes a cube name, fetches that cube's metadata and its rows through the
// server-side proxy, and renders columns from the published fields: label from
// `label`, cell shape from `type` and `enum`, sortable headers only where
// `sortable` is true, and a filter control for every field the metadata marks
// `searchable` (a relation field becomes a typeahead search, a plain field a
// text input). Paging and sorting are server-side end to end: the page, page
// size and sort parameters travel to qwbe; nothing here slices a full result
// set. Relation cells resolve in ONE batch request per target cube,
// not one request per cell.

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  apiFetch,
  type ColumnSpec,
  type CubeMetadata,
  type FieldMetadata,
  type PageOf,
  type Row,
  canEdit,
  columnsFromFields,
  customValueOf,
  renderKindOf,
  cubeApiPath,
  hrefForRelation,
  rowHref,
  listApiPath,
  listWindowOf,
  listControlsOf,
  metadataApiPath,
  pageFromInput,
  pageWindow,
  saveCell,
  sortRequestFor,
  withSavedValue,
  requestFailure,
  valueTextOf,
} from "@/lib/cube"
import { withMockFields } from "@/mock/organizations"
import { withOrganizationLabels } from "@/lib/organization-labels"
import { MockTag } from "@/components/mock-tag"
import { relationRefsOf } from "@/lib/relation-batch"
import { readPrefs } from "@/lib/field-prefs"
import { PAGE_SIZES, type AppliedView, type SavedViewRow } from "@/lib/views"
import { ListViews } from "@/components/list-views"
import { useRelationTitles } from "@/hooks/use-relation-titles"
import { RelationCell, RelationLink } from "@/components/relation-cell"
import { RelationTypeahead } from "@/components/relation-typeahead"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type EditState = { id: string; field: string; value: string }

export function CubeList({
  cube,
  fixedFilters,
  // The create flow: when the caller names the create route, the
  // list carries a visible Add button (header row, and the primary action of
  // the empty state). A list without one -- for example the derived contacts
  // of one organization on the detail page -- renders no button.
  createHref,
  addLabel = "Add",
  // The empty state's message: the wipe case must not be a silent
  // empty table. The caller names the entity; the default keeps a generic list
  // honest without pretending to know what the rows are.
  emptyMessage = "No rows yet.",
  // Read-only demo records (mockup data) shown on top of the first unfiltered
  // page; they never count in the range or the total.
  demoRows = [],
}: {
  cube: string
  // Server-side equality filters pinned by the caller (for example the derived
  // contact list of one organization). Values are opaque ids.
  fixedFilters?: Record<string, string>
  createHref?: string
  addLabel?: string
  emptyMessage?: string
  demoRows?: readonly Row[]
}) {
  const [meta, setMeta] = useState<CubeMetadata | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [page, setPage] = useState<PageOf<Row> | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [sortBy, setSortBy] = useState<string | undefined>(undefined)
  const [descending, setDescending] = useState(false)
  // The chosen values of the exact filter fields, keyed by field name; empty
  // string means "all".
  const [search, setSearch] = useState<Record<string, string>>({})
  // The prefix search over the cube's declared search fields, sent as `q`.
  const [prefix, setPrefix] = useState("")
  const [edit, setEdit] = useState<EditState | null>(null)
  // What is typed into the "Page" box before it is committed (Enter or blur);
  // null shows the current page. Keeping the draft apart from the offset lets
  // a user clear and retype, and a rejected or same-page commit just drops the
  // draft, so the box shows the current page again without a request.
  const [pageDraft, setPageDraft] = useState<string | null>(null)
  // Per-cell error messages from a failed PATCH, keyed "id:field".
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  // The applied saved view, if any: its column list wins over the Settings
  // hide-list while it is active (the more specific, explicitly chosen intent).
  const [activeView, setActiveView] = useState<{ id: string; columns: string[] | null } | null>(null)
  // Bumped on every apply so the debounced filter inputs remount with the
  // view's values (their draft is local state).
  const [applyEpoch, setApplyEpoch] = useState(0)
  // False until the client has hydrated: before that, a click on a rendered
  // button reaches DOM the handler is not attached to yet (the observed race:
  // a trusted click, handler prop attached, React still does not run it -- the
  // node hydration replaces is not the node the event fired on). Until the
  // mount effect below has run, an editable cell renders as plain text, so
  // there is no affordance to click into a dead window.
  const [hydrated, setHydrated] = useState(false)
  // After paint: hydration has committed, so event handlers are attached and
  // a click can no longer land on DOM that is about to be replaced.
  useEffect(() => {
    const t = setTimeout(() => setHydrated(true), 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    let alive = true
    apiFetch(metadataApiPath(cube))
      .then(async (r) => {
        if (!r.ok) throw await requestFailure("metadata", r)
        return withOrganizationLabels(withMockFields((await r.json()) as CubeMetadata))
      })
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch((e: unknown) => {
        if (alive) setMetaError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [cube])

  // The filter/search controls derive from the PUBLISHED list contract, so the
  // UI can only offer what the backend actually honours: one prefix search as
  // `q` when the contract names search fields, exact filters from the
  // contract's filter list (relations included, fixed-filtered fields and
  // reserved parameter names excluded).
  const controls = useMemo(
    () => (meta ? listControlsOf(meta.fields, meta.list, fixedFilters ?? {}) : null),
    [meta, fixedFilters],
  )

  const filters = useMemo<Record<string, string>>(() => {
    const chosen: Record<string, string> = {}
    for (const f of controls?.filters ?? []) {
      if (search[f.name]) chosen[f.name] = search[f.name]
    }
    return { ...(fixedFilters ?? {}), ...chosen }
  }, [fixedFilters, search, controls])
  const effectiveFilters = useMemo(
    () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "")),
    [filters],
  )

  const load = useCallback(() => {
    let alive = true
    apiFetch(
      listApiPath(cube, {
        offset,
        limit: pageSize,
        sortBy,
        descending,
        ...(prefix === "" ? {} : { q: prefix }),
        filters: effectiveFilters,
      }),
    )
      .then(async (r) => {
        if (!r.ok) throw await requestFailure("list", r)
        return (await r.json()) as PageOf<Row>
      })
      .then((p) => {
        // A success for the CURRENT request retires the alert of an earlier
        // failure; a response for a superseded request (alive false) neither
        // shows a page nor clears an error it did not cause.
        if (alive) {
          setPage(p)
          setListError(null)
        }
      })
      .catch((e: unknown) => {
        if (alive) setListError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [cube, offset, pageSize, sortBy, descending, prefix, effectiveFilters])

  useEffect(() => load(), [load])

  // Fields this browser hides (the Settings UI preference, lib/field-prefs)
  // drop out of the columns. The definition and the values stay on the server:
  // hide != delete, and the detail page and create form are untouched.
  const [hiddenNames, setHiddenNames] = useState<string[]>([])
  useEffect(() => {
    // Deferred like the hydration gate above: localStorage exists only on
    // the client, and the first render must agree with the server's.
    const t = setTimeout(() => setHiddenNames(readPrefs(cube).hidden), 0)
    return () => clearTimeout(t)
  }, [cube])

  // Columns are pure derivation from the metadata; they live above the early
  // returns because the relation batch below needs them.
  const columns = useMemo(() => {
    if (!meta) return []
    const all = columnsFromFields(meta.fields)
    if (activeView?.columns) {
      const byName = new Map(all.map((c) => [c.field.name, c]))
      return activeView.columns.flatMap((n) => byName.get(n) ?? [])
    }
    return all.filter((c) => c.visible && !hiddenNames.includes(c.field.name))
  }, [meta, hiddenNames, activeView])
  // Every relation value on the current page, deduplicated. One ids batch per
  // distinct target cube resolves them all (useRelationTitles); the old list
  // fetched each cell's row separately -- 25 round-trips on a 25-row page.
  const relationRefs = useMemo(
    () => (page ? relationRefsOf(page.rows, columns.map((c) => c.field)) : []),
    [page, columns],
  )
  const resolveTitle = useRelationTitles(relationRefs)

  if (metaError) return <p role="alert">metadata unavailable: {metaError}</p>
  if (!meta) return <Skeleton className="h-64 w-full" />

  // The title field is the row's human identity (the same field titleOf uses
  // on the detail page). When this app has a route for the cube, the title
  // cell links to the row's detail page; the other cells stay inline-editable.
  const titleFieldName = meta.fields.find((f) => f.required)?.name
  // Saved views are offered on ordinary lists only; a derived list (pinned
  // filters) gets none in phase one. The pinned-filter rule of applyView holds
  // regardless, so enabling it later is a UI change, not a safety change.
  const showViews = Object.keys(fixedFilters ?? {}).length === 0
  const total = page?.total
  const rowCount = page?.rows.length ?? 0
  const filtered = prefix.trim() !== "" || Object.keys(effectiveFilters).length > 0
  const view = page ? listWindowOf(page, demoRows, filtered) : null
  // Nothing to show at all: no server row and no demo row.
  const empty = page !== null && page.rows.length === 0 && view?.demo.length === 0
  const { currentPage, lastPage } = pageWindow(offset, pageSize, total)

  // A stale cell error must not survive a change of page, sort or filter: the
  // row it was about is not the row in view any more. Every entry point below
  // changes the request parameters, so each clears the map as it goes.
  const requery = (apply: () => void) => {
    setCellErrors({})
    apply()
  }

  const toggleSort = (column: ColumnSpec) => {
    // A column the metadata does not mark sortable never produces a request.
    const next = sortRequestFor(column, sortBy, descending)
    if (!next) return
    requery(() => {
      setSortBy(next.sortBy)
      setDescending(next.descending)
      setOffset(0)
    })
  }

  // A view applies through the same requery seam as every other control, and
  // always resets to the first page. null puts the list back to its defaults.
  const applyView = (view: SavedViewRow | null, applied: AppliedView | null) => {
    requery(() => {
      const params = applied?.params ?? {}
      const chosen: Record<string, string> = {}
      for (const [k, v] of Object.entries(params.filters ?? {})) {
        if (!(k in (fixedFilters ?? {}))) chosen[k] = v
      }
      setSearch(chosen)
      setPrefix(params.q ?? "")
      setSortBy(params.sortBy)
      setDescending(params.descending ?? false)
      setPageSize(applied?.pageSize ?? PAGE_SIZES[0])
      setOffset(0)
      setPageDraft(null)
    })
    setActiveView(view && applied ? { id: view.id, columns: applied.columns } : null)
    setApplyEpoch((n) => n + 1)
  }

  const commitPage = () => {
    if (pageDraft === null) return
    const wanted = pageFromInput(pageDraft, lastPage)
    setPageDraft(null)
    if (wanted === undefined || wanted === currentPage) return
    requery(() => setOffset((wanted - 1) * pageSize))
  }

  const saveEdit = async (row: Row, fieldMeta: FieldMetadata, next: string) => {
    setEdit(null)
    const key = `${String(row.id)}:${fieldMeta.name}`
    // saveCell derives the pre-edit value itself (customValueOf on the row),
    // so a custom field emptied to "" is a real change and reaches qwbe.
    const result = await saveCell({
      rowPath: cubeApiPath(cube, `/${String(row.id)}`),
      row,
      field: fieldMeta,
      next,
      doFetch: apiFetch,
    })
    if (result.status === "saved") {
      // Only the patched key is merged (withSavedValue): a concurrent,
      // out-of-order response body must not overwrite the other columns.
      setPage((p) =>
        p
          ? {
              ...p,
              rows: p.rows.map((r) =>
                String(r.id) === String(row.id) ? withSavedValue(r, fieldMeta, result.value) : r,
              ),
            }
          : p,
      )
      setCellErrors((e) => {
        const next = { ...e }
        delete next[key]
        return next
      })
    } else if (result.status === "refused") {
      // The message qwbe returned is shown in that cell, and the old value
      // stays until a save succeeds.
      setCellErrors((e) => ({ ...e, [key]: result.message }))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One toolbar: the prefix search and the exact filter fields wrap on a
          narrow screen, the Add action keeps the trailing edge (no separate
          row per control). A field the caller pins (fixedFilters) gets no
          control here -- it is already applied server-side. */}
      {controls && (showViews || createHref || controls.search || controls.filters.length > 0) && (
      <div className="flex flex-wrap items-end gap-3">
      {showViews && (
        <ListViews
          targetCube={cube}
          meta={meta}
          controls={controls}
          fixedFilters={fixedFilters ?? {}}
          state={{
            columns: columns.map((c) => c.field.name),
            filters: search,
            q: prefix,
            sortBy,
            descending,
            pageSize,
          }}
          activeId={activeView?.id ?? null}
          onApply={applyView}
        />
      )}
      {controls.search && (
        <TextSearch
          key={`q:${applyEpoch}`}
          label="Search"
          ariaLabel="Search (prefix match)"
          value={prefix}
          onChange={(v) => {
            requery(() => setPrefix(v))
            setOffset(0)
          }}
        />
      )}
      {controls.filters.map((f) =>
        f.relation ? (
          <RelationTypeahead
            key={`${f.name}:${applyEpoch}`}
            field={f}
            value={search[f.name] ?? ""}
            onChange={(v) => {
              requery(() => setSearch((s) => ({ ...s, [f.name]: v })))
              setOffset(0)
            }}
          />
        ) : (
          <TextSearch
            key={`${f.name}:${applyEpoch}`}
            label={f.label}
            value={search[f.name] ?? ""}
            onChange={(v) => {
              requery(() => setSearch((s) => ({ ...s, [f.name]: v })))
              setOffset(0)
            }}
          />
        ),
      )}
      {createHref && (
        <Button asChild className="ml-auto">
          <Link href={createHref}>{addLabel}</Link>
        </Button>
      )}
      </div>
      )}
      {listError && <p role="alert">{listError}</p>}
      {empty ? (
        // The empty state replaces the silent empty table. A
        // wiped or never-populated cube gets the message and the create
        // action; a filtered search that finds nothing is a different
        // message, with the filters -- not the create button -- as the way
        // out. The prefix search narrows too; trimmed, because qwbe trims
        // `q` and treats whitespace as no search.
        filtered ? (
          <p className="text-sm text-muted-foreground">No rows match the current filters.</p>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {createHref && (
              <Button asChild>
                <Link href={createHref}>{addLabel}</Link>
              </Button>
            )}
          </div>
        )
      ) : (
      <Table aria-label={`${meta.entity ?? cube} list`}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.field.name} className="whitespace-nowrap">
                {column.sortable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3"
                    onClick={() => toggleSort(column)}
                    aria-sort={sortBy === column.field.name ? (descending ? "descending" : "ascending") : "none"}
                  >
                    {column.field.label}
                    {sortBy === column.field.name ? (descending ? " ↓" : " ↑") : ""}
                    {column.field.mock && <MockTag />}
                  </Button>
                ) : (
                  <span className="text-sm font-medium">
                    {column.field.label}
                    {column.field.mock && <MockTag />}
                  </span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!page &&
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell key={c.field.name}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {view?.demo.map((row) => (
            <TableRow key={`demo:${String(row.id)}`} className="bg-muted/40" data-demo-row={String(row.id)}>
              {columns.map((column, i) => (
                <TableCell key={column.field.name} className="align-top">
                  <div className="flex items-start gap-1">
                    <Cell
                      row={row}
                      column={column}
                      isTitle={column.field.name === titleFieldName}
                      rowLink={rowHref(cube, String(row.id))}
                      edit={null}
                      setEdit={setEdit}
                      interactive={false}
                      resolveTitle={resolveTitle}
                      onSave={() => undefined}
                    />
                    {i === 0 && <MockTag>demo</MockTag>}
                  </div>
                </TableCell>
              ))}
            </TableRow>
          ))}
          {page?.rows.map((row) => (
            <TableRow key={String(row.id)}>
              {columns.map((column) => (
                <TableCell key={column.field.name} className="align-top">
                  <Cell
                    row={row}
                    column={column}
                    isTitle={column.field.name === titleFieldName}
                    rowLink={rowHref(cube, String(row.id))}
                    edit={edit}
                    setEdit={setEdit}
                    error={cellErrors[`${String(row.id)}:${column.field.name}`]}
                    interactive={hydrated}
                    resolveTitle={resolveTitle}
                    onSave={(value) => saveEdit(row, column.field, value)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}
      {!empty && (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {view?.label ?? "loading"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => requery(() => setOffset(Math.max(0, offset - pageSize)))}
          >
            Previous
          </Button>
          {/* 2400 pages of Previous/Next is not navigation: the page number is
              typed, committed on Enter or blur, and clamped to the last page
              whenever qwbe reports a total. Enter followed by blur is one
              request: after Enter the draft is gone, so the blur commits the
              current page, which is a no-op. */}
          <label className="flex items-center gap-1 text-sm text-muted-foreground">
            Page
            <Input
              type="number"
              min={1}
              max={lastPage}
              className="w-20"
              aria-label="Page"
              value={pageDraft ?? String(currentPage)}
              onChange={(e) => setPageDraft(e.target.value)}
              onBlur={commitPage}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPage()
              }}
            />
            {lastPage !== undefined && <span>of {lastPage}</span>}
          </label>
          <Button
            variant="outline"
            size="sm"
            // Without a total from qwbe, a short page is the only proof that
            // the end was reached.
            disabled={!page || (total !== undefined ? offset + pageSize >= total : rowCount < pageSize)}
            onClick={() => requery(() => setOffset(offset + pageSize))}
          >
            Next
          </Button>
          <Select
            value={String(pageSize)}
            onValueChange={(v) =>
              requery(() => {
                setPageSize(Number(v))
                // The row that was first on the old page stays visible: keep
                // the offset, only snapped to the new page boundary.
                setOffset(Math.floor(offset / Number(v)) * Number(v))
              })
            }
          >
            <SelectTrigger className="w-28" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      )}
    </div>
  )
}

// A text filter control. For an exact-equality field the label names the
// field; for the prefix search it is the bare "Search" the q contract owns.
// The exact case is labeled, so a user is not misled into thinking the value
// matches anywhere inside the field.
//
// The keystrokes stay local and only the pause reaches qwbe: the filter is an
// exact-equality match, so every prefix of a word ("A", "Ac", "Acm") is a
// request that cannot match anything. Typing "Acme" used to cost four requests
// and three guaranteed misses.
const FILTER_PAUSE_MS = 300

function TextSearch({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A pause that never ends (the page is left mid-typing) must not fire.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        className="w-full sm:w-64"
        aria-label={ariaLabel ?? `Filter by ${label} (exact match)`}
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => onChange(next), FILTER_PAUSE_MS)
        }}
      />
    </div>
  )
}

// A searchable relation field: the caller picks one row of the target cube.
// The picker is the typeahead (relation-typeahead.tsx): one search request
// per typing pause, not a dropdown of the target's first 200 rows.

function Cell({
  row,
  column,
  isTitle,
  rowLink,
  edit,
  setEdit,
  error,
  interactive,
  resolveTitle,
  onSave,
}: {
  row: Row
  column: ColumnSpec
  isTitle: boolean
  rowLink: string | null
  edit: EditState | null
  setEdit: (edit: EditState | null) => void
  error?: string
  interactive: boolean
  resolveTitle: (target: string, id: string) => string | null
  onSave: (value: string) => void
}) {
  const field = column.field
  // The value wherever the backend keeps it: a custom field's value rides in
  // the row's `custom` sub-object, a static field's at the top level.
  const value = customValueOf(row, field)
  const key = `${String(row.id)}:${field.name}`
  const editing = edit?.id === String(row.id) && edit.field === field.name

  // Commit (or dismiss) when the pointer goes down OUTSIDE the editor, as a
  // capture listener on the document. NOT on blur: a trusted click on the
  // edit button queues a browser-side focus change that lands seconds later
  // (the freshly mounted editor input was blurred with
  // no related target, 4-9 s after the click, by no JavaScript call at all),
  // and a commit-on-blur then closes the editor before anyone can type. A
  // capture pointerdown runs before the focus machinery and is driven by the
  // real pointer, so it fires exactly when a user clicks somewhere else.
  // Radix portals (the open select dropdown) are excluded: choosing an
  // option there IS the edit, not a dismissal.
  const editorRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!editing) return undefined
    const onDocPointerDown = (e: PointerEvent) => {
      const root = editorRef.current
      const target = e.target
      if (!root || !(target instanceof Node)) return
      if (root.contains(target)) return
      if (target.parentElement?.closest("[data-radix-popper-content-wrapper], [role='listbox']")) return
      if (renderKindOf(field) === "text") {
        const input = root.querySelector("input")
        if (input) onSave(input.value)
      } else {
        setEdit(null)
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
  }, [editing, field, onSave, setEdit])

  const startEdit = () =>
    setEdit({
      id: String(row.id),
      field: field.name,
      value: value === null || value === undefined ? "" : String(value),
    })

  // The edit affordance follows the metadata alone: editable is enough. A
  // relation field edits as its opaque id for now; a picker is future work,
  // and shrinking the editable surface silently is not an option.
  // The affordance only exists once the client has hydrated: before that the
  // cell renders as plain text (see the hydrated gate in CubeList).
  const editable = interactive && canEdit(field)

  // A never-set boolean is absent, not "no": the same cell must not render a
  // checkbox that starts unchecked and can only ever produce "true" as if the
  // value were an explicit false.
  const boolAbsent =
    field.type === "boolean" && (value === null || value === undefined)

  let content: React.ReactNode
  if (field.relation && value !== null && value !== undefined) {
    // The title comes from the page's batch cache; the raw id shows while it
    // is in flight (or if the row vanished before the batch landed).
    content = <RelationCell target={field.relation.target} id={String(value)} resolve={resolveTitle} />
  } else if (field.type === "boolean" && !boolAbsent) {
    content = value ? "yes" : "no"
  } else {
    content = value === null || value === undefined ? "—" : valueTextOf(value)
  }
  // One long custom text value must not destroy the table layout: clamp the
  // cell, keep the full value in the title tooltip.
  const textValue = value === null || value === undefined ? null : valueTextOf(value)
  const cellText = (node: React.ReactNode) => (
    <span className="block max-w-56 truncate sm:max-w-72" title={textValue ?? undefined}>
      {node}
    </span>
  )

  return (
    <div className="flex flex-col gap-1">
      {editing ? (
        <div ref={editorRef} className="flex flex-col gap-1">
        {renderKindOf(field) === "select" ? (
          <Select
            // Radix forbids an empty-string SelectItem value; the empty item
            // rides on a sentinel and is translated back to "" on save.
            value={edit.value === "" ? "__clear__" : edit.value}
            onValueChange={(v) => {
              setEdit(null)
              onSave(v === "__clear__" ? "" : v)
            }}
          >
            <SelectTrigger className="w-40" aria-label={field.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* An OPTIONAL field can be cleared: the catalogue hard-codes
                  nullable: false on custom fields, so "not required" is the
                  only signal the UI has. */}
              {!field.required && <SelectItem value="__clear__">—</SelectItem>}
              {field.enum!.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : renderKindOf(field) === "checkbox" ? (
          <Checkbox
            autoFocus
            aria-label={field.label}
            checked={edit.value === "true"}
            // Clicking elsewhere must not leave the cell stuck in edit mode.
            onCheckedChange={(checked) => {
              setEdit(null)
              onSave(checked ? "true" : "false")
            }}
          />
        ) : (
          <Input
            autoFocus
            defaultValue={edit.value}
            aria-label={field.label}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(e.currentTarget.value)
              if (e.key === "Escape") setEdit(null)
            }}
          />
        )}
        </div>
      ) : field.relation &&
        value !== null &&
        value !== undefined &&
        hrefForRelation(field.relation.target, String(value)) ? (
        <RelationLink target={field.relation.target} id={String(value)}>
          {content}
        </RelationLink>
      ) : isTitle && rowLink ? (
        <Link className="underline" href={rowLink} title={textValue ?? undefined}>
          {content}
        </Link>
      ) : editable ? (
        <button
          type="button"
          className="min-h-9 cursor-text rounded-sm text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
          title={`Edit ${field.label}`}
          // The accessible name must say what the button does; the cell value
          // alone left a screen reader no way to find the edit affordance.
          aria-label={`Edit ${field.label}`}
          // A REAL (trusted) click moves focus to this button; when the
          // editor replaces it, the browser's delayed focus lands on the
          // node that no longer exists, blurs the freshly mounted editor
          // input, and the input's commit-on-blur closes the editor before
          // anyone could type (trusted click, handler
          // ran, editor mounted and focused, then a blurred input closed it).
          // Suppressing the mousedown focus transfer removes the window;
          // the editor's own autoFocus then holds the focus.
          onMouseDown={(e) => e.preventDefault()}
          onClick={startEdit}
        >
          {cellText(content)}
        </button>
      ) : field.relation || (isTitle && rowLink) ? (
        content
      ) : (
        cellText(content)
      )}
      {error && (
        <span className="text-xs text-destructive" role="alert" data-cell-error={key}>
          {error}
        </span>
      )}
    </div>
  )
}
