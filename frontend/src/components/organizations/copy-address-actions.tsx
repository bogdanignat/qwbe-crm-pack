"use client"

// vtiger's address copy in the Address block's header: billing to shipping,
// or back (lib/organization-form.ts). A copy whose target fields cannot be
// edited yet (the shipping fields are mock) is shown, disabled, with why.

import { useFormContext } from "react-hook-form"
import { CopyIcon } from "lucide-react"

import { DisabledAction } from "@/components/disabled-action"
import { Button } from "@/components/ui/button"
import type { FieldMetadata } from "@/lib/cube"
import { canCopyAddress, copiedAddress, type CopyDirection, type FormValues } from "@/lib/organization-form"

const COPIES: { direction: CopyDirection; label: string }[] = [
  { direction: "billingToShipping", label: "Copy billing to shipping" },
  { direction: "shippingToBilling", label: "Copy shipping to billing" },
]

export function CopyAddressActions({ fields }: { fields: readonly FieldMetadata[] }) {
  const { getValues, setValue } = useFormContext<FormValues>()
  const copy = (direction: CopyDirection) => {
    for (const [name, value] of Object.entries(copiedAddress(getValues(), direction))) {
      setValue(name, value, { shouldDirty: true, shouldValidate: true })
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {COPIES.map(({ direction, label }) =>
        canCopyAddress(fields, direction) ? (
          <Button key={direction} type="button" size="sm" variant="outline" onClick={() => copy(direction)}>
            <CopyIcon aria-hidden /> {label}
          </Button>
        ) : (
          <DisabledAction key={direction} size="sm" variant="outline">
            <CopyIcon aria-hidden /> {label}
          </DisabledAction>
        ),
      )}
    </div>
  )
}
