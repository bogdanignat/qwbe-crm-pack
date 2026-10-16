// A value shown as the link its format calls for (formatHrefOf in lib/cube.ts),
// as vtiger shows phones, emails and websites: a website opens in a new tab, a
// phone or an email in the system's own handler.
import type { FieldMetadata } from "@/lib/cube"

export function FormatLink({
  field,
  href,
  children,
}: {
  field: FieldMetadata
  href: string
  children: React.ReactNode
}) {
  const newTab = field.format === "url" ? { target: "_blank", rel: "noopener noreferrer" } : {}
  return (
    <a className="min-w-0 underline" href={href} {...newTab}>
      {children}
    </a>
  )
}
