"use client"

// The list's table: an optional checkbox column (vtiger's selection, page by
// page), the columns with server-side sorting where the metadata allows it,
// the demo rows on top (marked, never selectable), the server rows, and an
// optional "⋯" menu per row. The cells come from the caller; a row is a
// hover/focus group, so a cell's secondary controls can show only then.

import { FieldMarker } from "@/components/field-marker"
import { PANEL_FRAME } from "@/components/kit/panel-header"
import { MockTag } from "@/components/mock-tag"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RowSelection } from "@/hooks/use-row-selection"
import type { ColumnSpec, Row } from "@/lib/cube"
import { fieldMarkerOf } from "@/lib/field-marker"
import { cn } from "@/lib/utils"
import { DemoRowCheckbox } from "./demo-row-checkbox"

export function ListTable({
  label,
  columns,
  sortBy,
  descending,
  onSort,
  rows,
  demoRows,
  rowName,
  renderCell,
  selection,
  rowMenu,
}: {
  label: string
  columns: readonly ColumnSpec[]
  sortBy: string | undefined
  descending: boolean
  onSort: (column: ColumnSpec) => void
  // null while the first page loads.
  rows: readonly Row[] | null
  demoRows: readonly Row[]
  // The row's title, naming its checkbox ("Select Exemplu Construct SRL").
  rowName: (row: Row) => string
  renderCell: (row: Row, column: ColumnSpec, demo: boolean) => React.ReactNode
  selection?: RowSelection
  rowMenu?: (row: Row, demo: boolean) => React.ReactNode
}) {
  const ariaSort = (name: string) => (sortBy === name ? (descending ? "descending" : "ascending") : undefined)

  const row = (r: Row, demo: boolean) => {
    const id = String(r.id)
    return (
      <TableRow key={`${demo ? "demo:" : ""}${id}`} className={cn("group/row", demo && "bg-muted/40")} data-demo-row={demo ? id : undefined}>
        {selection && (
          <TableCell className="w-10">
            {demo ? (
              <DemoRowCheckbox name={rowName(r)} />
            ) : (
              <Checkbox
                aria-label={`Select ${rowName(r)}`}
                checked={selection.has(id)}
                onCheckedChange={(on) => selection.toggle(id, on === true)}
              />
            )}
          </TableCell>
        )}
        {columns.map((column, i) => (
          <TableCell key={column.field.name}>
            {demo && i === 0 ? (
              <div className="flex items-center gap-1">
                {renderCell(r, column, demo)}
                <MockTag>demo</MockTag>
              </div>
            ) : (
              renderCell(r, column, demo)
            )}
          </TableCell>
        ))}
        {rowMenu && <TableCell className="w-12 py-0.5">{rowMenu(r, demo)}</TableCell>}
      </TableRow>
    )
  }

  return (
    // An opaque panel: the blueprint grid must not show through the cells.
    <div className={cn(PANEL_FRAME, "overflow-hidden")}>
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            {selection && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all rows on this page"
                  checked={selection.allOnPage ? true : selection.ids.length > 0 ? "indeterminate" : false}
                  disabled={!rows || rows.length === 0}
                  onCheckedChange={(on) => selection.toggleAll(on === true)}
                />
              </TableHead>
            )}
            {columns.map((column) => {
              const marker = fieldMarkerOf(column.field)
              const sorted = ariaSort(column.field.name)
              return (
                <TableHead key={column.field.name} className="whitespace-nowrap" aria-sort={sorted}>
                  {column.sortable ? (
                    <Button variant="ghost" size="sm" className="-ml-2.5 px-2.5 text-xs uppercase" onClick={() => onSort(column)}>
                      {column.field.label}
                      {sorted ? (sorted === "descending" ? " ↓" : " ↑") : <span aria-hidden className="text-muted-foreground/60">↕</span>}
                    </Button>
                  ) : (
                    <span>{column.field.label}</span>
                  )}
                  {marker && <FieldMarker marker={marker} />}
                </TableHead>
              )
            })}
            {rowMenu && (
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {demoRows.map((r) => row(r, true))}
          {rows
            ? rows.map((r) => row(r, false))
            : Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length + (selection ? 1 : 0) + (rowMenu ? 1 : 0)}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  )
}
