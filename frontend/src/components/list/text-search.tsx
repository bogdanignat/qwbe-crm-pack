"use client"

// A search box whose keystrokes stay local: only the pause reaches qwbe, so
// typing "Acme" is one request, not four (three of them guaranteed misses on
// an exact filter). A new value from outside (Back, a link to the bare list)
// replaces the box's text unless the reader is mid-pause.

import { useEffect, useRef, useState } from "react"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const PAUSE_MS = 300

export function TextSearch({
  label,
  ariaLabel,
  placeholder,
  value,
  onChange,
  icon = false,
  className,
}: {
  // Shown above the box; none for the quick search, which has its icon.
  label?: string
  ariaLabel: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  icon?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [pending, setPending] = useState(false)
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    if (!pending) setDraft(value)
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A pause that never ends (the page is left mid-typing) must not fire.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <label className={cn("flex w-full flex-col gap-1 sm:w-64", className)}>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <span className="relative">
        {icon && (
          <SearchIcon aria-hidden className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          type="search"
          className={cn("w-full", icon && "pl-8")}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            setPending(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              setPending(false)
              onChange(next)
            }, PAUSE_MS)
          }}
        />
      </span>
    </label>
  )
}
