"use client"

// The toolbar above a list (spec §2.6): the saved views, then one row with
// the quick search, the exact filters behind "Filters", the column picker and
// the create action, then the chips of what is active. Only what the
// published list contract honours is offered (lib/cube listControlsOf).

import Link from "next/link"
import { useState } from "react"
import { FilterIcon, PlusIcon } from "lucide-react"

import { RelationTypeahead } from "@/components/relation-typeahead"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ListColumns } from "@/hooks/use-list-columns"
import type { ListQuery } from "@/hooks/use-list-query"
import type { ListControls } from "@/lib/cube"
import type { FilterChip } from "@/lib/list-filters"
import { pickerColumnsOf } from "@/lib/list-columns"
import { ColumnPicker } from "./column-picker"
import { FilterChips } from "./filter-chips"
import { TextSearch } from "./text-search"

export function ListToolbar({
  query,
  controls,
  columns,
  unlisted,
  chips,
  onRemoveChip,
  onClearAll,
  epoch,
  views,
  searchPlaceholder,
  createHref,
  addLabel,
}: {
  query: ListQuery
  controls: ListControls
  columns: ListColumns
  unlisted?: ReadonlySet<string>
  chips: readonly FilterChip[]
  onRemoveChip: (key: string) => void
  onClearAll: () => void
  // Bumped when the query is reset from outside, so the boxes show it.
  epoch: number
  views: React.ReactNode
  searchPlaceholder: string
  createHref?: string
  addLabel: string
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const active = Object.keys(query.userFilters).length

  return (
    <div className="flex flex-col gap-3">
      {views}
      <div className="flex flex-wrap items-end gap-2">
        {controls.search && (
          <TextSearch
            key={`q:${epoch}`}
            icon
            ariaLabel="Search (prefix match)"
            placeholder={searchPlaceholder}
            value={query.prefix}
            onChange={query.setQuery}
            className="sm:w-80"
          />
        )}
        {controls.filters.length > 0 && (
          <Button variant="outline" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            <FilterIcon aria-hidden /> Filters
            {active > 0 && <Badge variant="secondary">{active}</Badge>}
          </Button>
        )}
        <ColumnPicker
          columns={pickerColumnsOf(columns.all, columns.names, unlisted)}
          shown={columns.names}
          title={columns.title}
          onPick={columns.pick}
          onReset={columns.reset}
        />
        {createHref && (
          <Button asChild className="sm:ml-auto">
            <Link href={createHref}>
              <PlusIcon aria-hidden /> {addLabel}
            </Link>
          </Button>
        )}
      </div>
      {filtersOpen && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3" role="group" aria-label="Filters">
          {controls.filters.map((f) =>
            f.relation ? (
              <RelationTypeahead
                key={`${f.name}:${epoch}`}
                field={f}
                value={query.search[f.name] ?? ""}
                onChange={(v) => query.setFilter(f.name, v)}
              />
            ) : (
              <TextSearch
                key={`${f.name}:${epoch}`}
                label={`${f.label} (exact)`}
                ariaLabel={`Filter by ${f.label} (exact match)`}
                value={query.search[f.name] ?? ""}
                onChange={(v) => query.setFilter(f.name, v)}
              />
            ),
          )}
        </div>
      )}
      <FilterChips chips={chips} onRemove={onRemoveChip} onClear={onClearAll} />
    </div>
  )
}
