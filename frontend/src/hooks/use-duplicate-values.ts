"use client"

// The values Duplicate starts the create form with: the editable fields the
// backend publishes, read from one existing organization. Never the id, the
// bookkeeping columns or a mock field, nor the import identity and the record
// number, which belong to one record alone. A demo organization is not in the
// backend, so it is refused before any request.

import { useEffect, useState } from "react"

import { apiFetch, recordApiPath, relationMeta, requestFailure, type Row } from "@/lib/cube"
import { duplicateValuesOf } from "@/lib/kit-form"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import { demoOrganizationOf } from "@/mock/organizations"

const NOT_COPIED = new Set(["externalId", "organizationNo"])
const DEMO_REFUSAL = "Demo records are read-only"

type DuplicateValues = { values: Record<string, string> | null; error: string | null }

async function duplicateValuesFor(id: string): Promise<Record<string, string>> {
  const path = recordApiPath(ORGANIZATIONS_CUBE, id)
  if (!path) throw new Error("Unknown organization")
  // The published metadata alone (relationMeta): no mock field in it.
  const [meta, response] = await Promise.all([relationMeta(ORGANIZATIONS_CUBE), apiFetch(path)])
  if (!meta) throw new Error("metadata request failed")
  if (!response.ok) throw await requestFailure("organization", response)
  return duplicateValuesOf(meta.fields, (await response.json()) as Row, NOT_COPIED)
}

export function useDuplicateValues(id: string): DuplicateValues {
  const demo = demoOrganizationOf(ORGANIZATIONS_CUBE, id) !== undefined
  const [state, setState] = useState<DuplicateValues>({ values: null, error: null })

  useEffect(() => {
    if (demo) return
    let alive = true
    duplicateValuesFor(id).then(
      (values) => alive && setState({ values, error: null }),
      (e: unknown) => alive && setState({ values: null, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
  }, [id, demo])

  return demo ? { values: null, error: DEMO_REFUSAL } : state
}
