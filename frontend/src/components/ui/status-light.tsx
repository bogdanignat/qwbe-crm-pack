// A status as an indicator light (T-1817): a lit dot and a mono label, like
// the lamps on a machine panel. The tone comes from lib/status-tone.ts.

import type { StatusTone } from "@/lib/status-tone"
import { cn } from "@/lib/utils"

const LAMP: Record<StatusTone, string> = {
  ok: "bg-success shadow-[0_0_6px_var(--color-success)]",
  warn: "bg-warning shadow-[0_0_6px_var(--color-warning)]",
  alert: "bg-destructive shadow-[0_0_6px_var(--color-destructive)]",
  idle: "bg-muted-foreground/60",
}

export function StatusLight({ tone, className, children }: { tone: StatusTone; className?: string; children: React.ReactNode }) {
  return (
    <span
      data-slot="status-light"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-sm border bg-background/60 px-2 py-0.5 font-mono text-xs tracking-wide uppercase",
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", LAMP[tone])} />
      {children}
    </span>
  )
}
