"use client"

// One list cell: the value as the field's metadata says (a relation's title,
// yes/no, a ro-RO number or date, a tel:/mailto:/http link), the title cell
// linked to the row's page, and an editable value opening the inline editor.
// Long text is clamped, the full value in the tooltip.

import Link from "next/link"
import { PencilIcon } from "lucide-react"

import {
  canEdit,
  customValueOf,
  fieldDisplayTextOf,
  formatHrefOf,
  hrefForRelation,
  type ColumnSpec,
  type Row,
} from "@/lib/cube"
import type { EditState } from "@/hooks/use-cell-edits"
import { isMonoValue } from "@/lib/mono-value"
import { FormatLink } from "@/components/format-link"
import { RelationCell, RelationLink } from "@/components/relation-cell"
import { cn } from "@/lib/utils"
import { CellEditor } from "./cell-editor"

export type CellProps = {
  row: Row
  column: ColumnSpec
  isTitle: boolean
  rowLink: string | null
  edit: EditState | null
  setEdit: (edit: EditState | null) => void
  error?: string
  // False until hydrated, and on demo rows: the cell is plain text then.
  interactive: boolean
  resolveTitle: (target: string, id: string) => string | null
  onSave: (value: string) => void
}

export function ListCell({ row, column, isTitle, rowLink, edit, setEdit, error, interactive, resolveTitle, onSave }: CellProps) {
  const field = column.field
  const value = customValueOf(row, field)
  const id = String(row.id)
  const empty = value === null || value === undefined
  const text = empty ? null : fieldDisplayTextOf(field, value)
  const editable = interactive && canEdit(field)
  const external = formatHrefOf(field, value)
  const relationHref = field.relation && !empty ? hrefForRelation(field.relation.target, String(value)) : null
  const mono = !empty && isMonoValue(field, value)

  // A never-set boolean is absent, not "no".
  const content =
    field.relation && !empty ? (
      <RelationCell target={field.relation.target} id={String(value)} resolve={resolveTitle} />
    ) : field.type === "boolean" && !empty ? (
      value ? "yes" : "no"
    ) : (
      (text ?? "—")
    )
  const clamped = (node: React.ReactNode) => (
    <span className="block max-w-56 truncate sm:max-w-72" title={text ?? undefined}>
      {node}
    </span>
  )

  // The inline edit affordance: the whole cell, or a pencil next to a link.
  // mousedown does not move focus, so the editor's autofocus keeps it.
  const editButton = (children: React.ReactNode, className = "min-h-9 cursor-text text-left") => (
    <button
      type="button"
      className={cn(className, "rounded-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring")}
      aria-label={`Edit ${field.label}`}
      title={`Edit ${field.label}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setEdit({ id, field: field.name, value: empty ? "" : String(value) })}
    >
      {children}
    </button>
  )

  const body = () => {
    if (edit?.id === id && edit.field === field.name) {
      return <CellEditor field={field} edit={edit} onSave={onSave} onClose={() => setEdit(null)} />
    }
    if (relationHref && field.relation) {
      return (
        <RelationLink target={field.relation.target} id={String(value)}>
          {content}
        </RelationLink>
      )
    }
    if (isTitle && rowLink) {
      return (
        <Link className="underline" href={rowLink} title={text ?? undefined}>
          {content}
        </Link>
      )
    }
    if (external) {
      return (
        <span className="flex items-center gap-1">
          <FormatLink field={field} href={external}>
            {clamped(content)}
          </FormatLink>
          {editable &&
            editButton(
              <PencilIcon aria-hidden className="size-3.5" />,
              // Shown on the row's hover or focus where there is a mouse; the
              // space stays reserved, so nothing shifts.
              "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100",
            )}
        </span>
      )
    }
    if (editable) return editButton(clamped(content))
    return field.relation ? content : clamped(content)
  }

  return (
    <div className={cn("flex flex-col gap-1", mono && "font-mono tabular-nums")}>
      {body()}
      {error && (
        <span className="text-xs text-destructive" role="alert" data-cell-error={`${id}:${field.name}`}>
          {error}
        </span>
      )}
    </div>
  )
}
