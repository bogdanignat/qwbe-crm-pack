"use client"

// vtiger's Save / Cancel, above and below the form. Cancel with unsaved
// changes asks first; the refusal of a failed save shows beside the buttons
// (announced once, from the top bar).

import { useFormState } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { LEAVE_PROMPT } from "@/hooks/use-unsaved-changes"

export function FormActions({
  pending,
  refusal,
  onCancel,
  announce,
}: {
  pending: boolean
  refusal: string | null
  onCancel: () => void
  announce: boolean
}) {
  const { isDirty } = useFormState()
  const cancel = () => {
    if (isDirty && !window.confirm(LEAVE_PROMPT)) return
    onCancel()
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {refusal && (
        <p role={announce ? "alert" : undefined} className="w-full text-center text-sm text-destructive">
          {refusal}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      <Button type="button" variant="outline" disabled={pending} onClick={cancel}>
        Cancel
      </Button>
    </div>
  )
}
