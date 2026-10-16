"use client"

// The small marker next to a label of a field the backend does not publish
// yet: an icon whose shape tells MOCK (cube) from CUSTOM (runtime custom
// field), the words in a tooltip on hover and, for screen readers, in full in
// the label itself. Not a tab stop: Edit all would gain one per marked field.
// Needs the app's TooltipProvider (app-shell).

import { CircleDashed, Puzzle } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { FieldMarker as Marker } from "@/lib/field-marker"
import { cn } from "@/lib/utils"

export function FieldMarker({ marker }: { marker: Marker }) {
  const Icon = marker.kind === "custom" ? Puzzle : CircleDashed
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-marker={marker.kind}
          className={cn(
            "ml-1 inline-flex align-[-0.125em]",
            marker.kind === "custom" ? "text-sky-600 dark:text-sky-400" : "text-amber-600 dark:text-amber-400",
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          <span className="sr-only">
            {" "}
            ({marker.label}: {marker.description})
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {marker.label}: {marker.description}
      </TooltipContent>
    </Tooltip>
  )
}
