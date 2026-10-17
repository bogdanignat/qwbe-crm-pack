"use client"

// Creating one organization: POST the form's editable values (never a mock
// field) and open the new record. Every failure (a refusal, an unreachable
// server, an answer that cannot be read) ends with the form usable again and
// the refusal for the form to show (its per-field issues under the inputs).
// `created` turns the unsaved-changes prompt off for the way out.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiFetch, cubeApiPath, errorBody, errorMessage, rowHref, type FieldMetadata, type Row } from "@/lib/cube"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import type { Refusal } from "@/lib/kit-form"
import { createBodyOf, type FormValues } from "@/lib/organization-form"
import { fieldErrorsOf } from "@/lib/qwbe-data-provider"

// A 2xx without a readable id may still have created the record.
const UNCONFIRMED = "The save could not be confirmed. Check the organization list before trying again."

const unconfirmed: Refusal = { message: UNCONFIRMED, errors: {} }

async function postOrganization(body: Record<string, unknown>): Promise<{ id: string } | { refusal: Refusal }> {
  try {
    const response = await apiFetch(cubeApiPath(ORGANIZATIONS_CUBE), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const error = await errorBody(response)
      return { refusal: { message: errorMessage(error), errors: fieldErrorsOf(error) } }
    }
    const id = ((await response.json()) as Row | null)?.id
    return typeof id === "string" || typeof id === "number" ? { id: String(id) } : { refusal: unconfirmed }
  } catch {
    return { refusal: unconfirmed }
  }
}

export function useCreateOrganization(fields: readonly FieldMetadata[]) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [created, setCreated] = useState(false)

  async function submit(values: FormValues) {
    setRefusal(null)
    setPending(true)
    const result = await postOrganization(createBodyOf(fields, values))
    if ("refusal" in result) {
      setPending(false)
      setRefusal(result.refusal)
      return
    }
    setCreated(true)
    toast.success("Created")
    router.push(rowHref(ORGANIZATIONS_CUBE, result.id) ?? "/organizations")
  }

  return { submit, pending, refusal, created }
}
