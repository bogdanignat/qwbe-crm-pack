// The Settings area: runtime custom fields and permission groups are managed
// here, per entity, never on the lists. The cube selector addresses every cube this pack
// serves -- organizations, contacts and contracts -- whether or not the app has
// a list route for it, because definitions ride the customfields API, not the
// cube's own frontend.
//
// Middleware already guards the route with the session cookie; the panel
// additionally requires the customfields:write permission and says so.

"use client"

import { useState } from "react"

import { CustomFieldsPanel } from "@/components/custom-fields-panel"
import { GroupsPanel } from "@/components/groups-panel"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageMain } from "@/components/page-main"

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
    <PageMain>
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
      <GroupsPanel key={`groups:${cube}`} cube={cube} />
    </PageMain>
  )
}
