"use client"

// A demo row's checkbox: shown, never checkable, and saying why on hover and
// on keyboard focus (the DisabledAction pattern: aria-disabled, still
// focusable, the reason as its description and tooltip).

import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const REASON = "Demo row, read-only"

export function DemoRowCheckbox({ name }: { name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Checkbox
          checked={false}
          aria-label={`Select ${name}`}
          aria-disabled="true"
          aria-description={REASON}
          className="cursor-not-allowed opacity-50"
        />
      </TooltipTrigger>
      <TooltipContent>{REASON}</TooltipContent>
    </Tooltip>
  )
}
