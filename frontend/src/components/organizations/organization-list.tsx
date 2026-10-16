"use client"

// The Organizations list (vtiger 5.4 ListView, spec §2.6): the generic cube
// list with vtiger's "All" columns plus CUI and Billing State, the quick
// search, the mass actions (all waiting for backend endpoints), a row menu
// whose Edit opens the detail page in edit mode, and the demo organizations
// read-only on top.

import { ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { CubeList } from "@/components/cube-list"
import { DisabledAction } from "@/components/disabled-action"
import { RowMenu, RowMenuLink, RowMenuUnavailable } from "@/components/list/row-menu"
import { rowHref, type Row } from "@/lib/cube"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import {
  ORGANIZATION_LIST_COLUMNS,
  ORGANIZATION_LIST_UNLISTED,
  ORGANIZATION_MASS_ACTIONS,
  organizationEditHref,
} from "@/lib/organization-list"
import { DEMO_ORGANIZATIONS } from "@/mock/organizations"

const NEEDS_BACKEND = "Needs backend"
const ORGANIZATIONS = { one: "organization", other: "organizations" }

const massActions = ORGANIZATION_MASS_ACTIONS.map((action) => (
  <DisabledAction key={action} size="sm" variant="outline" reason={NEEDS_BACKEND}>
    {action}
  </DisabledAction>
))

function organizationMenu(row: Row, demo: boolean) {
  const id = String(row.id)
  return (
    <RowMenu label={`Actions for ${String(row.name ?? id)}`}>
      <RowMenuLink href={rowHref(ORGANIZATIONS_CUBE, id) ?? "/organizations"}>
        <ExternalLinkIcon aria-hidden /> Open
      </RowMenuLink>
      {demo ? (
        <RowMenuUnavailable reason="Demo, read-only">
          <PencilIcon aria-hidden /> Edit
        </RowMenuUnavailable>
      ) : (
        <RowMenuLink href={organizationEditHref(id)}>
          <PencilIcon aria-hidden /> Edit
        </RowMenuLink>
      )}
      <RowMenuUnavailable reason={NEEDS_BACKEND}>
        <Trash2Icon aria-hidden /> Delete
      </RowMenuUnavailable>
    </RowMenu>
  )
}

export function OrganizationList() {
  return (
    <CubeList
      cube={ORGANIZATIONS_CUBE}
      createHref="/organizations/new"
      addLabel="New Organization"
      emptyMessage="No organizations yet."
      noun={ORGANIZATIONS}
      demoRows={DEMO_ORGANIZATIONS}
      defaultColumns={ORGANIZATION_LIST_COLUMNS}
      unlistedColumns={ORGANIZATION_LIST_UNLISTED}
      searchPlaceholder="Name or industry starts with…"
      massActions={massActions}
      rowMenu={organizationMenu}
    />
  )
}
