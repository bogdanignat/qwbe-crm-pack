// One field's value as the detail pages show it: the text, linked to the
// target's page for a relation when this app has a route for it (Next's
// Link), a tel:/mailto:/http link for a formatted value, an IBAN in groups of
// four that never break inside a group, a dash when empty. Numbers, dates
// and codes are set in the mono font (lib/mono-value.ts).

import Link from "next/link"

import { formatHrefOf, hrefForRelation, type FieldMetadata, type Row } from "@/lib/cube"
import { ibanGroupsOf } from "@/lib/iban"
import { isMonoValue } from "@/lib/mono-value"
import { FormatLink } from "@/components/format-link"

export function FieldValue(props: { field: FieldMetadata; record: Row; text: string | null }) {
  const value = <PlainValue {...props} />
  return props.text !== null && isMonoValue(props.field, props.record[props.field.name]) ? (
    <span className="font-mono tabular-nums">{value}</span>
  ) : (
    value
  )
}

function PlainValue({ field, record, text }: { field: FieldMetadata; record: Row; text: string | null }) {
  if (text === null) return "—"
  const href = field.relation ? hrefForRelation(field.relation.target, String(record[field.name])) : null
  if (href) {
    return (
      <Link className="underline" href={href}>
        {text}
      </Link>
    )
  }
  if (field.format === "iban") {
    return ibanGroupsOf(text).map((group, i) => (
      <span key={i}>
        {i > 0 && " "}
        <span className="whitespace-nowrap">{group}</span>
      </span>
    ))
  }
  const external = formatHrefOf(field, record[field.name])
  return external ? (
    <FormatLink field={field} href={external}>
      {text}
    </FormatLink>
  ) : (
    text
  )
}
