"use client"

// Duplicate (vtiger's prefilled EditView): the create form started from an
// existing organization's values (hooks/use-duplicate-values.ts).

import { CubeCreateForm } from "@/components/cube-create-form"
import { Skeleton } from "@/components/ui/skeleton"
import { useDuplicateValues } from "@/hooks/use-duplicate-values"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"

export function DuplicateOrganizationForm({ id, fields }: { id: string; fields: string[] }) {
  const { values, error } = useDuplicateValues(id)

  if (error) return <p role="alert">{error}</p>
  if (!values) return <Skeleton className="h-64 w-full max-w-2xl" />
  return <CubeCreateForm cube={ORGANIZATIONS_CUBE} fields={fields} initialValues={values} />
}
