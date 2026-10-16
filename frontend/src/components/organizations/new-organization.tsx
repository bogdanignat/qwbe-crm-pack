"use client"

// Creating an organization (vtiger's "Creating New Organization"), empty or
// started from an existing one (Duplicate, ?duplicate=<id>), in the shared
// organization form. Save POSTs through useCreateOrganization and opens the
// new record; Cancel goes back where the reader came from.

import { useMemo } from "react"
import { useRouter } from "next/navigation"

import { Skeleton } from "@/components/ui/skeleton"
import { useCreateOrganization } from "@/hooks/use-create-organization"
import { useCubeMetadata } from "@/hooks/use-cube-metadata"
import { useDuplicateValues } from "@/hooks/use-duplicate-values"
import { rowHref, type CubeMetadata } from "@/lib/cube"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import { CREATE_HINTS, editableFieldsOf, formBlocksOf, formDefaultsOf } from "@/lib/organization-form"
import { OrganizationForm } from "./organization-form"

export function NewOrganization({ duplicateOf }: { duplicateOf: string | null }) {
  const { meta, error } = useCubeMetadata(ORGANIZATIONS_CUBE)
  const duplicate = useDuplicateValues(duplicateOf)

  const loadError = error ?? duplicate.error
  if (loadError) return <p role="alert">{loadError}</p>
  if (!meta || !duplicate.values) return <Skeleton className="h-96 w-full" />
  return <CreateForm meta={meta} given={duplicate.values} duplicateOf={duplicateOf} />
}

function CreateForm({
  meta,
  given,
  duplicateOf,
}: {
  meta: CubeMetadata
  given: Record<string, string>
  duplicateOf: string | null
}) {
  const router = useRouter()
  const create = useCreateOrganization(meta.fields)
  const defaults = useMemo(() => formDefaultsOf(editableFieldsOf(formBlocksOf(meta.fields)), given), [meta, given])
  const back = (duplicateOf && rowHref(ORGANIZATIONS_CUBE, duplicateOf)) || "/organizations"

  return (
    <OrganizationForm
      fields={meta.fields}
      defaultValues={defaults}
      hints={CREATE_HINTS}
      onSubmit={create.submit}
      onCancel={() => router.push(back)}
      pending={create.pending}
      refusal={create.refusal}
      saved={create.created}
    />
  )
}
