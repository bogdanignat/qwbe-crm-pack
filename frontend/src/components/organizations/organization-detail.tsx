"use client"

// One organization as vtiger 5.4 shows it (spec §3, built in T-1814): the
// header, then two tabs. "Organization Information" holds the collapsible
// blocks beside the Actions box and the activity feed; "More Information" the
// related lists (Contacts only, for now) and Sharing. The active tab lives in
// the URL. Edit all swaps the first tab for the shared organization form
// (spec §4.5), full width, as vtiger's edit view drops the sidebar.
//
// The row comes through the ra-core data provider (a demo organization from
// the mock, never from qwbe), the metadata with the mock fields merged under
// it; the layout is lib/organization-layout.ts. A demo record is read-only.

import { useCallback, useMemo } from "react"
import { useGetOne } from "ra-core"

import { ActivityFeed } from "@/components/activity-feed"
import { ActivityPreview } from "@/components/activity-preview"
import { SharingPanel } from "@/components/sharing-panel"
import { SharingPreview } from "@/components/sharing-preview"
import { Skeleton } from "@/components/ui/skeleton"
import { useCubeMetadata } from "@/hooks/use-cube-metadata"
import { useEditOnOpen } from "@/hooks/use-edit-on-open"
import { useInPlaceEdit } from "@/hooks/use-in-place-edit"
import { useListNeighbors } from "@/hooks/use-list-neighbors"
import { useRelationTitles } from "@/hooks/use-relation-titles"
import { useUrlTab } from "@/hooks/use-url-tab"
import { canEdit, rowHref, type FieldMetadata, type Row } from "@/lib/cube"
import { fieldBlocksOf } from "@/lib/field-blocks"
import { displayRowOf } from "@/lib/kit-form"
import { ORGANIZATIONS_CUBE } from "@/lib/organization-display"
import { ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN } from "@/lib/organization-layout"
import { relationRefsOf } from "@/lib/relation-batch"
import { ActionsSidebar } from "./actions-sidebar"
import { OrganizationForm } from "./organization-form"
import { OrganizationHeader } from "./organization-header"
import { OrganizationInfo } from "./organization-info"
import { ORGANIZATION_TABS, OrganizationTabs } from "./organization-tabs"
import { RelatedContacts } from "./related-contacts"

export function OrganizationDetail({ id, demo }: { id: string; demo: boolean }) {
  const { meta, error: metaError } = useCubeMetadata(ORGANIZATIONS_CUBE)
  const { data, error: rowError } = useGetOne(ORGANIZATIONS_CUBE, { id })
  const row = data as Row | undefined
  const [tab, setTab] = useUrlTab(ORGANIZATION_TABS)

  const blocks = useMemo(
    () => (meta ? fieldBlocksOf(meta.fields, ORGANIZATION_BLOCKS, ORGANIZATION_HIDDEN) : []),
    [meta],
  )
  const flatRow = useMemo(() => (meta && row ? displayRowOf(meta, row) : null), [meta, row])
  const editable = (field: FieldMetadata) => !demo && canEdit(field)
  const editableFields = useMemo(
    () => (demo ? [] : blocks.flatMap((b) => b.rows.flat()).filter((f): f is FieldMetadata => f !== null && canEdit(f))),
    [blocks, demo],
  )
  const edit = useInPlaceEdit({ cube: ORGANIZATIONS_CUBE, id, row, flatRow, editableFields })

  // Relation titles (a runtime custom relation field) resolve in one batch, as in the list.
  const relationRefs = useMemo(() => (meta && row ? relationRefsOf([row], meta.fields) : []), [meta, row])
  const resolveTitle = useRelationTitles(relationRefs)

  const neighbors = useListNeighbors(ORGANIZATIONS_CUBE, id)
  const hrefOf = (other: string | null) => (other ? rowHref(ORGANIZATIONS_CUBE, other) : null)
  const { open: openEdit } = edit
  const openAll = useCallback(() => {
    setTab("info")
    openEdit("all")
  }, [setTab, openEdit])
  // "Edit" from a list row: the draft opens once the record is here.
  useEditOnOpen(Boolean(row && flatRow), editableFields.length > 0, openAll)

  const error = metaError ?? (rowError ? (rowError as Error).message : null)
  if (error) return <p role="alert">{error}</p>
  if (!row || !flatRow) return <Skeleton className="h-96 w-full" />

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <OrganizationHeader
        row={row}
        demo={demo}
        onEdit={edit.editing === null && editableFields.length > 0 ? openAll : undefined}
        duplicateHref={`/organizations/new?duplicate=${encodeURIComponent(id)}`}
        nav={neighbors && { previousHref: hrefOf(neighbors.previous), nextHref: hrefOf(neighbors.next) }}
      />
      <OrganizationTabs
        tab={tab}
        onTabChange={setTab}
        locked={edit.editing !== null}
        info={
          meta && edit.editing === "all" ? (
            <OrganizationForm
              fields={meta.fields}
              defaultValues={edit.initial}
              record={flatRow}
              onSubmit={edit.onSubmit}
              onCancel={edit.cancel}
              pending={edit.isPending}
              refusal={edit.refusal}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
              <OrganizationInfo
                blocks={blocks}
                record={flatRow}
                edit={edit}
                editable={editable}
                resolveTitle={resolveTitle}
              />
              <aside className="flex min-w-0 flex-col gap-4" aria-label="Actions and activity">
                <ActionsSidebar row={row} />
                {/* qwbe has no history for a demo id: a read-only preview instead. */}
                {demo ? (
                  <ActivityPreview reason="Activity is available on real organizations." />
                ) : (
                  <ActivityFeed cube={ORGANIZATIONS_CUBE} entityId={id} />
                )}
              </aside>
            </div>
          )
        }
        more={
          <div className="flex flex-col gap-4">
            <RelatedContacts organizationId={id} demo={demo} />
            {/* qwbe has no grants for a demo id: a read-only preview instead. */}
            {demo ? (
              <SharingPreview reason="Sharing is available on real organizations." />
            ) : (
              <SharingPanel cube={ORGANIZATIONS_CUBE} entityType="Organization" id={id} />
            )}
          </div>
        }
      />
    </div>
  )
}
