"use client"

// The list's paging: the range ("1-25 of 61.347 · +3 demo"), Previous / Next,
// a typed page number (2400 pages of Next is not navigation), and the page
// size. The page number commits on Enter or blur and is clamped to the last
// page when qwbe reports a total; without one, a short page proves the end.

import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { pageFromInput, pageWindow } from "@/lib/cube"
import { PAGE_SIZES } from "@/lib/views"

export function ListPagination({
  label,
  offset,
  pageSize,
  rowCount,
  total,
  onOffset,
  onPageSize,
}: {
  label: string
  offset: number
  pageSize: number
  rowCount: number
  total: number | undefined
  onOffset: (offset: number) => void
  onPageSize: (size: number) => void
}) {
  // The typed page before it is committed; null shows the current page.
  const [draft, setDraft] = useState<string | null>(null)
  const { currentPage, lastPage } = pageWindow(offset, pageSize, total)
  const atEnd = total !== undefined ? offset + pageSize >= total : rowCount < pageSize

  // Enter then blur is one request: after Enter the draft is gone.
  const commit = () => {
    if (draft === null) return
    const wanted = pageFromInput(draft, lastPage)
    setDraft(null)
    if (wanted !== undefined && wanted !== currentPage) onOffset((wanted - 1) * pageSize)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - pageSize))}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          Page
          <Input
            type="number"
            min={1}
            max={lastPage}
            className="w-16"
            aria-label="Page"
            value={draft ?? String(currentPage)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          {lastPage !== undefined && <span>of {lastPage}</span>}
        </label>
        <Button variant="outline" size="icon" aria-label="Next page" disabled={atEnd} onClick={() => onOffset(offset + pageSize)}>
          <ChevronRightIcon aria-hidden />
        </Button>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
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
  )
}
