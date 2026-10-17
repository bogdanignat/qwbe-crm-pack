// vtiger's "Actions" box beside the blocks. Send Mail opens the mail client on
// the organization's email; the rest need the backend (events, tasks,
// documents, SMS), so they show disabled and say so. Mail Merge, EMAILMaker
// and the Member Of hierarchy (Member Of was dropped) are left out
// (docs/plan/organizations-backend.md).

import { CalendarPlus, FilePlus, ListTodo, Mail, MessageSquare, type LucideIcon } from "lucide-react"

import { DisabledAction } from "@/components/disabled-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Row } from "@/lib/cube"
import { mailtoOf } from "@/lib/organization-summary"

const PENDING_ACTIONS: readonly { label: string; icon: LucideIcon }[] = [
  { label: "Add Event", icon: CalendarPlus },
  { label: "Add To Do", icon: ListTodo },
  { label: "Add Note", icon: FilePlus },
  { label: "Send SMS", icon: MessageSquare },
]

// A long label wraps inside the narrow column instead of running out of the card.
const ACTION = "h-auto min-h-8 w-full justify-start py-1.5 text-left whitespace-normal"

export function ActionsSidebar({ row }: { row: Row }) {
  const mailto = mailtoOf(row)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-0.5">
          <li>
            {mailto ? (
              <Button variant="ghost" className={ACTION} asChild>
                <a href={mailto}>
                  <Mail aria-hidden /> Send Mail
                </a>
              </Button>
            ) : (
              <DisabledAction variant="ghost" className={ACTION} reason="No email address">
                <Mail aria-hidden /> Send Mail
              </DisabledAction>
            )}
          </li>
          {PENDING_ACTIONS.map(({ label, icon: Icon }) => (
            <li key={label}>
              <DisabledAction variant="ghost" className={ACTION}>
                <Icon aria-hidden /> {label}
              </DisabledAction>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
