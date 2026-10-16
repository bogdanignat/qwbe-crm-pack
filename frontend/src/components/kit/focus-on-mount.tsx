"use client"

// Moves keyboard focus to the first focusable control inside on mount, so a
// field opened with the pencil is ready to type into (the kit inputs do not
// take an autoFocus prop).

import { useEffect, useRef } from "react"

export function FocusOnMount({ children, ...rest }: React.ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea, [role=combobox], button")?.focus()
  }, [])
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  )
}
