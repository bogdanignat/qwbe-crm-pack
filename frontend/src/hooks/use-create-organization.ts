"use client"

// Creating one organization: POST the form's editable values (never a mock
// field) and open the new record. Every failure (a refusal, an unreachable
// server, an answer that cannot be read) ends with a message and the form
// usable again. `created` turns the unsaved-changes prompt off for the way out.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiFetch, cubeApiPath, errorBody, errorMessage, rowHref, type FieldMetadata, type Row } from "@/lib/cube"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import { createBodyOf, type FormValues } from "@/lib/organization-form"

// A 2xx without a readable id may still have created the record.
const UNCONFIRMED = "The save could not be confirmed. Check the organization list before trying again."

async function postOrganization(body: Record<string, unknown>): Promise<{ id: string } | { error: string }> {
  try {
    const response = await apiFetch(cubeApiPath(ORGANIZATIONS_CUBE), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) return { error: errorMessage(await errorBody(response)) }
    const id = ((await response.json()) as Row | null)?.id
    return typeof id === "string" || typeof id === "number" ? { id: String(id) } : { error: UNCONFIRMED }
  } catch {
    return { error: UNCONFIRMED }
  }
}

export function useCreateOrganization(fields: readonly FieldMetadata[]) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  async function submit(values: FormValues) {
    setRefusal(null)
    setPending(true)
    const result = await postOrganization(createBodyOf(fields, values))
    if ("error" in result) {
      setPending(false)
      setRefusal(result.error)
      return
    }
    setCreated(true)
    toast.success("Created")
    router.push(rowHref(ORGANIZATIONS_CUBE, result.id) ?? "/organizations")
  }

  return { submit, pending, refusal, created }
}
