// The global search (spec §1.5): a command palette opened from the top bar or with
// ⌘K / Ctrl+K, results grouped per module, each opening its record. The search
// itself is lib/global-search.ts. The palette is the shadcn Dialog around the kit's
// Command (cmdk, shipped by shadcn-admin-kit), which owns the arrow keys and Enter.

"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { SearchIcon } from "lucide-react"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "shadcn-admin-kit"

import { MockTag } from "@/components/mock-tag"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { searchAll, type SearchGroup } from "@/lib/global-search"

const SEARCH_PAUSE_MS = 250
const noSubscribe = () => () => undefined

export function SearchPalette() {
  const [open, setOpen] = useState(false)
  const isMac = useSyncExternalStore(noSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setOpen((wasOpen) => !wasOpen)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      <Button
        variant="outline"
        className="w-full max-w-sm justify-start gap-2 font-normal text-muted-foreground"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden />
        <span className="truncate">Search...</span>
        <Kbd className="ml-auto hidden sm:inline-flex">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>Organizations and contacts whose name starts with the text you type.</DialogDescription>
          </DialogHeader>
          {/* Unmounted on close, so every opening starts with an empty search. */}
          <PaletteSearch onPick={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function PaletteSearch({ onPick }: { onPick: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  // The last answer and the text it answers: while a newer search runs, its hits
  // stay on screen but the status says "Searching...".
  const [answer, setAnswer] = useState<{ q: string; groups: SearchGroup[] } | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q === "") return undefined
    // Typing on cancels the previous search's requests, not just its answer.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void searchAll(q, { signal: controller.signal }).then((groups) => {
        if (!controller.signal.aborted) setAnswer({ q, groups })
      })
    }, SEARCH_PAUSE_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  const q = query.trim()
  const shown = q === "" ? [] : (answer?.groups ?? []).filter((g) => g.hits.length > 0 || g.error)
  const count = shown.reduce((sum, g) => sum + g.hits.length, 0)
  const status =
    q === ""
      ? "Type the beginning of a name."
      : answer?.q !== q
        ? "Searching..."
        : count === 0
          ? `No results for "${q}".`
          : `${count} result${count === 1 ? "" : "s"}.`

  return (
    <Command shouldFilter={false} className="**:data-[slot=command-input-wrapper]:h-12">
      <CommandInput
        aria-label="Search organizations and contacts"
        placeholder="Search organizations and contacts..."
        value={query}
        onValueChange={setQuery}
      />
      <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
        {status}
      </p>
      <CommandList className="max-h-[min(24rem,60svh)]">
        {shown.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.error && <p className="px-2 py-1.5 text-sm text-muted-foreground">{group.error}</p>}
            {group.hits.map((hit) => (
              <CommandItem
                key={hit.href}
                value={hit.href}
                onSelect={() => {
                  onPick()
                  router.push(hit.href)
                }}
              >
                <span className="truncate">{hit.title}</span>
                {hit.demo && <MockTag>demo</MockTag>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}
