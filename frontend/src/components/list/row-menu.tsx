"use client"

// A row's actions (vtiger's Action column: edit | del) in a "⋯" menu. An
// action that cannot run yet stays in the menu, announced as unavailable
// (aria-disabled) with its reason written in the item, so a keyboard user
// reaches it and reads why; choosing it does nothing.

import Link from "next/link"
import { MoreHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9" aria-label={label}>
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RowMenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <DropdownMenuItem asChild>
      <Link href={href}>{children}</Link>
    </DropdownMenuItem>
  )
}

export function RowMenuUnavailable({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <DropdownMenuItem
      aria-disabled="true"
      className="cursor-not-allowed justify-between opacity-60"
      onSelect={(e) => e.preventDefault()}
    >
      <span className="flex items-center gap-1.5">{children}</span>
      <span className="text-xs text-muted-foreground">{reason}</span>
    </DropdownMenuItem>
  )
}
