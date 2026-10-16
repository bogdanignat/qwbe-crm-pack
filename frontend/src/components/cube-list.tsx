"use client"

// The one generic list, driven by cube metadata (Organizations, Contacts).
//
// It renders the published fields as columns (label, type, enum, relation),
// sortable headers only where the contract allows, the quick search and the
// exact filters the contract publishes, and server-side paging end to end.
// Relation cells resolve in ONE batch request per target cube. The pieces
// live in components/list/ and the state in hooks/use-list-*.ts; what is
// specific to one module (its default columns, mass actions, row menu, demo
// rows) comes from the caller, e.g. components/organizations/organization-list.
// The page in view is remembered for the detail's previous / next arrows.

import { useEffect, useMemo, useState } from "react"

import { ListViews } from "@/components/list-views"
import { Skeleton } from "@/components/ui/skeleton"
import { useCellEdits } from "@/hooks/use-cell-edits"
import { useHydrated } from "@/hooks/use-hydrated"
import { useListColumns } from "@/hooks/use-list-columns"
import { useListQuery } from "@/hooks/use-list-query"
import { useRelationTitles } from "@/hooks/use-relation-titles"
import { useRowSelection } from "@/hooks/use-row-selection"
import { listWindowOf, rowHref, type ListNoun, type Row } from "@/lib/cube"
import { demoRowsMatching } from "@/lib/demo-search"
import { writeListContext } from "@/lib/list-context"
import { filterChipsOf } from "@/lib/list-filters"
import { relationRefsOf } from "@/lib/relation-batch"
import { ListCell } from "./list/list-cell"
import { ListEmpty } from "./list/list-empty"
import { ListPagination } from "./list/list-pagination"
import { ListTable } from "./list/list-table"
import { ListToolbar } from "./list/list-toolbar"
import { SelectionBar } from "./list/selection-bar"

const NO_ROWS: readonly Row[] = []
const ROWS: ListNoun = { one: "row", other: "rows" }

export function CubeList({
  cube,
  fixedFilters,
  createHref,
  addLabel = "Add",
  emptyMessage = "No rows yet.",
  noun = ROWS,
  demoRows = NO_ROWS,
  defaultColumns,
  unlistedColumns,
  searchPlaceholder = "Search",
  massActions,
  rowMenu,
}: {
  cube: string
  // Server-side equality filters pinned by the caller; they get no control.
  fixedFilters?: Readonly<Record<string, string>>
  createHref?: string
  addLabel?: string
  emptyMessage?: string
  // What the range label counts ("5 organizations"); a module-level constant.
  noun?: ListNoun
  // Read-only mockup rows on top of the first page, matched against the query.
  demoRows?: readonly Row[]
  defaultColumns?: readonly string[]
  unlistedColumns?: ReadonlySet<string>
  searchPlaceholder?: string
  // With mass actions the rows get checkboxes and the selection bar.
  massActions?: React.ReactNode
  rowMenu?: (row: Row, demo: boolean) => React.ReactNode
}) {
  const query = useListQuery(cube, fixedFilters)
  const { meta, controls, page } = query
  const columns = useListColumns(cube, meta, defaultColumns)
  const hydrated = useHydrated()
  const [activeView, setActiveView] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  // A derived list (pinned filters) gets no saved views and no previous / next.
  const derived = Object.keys(query.fixedFilters).length > 0

  const searchFields = meta?.list?.search
  const demo = useMemo(
    () => demoRowsMatching(demoRows, searchFields ?? [], { q: query.prefix, filters: query.userFilters }),
    [demoRows, searchFields, query.prefix, query.userFilters],
  )
  const view = useMemo(() => (page ? listWindowOf(page, demo, noun) : null), [page, demo, noun])
  const pageIds = useMemo(() => page?.rows.map((r) => String(r.id)) ?? [], [page])
  const selection = useRowSelection(query.queryKey, pageIds)
  const cells = useCellEdits(cube, query.queryKey, query.patchRow)

  const chips = controls ? filterChipsOf(query.prefix, query.userFilters, controls.filters) : []
  // One batch per target for the page's relation cells and the relation chips.
  const relationRefs = useMemo(() => {
    const onPage = page ? relationRefsOf(page.rows, columns.columns.map((c) => c.field)) : []
    const chosen = (controls?.filters ?? []).flatMap((f) =>
      f.relation && query.userFilters[f.name] ? [{ target: f.relation.target, id: query.userFilters[f.name] }] : [],
    )
    return [...onPage, ...chosen]
  }, [page, columns.columns, controls, query.userFilters])
  const resolveTitle = useRelationTitles(relationRefs)

  // The order the reader sees, for the detail's previous / next.
  const shownIds = useMemo(() => (view && page ? [...view.demo, ...page.rows].map((r) => String(r.id)) : null), [view, page])
  useEffect(() => {
    if (shownIds && !derived) writeListContext(cube, shownIds)
  }, [cube, shownIds, derived])

  if (query.metaError) return <p role="alert">metadata unavailable: {query.metaError}</p>
  if (!meta || !controls) return <Skeleton className="h-64 w-full" />

  const resetting = (reset: () => void) => {
    reset()
    setEpoch((n) => n + 1)
  }
  const title = columns.title
  const empty = page !== null && page.rows.length === 0 && view?.demo.length === 0
  const relationLabel = (key: string, value: string) => {
    const target = controls.filters.find((f) => f.name === key)?.relation?.target
    return target ? (resolveTitle(target, value) ?? value) : value
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        controls={controls}
        columns={columns}
        unlisted={unlistedColumns}
        chips={chips.map((c) => ({ ...c, value: relationLabel(c.key, c.value) }))}
        onRemoveChip={(key) => resetting(() => query.clearChip(key))}
        onClearAll={() => resetting(query.clearAll)}
        epoch={epoch}
        searchPlaceholder={searchPlaceholder}
        createHref={createHref}
        addLabel={addLabel}
        views={
          !derived && (
            <ListViews
              targetCube={cube}
              meta={meta}
              controls={controls}
              fixedFilters={query.fixedFilters}
              state={{ columns: columns.names, filters: query.search, q: query.prefix, sortBy: query.sortBy, descending: query.descending, pageSize: query.pageSize }}
              activeId={activeView}
              onApply={(row, applied) =>
                resetting(() => {
                  query.applyView(applied)
                  columns.applyView(applied ? applied.columns : undefined)
                  setActiveView(row && applied ? row.id : null)
                })
              }
            />
          )
        }
      />
      {query.listError && <p role="alert">{query.listError}</p>}
      {massActions && (
        <SelectionBar count={selection.ids.length} onClear={selection.clear}>
          {massActions}
        </SelectionBar>
      )}
      {empty ? (
        <ListEmpty
          filtered={query.filtered}
          message={emptyMessage}
          createHref={createHref}
          addLabel={addLabel}
          onClear={() => resetting(query.clearAll)}
        />
      ) : (
        <ListTable
          label={`${meta.entity ?? cube} list`}
          columns={columns.columns}
          sortBy={query.sortBy}
          descending={query.descending}
          onSort={query.toggleSort}
          rows={page?.rows ?? null}
          rowName={(row) => String((title && row[title]) ?? row.id)}
          demoRows={view?.demo ?? []}
          selection={massActions ? selection : undefined}
          rowMenu={rowMenu}
          renderCell={(row, column, isDemo) => (
            <ListCell
              row={row}
              column={column}
              isTitle={column.field.name === title}
              rowLink={rowHref(cube, String(row.id))}
              edit={isDemo ? null : cells.edit}
              setEdit={cells.setEdit}
              error={isDemo ? undefined : cells.errorOf(String(row.id), column.field.name)}
              interactive={hydrated && !isDemo}
              resolveTitle={resolveTitle}
              onSave={(value) => void cells.save(row, column.field, value)}
            />
          )}
        />
      )}
      {!empty && (
        <ListPagination
          label={view?.label ?? "loading"}
          offset={query.offset}
          pageSize={query.pageSize}
          rowCount={page?.rows.length ?? 0}
          total={page?.total}
          onOffset={query.setOffset}
          onPageSize={query.setPageSize}
        />
      )}
    </div>
  )
}
