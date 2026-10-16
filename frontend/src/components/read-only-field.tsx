// A field the form shows but cannot edit (a mock field the backend does not
// have yet): the input's shape, disabled, with the value it holds, if any.
// It is not part of the form, so it is never sent.

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { FieldMetadata } from "@/lib/cube"

export function ReadOnlyField({ field, text }: { field: FieldMetadata; text: string | null }) {
  if (field.type === "boolean") {
    return <Checkbox disabled checked={text === "yes"} aria-label={field.label} />
  }
  // h-9 rounded-md: the kit inputs' shape, so a row lines up with its neighbour.
  return <Input disabled readOnly value={text ?? ""} aria-label={field.label} className="h-9 rounded-md" />
}
