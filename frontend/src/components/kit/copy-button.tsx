"use client"

// A discreet copy action next to a value: named for screen readers, sized for
// a finger (36px), never enters edit mode, reports a clipboard refusal (no
// Clipboard API on an insecure origin, denied permission) instead of failing
// silently.

import { CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/kit-form"

export function CopyButton({ label, text, className }: { label: string; text: string; className?: string }) {
  async function copy() {
    const failure = await copyText(text)
    if (failure === null) toast.success(`${label} copied`)
    else toast.error(`Copy failed: ${failure}`)
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-9 shrink-0 text-muted-foreground", className)}
      aria-label={`Copy ${label}`}
      onClick={copy}
    >
      <CopyIcon aria-hidden />
    </Button>
  )
}
