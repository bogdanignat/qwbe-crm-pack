"use client"

// An action the page shows but cannot run yet: a real button, announced as
// disabled (aria-disabled) yet still focusable, so hover and keyboard focus
// both show why. Its name is its own text; the reason is its description.
// Needs the app's TooltipProvider (app-shell).

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function DisabledAction({
  reason = "Needs backend",
  className,
  children,
  ...button
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "disabled"> & { reason?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...button}
          type="button"
          aria-disabled="true"
          aria-description={reason}
          className={cn("cursor-not-allowed opacity-50 hover:bg-transparent", className)}
          onClick={(e) => e.preventDefault()}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}
