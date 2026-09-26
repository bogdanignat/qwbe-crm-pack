// The Settings area: runtime custom fields and access groups are managed
// here, per entity, never on the lists. The cube selector addresses every cube this pack
// serves -- organizations, contacts and contracts -- whether or not the app has
// a list route for it, because definitions ride the customfields API, not the
// cube's own frontend.
//
// Middleware already guards the route with the session cookie; the panel
// additionally requires the customfields:write permission and says so.

"use client"

import { useState } from "react"

import { AccessGroupsPanel } from "@/components/access-groups-panel"
import { CustomFieldsPanel } from "@/components/custom-fields-panel"
import { QueryProvider } from "@/components/query-provider"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// The cubes the selector offers, with the names the customfields API knows
// them by (the full cube name, the same value seed-demo.mjs and the vtiger
// import address definitions with).
const CUBES = [
  { value: "crm/organizations", label: "Organizations" },
  { value: "crm/contacts", label: "Contacts" },
  { value: "crm/contracts", label: "Contracts" },
]

export default function SettingsPage() {
  const [cube, setCube] = useState(CUBES[0].value)
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="settings-entity">Entity</Label>
        <Select value={cube} onValueChange={setCube}>
          <SelectTrigger id="settings-entity" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUBES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* key remounts the panel on cube switch so no definition list, error
          or open delete confirmation of the previous cube survives (QWB-60). */}
      <CustomFieldsPanel key={cube} cube={cube} />
      <Separator />
      {/* The kernel's ACCESS groups (groups of user accounts) are administered
          here as a MIRROR of the host app's /permissions UI: the same
          permissions API, the same group ids, no store and no roles of this
          pack's own. Its scope selector is deliberately NOT the Entity selector
          above -- custom fields and access scopes are two different lists of
          cubes (docs/t1452-access-groups-report.md). Business sets of CONTACTS
          are a different thing entirely and live at /contact-groups. */}
      <QueryProvider>
        <AccessGroupsPanel />
      </QueryProvider>
    </main>
  )
}
