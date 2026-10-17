"use client"

// The small marker next to a label of a field the backend does not publish
// yet (MOCK): an icon, the words in a tooltip on hover and, for screen
// readers, in full in the label itself. Not a tab stop: Edit all would gain
// one per marked field. Needs the app's TooltipProvider (app-shell).

import { CircleDashed } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { FieldMarker as Marker } from "@/lib/field-marker"

export function FieldMarker({ marker }: { marker: Marker }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ml-1 inline-flex align-[-0.125em] text-amber-600 dark:text-amber-400">
          <CircleDashed aria-hidden className="size-3.5" />
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
