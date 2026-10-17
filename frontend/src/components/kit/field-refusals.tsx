"use client"

// Puts a refused save's per-field messages on the form's inputs (react-hook-
// form errors, each shown by its input), the first one focused, so the save
// lands on the field to fix. Applied once per refusal (a new object); an edit
// that passes the field's check clears its message. Inside a ra-core Form.

import { useEffect } from "react"
import { useFormContext } from "react-hook-form"

import type { FieldErrors } from "@/lib/kit-form"

export function FieldRefusals({ fieldErrors }: { fieldErrors: FieldErrors | undefined }) {
  const { setError } = useFormContext()
  useEffect(() => {
    if (!fieldErrors) return
    Object.entries(fieldErrors).forEach(([name, message], i) =>
      setError(name, { type: "server", message }, { shouldFocus: i === 0 }),
    )
  }, [fieldErrors, setError])
  return null
}
