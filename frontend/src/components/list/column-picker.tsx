"use client"

// Which columns the list shows: every field the list has, the current ones
// first, ticked; the title column always stays. The menu stays open while
// ticking, and "Reset columns" goes back to the list's defaults.

import { Columns3Icon } from "lucide-react"

import { FieldMarker } from "@/components/field-marker"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ColumnSpec } from "@/lib/cube"
import { fieldMarkerOf } from "@/lib/field-marker"

export function ColumnPicker({
  columns,
  shown,
  title,
  onPick,
  onReset,
}: {
  columns: readonly ColumnSpec[]
  shown: readonly string[]
  title: string | undefined
  onPick: (name: string, on: boolean) => void
  onReset: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3Icon aria-hidden /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {columns.map(({ field }) => {
          const marker = fieldMarkerOf(field)
          return (
            <DropdownMenuCheckboxItem
              key={field.name}
              checked={shown.includes(field.name)}
              disabled={field.name === title}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onPick(field.name, on === true)}
            >
              {field.label}
              {marker && <FieldMarker marker={marker} />}
            </DropdownMenuCheckboxItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>Reset columns</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
