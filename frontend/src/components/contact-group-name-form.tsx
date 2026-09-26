"use client"

// The one form both name writes use: create a group, and rename one. They are
// the same field with the same three rules, so they are the same component --
// a second copy is a second place for the rules to drift.
//
// The three rules, and who owns each:
//   BLANK   refused here. A blank or whitespace-only name is a 400 by
//           contract, so the submit button is disabled on it rather than
//           spending a round trip. This is the ONLY value this UI refuses.
//   CASE    never touched. The name travels exactly as typed -- the cube
//           preserves casing and spacing, and re-spelling a group's own name
//           (Ada -> ADA) is a legitimate 200.
//   UNIQUE  warned here, decided by the server. Names are unique on
//           lower(btrim(name)), but the database is the arbiter and another
//           user may win the race, so the warning never blocks the submit and
//           a 409 is a normal answer the form reports.

import { useState, type FormEvent } from "react"

import {
  duplicateNameWarning,
  isBlankName,
  type ContactGroup,
} from "@/lib/contact-groups"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type NameFormResult = { ok: boolean; message?: string }

export type ContactGroupNameFormProps = {
  // The field's visible label AND its accessible name.
  label: string
  submitLabel: string
  initialName?: string
  // The groups the CALLER ALREADY HAS, for the duplicate WARNING only. A page
  // is not the cube, which is exactly why this warns and never refuses --- and
  // why nothing is ever fetched just to produce this warning. Omitted where
  // there is no such list at hand (rename), and the server's 409 is then the
  // only, authoritative answer.
  known?: ReadonlyArray<ContactGroup>
  // The group being renamed, so its own name is not warned about.
  selfId?: string
  busy: boolean
  // Emptied after a successful submit (create), or left holding the saved
  // value (rename).
  resetOnSuccess?: boolean
  onSubmit: (name: string) => Promise<NameFormResult>
}

export function ContactGroupNameForm({
  label,
  submitLabel,
  initialName = "",
  known = [],
  selfId,
  busy,
  resetOnSuccess = false,
  onSubmit,
}: ContactGroupNameFormProps) {
  const [name, setName] = useState(initialName)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const blank = isBlankName(name)
  const warning = duplicateNameWarning(name, known, selfId)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (blank || busy) return
    setRefusal(null)
    setSaved(false)
    const result = await onSubmit(name)
    if (result.ok) {
      setSaved(true)
      if (resetOnSuccess) setName("")
      return
    }
    setRefusal(result.message ?? "the change was refused")
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <div className="flex w-full flex-col gap-1 sm:w-72">
        <Label htmlFor={`group-name-${selfId ?? "new"}`}>{label}</Label>
        <Input
          id={`group-name-${selfId ?? "new"}`}
          value={name}
          // The raw text is what is kept and what is sent: nothing here
          // trims, lowercases or otherwise rewrites what was typed.
          onChange={(e) => {
            setName(e.target.value)
            setRefusal(null)
            setSaved(false)
          }}
          placeholder="Key accounts"
          aria-invalid={refusal !== null}
          aria-describedby={`group-name-note-${selfId ?? "new"}`}
        />
      </div>
      <Button type="submit" size="sm" disabled={blank || busy}>
        {submitLabel}
      </Button>
      {/* One region for all three answers, so a refusal replaces a warning
          rather than stacking under it, and every answer is announced. */}
      <p
        id={`group-name-note-${selfId ?? "new"}`}
        role="status"
        className={`w-full text-xs ${refusal !== null ? "text-destructive" : "text-muted-foreground"}`}
      >
        {refusal ?? warning ?? (saved ? "Saved." : "")}
      </p>
    </form>
  )
}
