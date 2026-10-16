// The contacts of one organization in vtiger's columns. The first column
// names the contact and opens it (a demo contact has no page, so its name is
// plain text); the other values show as the detail shows them (FieldValue:
// phones and the email are links). A column the contacts cube does not
// publish yet is marked mock and stays empty. Each row ends with vtiger's
// actions: edit (the contact's page in edit mode) and del (needs backend).

import Link from "next/link"
import { PencilIcon, Trash2Icon } from "lucide-react"

import { DisabledAction } from "@/components/disabled-action"
import { Button } from "@/components/ui/button"

import { FieldMarker } from "@/components/field-marker"
import { FieldValue } from "@/components/kit/field-value"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { customValueOf, fieldDisplayTextOf, type FieldMetadata, type Row } from "@/lib/cube"
import { MOCK_MARKER } from "@/lib/field-marker"
import type { ContactColumn } from "@/lib/related-contacts"

export function ContactsTable({
  columns,
  rows,
  hrefOf,
  editHrefOf,
}: {
  columns: readonly ContactColumn[]
  rows: readonly Row[]
  // The contact's page, or null when it has none.
  hrefOf: (row: Row) => string | null
  // The contact's page in edit mode, or null when it cannot be edited (demo).
  editHrefOf: (row: Row) => string | null
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.label}>
              {column.label}
              {!column.field && <FieldMarker marker={MOCK_MARKER} />}
            </TableHead>
          ))}
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={String(row.id)}>
            {columns.map((column, i) => (
              <TableCell key={column.label}>
                {column.field ? (
                  <ContactValue field={column.field} row={row} titleLink={i === 0 ? hrefOf(row) : null} />
                ) : (
                  "—"
                )}
              </TableCell>
            ))}
            <TableCell className="py-0.5">
              <ContactActions name={String(row.name ?? row.id)} editHref={editHrefOf(row)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ContactValue({ field, row, titleLink }: { field: FieldMetadata; row: Row; titleLink: string | null }) {
  const value = customValueOf(row, field)
  const text = value === null || value === undefined || value === "" ? null : fieldDisplayTextOf(field, value)
  if (titleLink && text !== null) {
    return (
      <Link className="underline" href={titleLink}>
        {text}
      </Link>
    )
  }
  return <FieldValue field={field} record={{ ...row, [field.name]: value }} text={text} />
}

function ContactActions({ name, editHref }: { name: string; editHref: string | null }) {
  const edit = <PencilIcon aria-hidden />
  return (
    <span className="flex gap-1">
      {editHref ? (
        <Button variant="ghost" size="icon" className="size-9" asChild>
          <Link href={editHref} aria-label={`Edit ${name}`}>
            {edit}
          </Link>
        </Button>
      ) : (
        <DisabledAction variant="ghost" size="icon" className="size-9" aria-label={`Edit ${name}`} reason="Demo records are read-only">
          {edit}
        </DisabledAction>
      )}
      <DisabledAction variant="ghost" size="icon" className="size-9" aria-label={`Delete ${name}`}>
        <Trash2Icon aria-hidden />
      </DisabledAction>
    </span>
  )
}
