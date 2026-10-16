// vtiger's detail grid: per row a right-aligned label, its value, a second
// label and value; a wide row's value spans the rest. The layout follows the
// grid's own width (container query), so beside a sidebar or on a phone it
// falls back to one column, label above value.
//
// The DOM is column-major (lib/field-blocks.ts gridSectionsOf): all the left
// fields, then all the right ones, so tab order, screen readers and Edit all
// read the block as it looks at every width. Two columns are laid out with
// grid-flow-col over one explicit row per field; each field spans a label and
// a value track through a subgrid. The caller renders labels and values; the
// grid knows nothing about the record.

import type { FieldMetadata } from "@/lib/cube"
import { gridSectionsOf, type FieldRow, type GridSection } from "@/lib/field-blocks"
import { cn } from "@/lib/utils"
import { gridRowsClassOf, MAX_GRID_ROWS } from "./field-grid-rows"

type Render = (field: FieldMetadata) => React.ReactNode
type Side = "left" | "right"

const COLUMNS = "grid grid-cols-1 @2xl:grid-cols-[minmax(7rem,12.5rem)_minmax(0,1fr)_minmax(7rem,12.5rem)_minmax(0,1fr)]"
const FIELD = "@2xl:col-span-2 @2xl:grid @2xl:grid-cols-subgrid"
const LABEL = "px-3 pt-2.5 text-sm text-muted-foreground @2xl:border-b @2xl:bg-muted/30 @2xl:py-2 @2xl:text-right"
const VALUE = "min-w-0 border-b px-3 pt-0.5 pb-2.5 text-sm break-words @2xl:py-2"

export function FieldGrid({ rows, label, value }: { rows: readonly FieldRow[]; label: Render; value: Render }) {
  const cell = (field: FieldMetadata | null, side: Side, key: number) =>
    field === null ? (
      // An empty cell keeps the fields below it on their rows.
      <div key={key} aria-hidden className={cn("hidden", FIELD)}>
        <div className="border-b bg-muted/30" />
        <div className={cn("border-b", side === "left" && "border-r")} />
      </div>
    ) : (
      <div key={key} className={FIELD}>
        <div className={LABEL}>{label(field)}</div>
        <div className={cn(VALUE, side === "left" && "@2xl:border-r")}>{value(field)}</div>
      </div>
    )

  const section = (s: GridSection, i: number) =>
    s.kind === "wide" ? (
      <div key={i} className={COLUMNS}>
        {s.field && (
          <div className="@2xl:col-span-4 @2xl:grid @2xl:grid-cols-subgrid">
            <div className={LABEL}>{label(s.field)}</div>
            <div className={cn(VALUE, "@2xl:col-span-3")}>{value(s.field)}</div>
          </div>
        )}
      </div>
    ) : (
      <div key={i} className={cn(COLUMNS, "@2xl:grid-flow-col", gridRowsClassOf(s.left.length))}>
        {s.left.map((f, j) => cell(f, "left", j))}
        {s.right.map((f, j) => cell(f, "right", s.left.length + j))}
      </div>
    )

  return <div className="@container">{gridSectionsOf(rows, MAX_GRID_ROWS).map(section)}</div>
}
