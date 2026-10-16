// Schema & API panel (QWB-55): a collapsible section beneath a detail page
// that names the cube and the record and links to the three places the
// truth already lives -- the cube's published field metadata, the record's
// JSON, and the kernel's OpenAPI document. Nothing is copied here: no schema,
// no record body, so the page never carries a second version of either.
//
// Native details/summary: collapsed by default, keyboard-operable, and the
// summary is plain descriptive text, so a screen reader or a browser agent
// finds it without expanding anything. Every link goes through the
// same-origin /api/qwbe proxy, which adds the Bearer from the httpOnly
// session cookie server-side; no token ever reaches this markup.
//
// A developer's panel: shown to admins only (nothing while /auth/me is on its
// way or failed). The API keeps its own permissions; this only hides the links.
"use client"

import Link from "next/link"

import { useCurrentUser } from "@/hooks/use-current-user"
import { OPENAPI_API_PATH, metadataApiPath, recordApiPath } from "@/lib/cube"

export function SchemaApiPanel({ cube, id }: { cube: string; id: string }) {
  const { user } = useCurrentUser()
  if (!user?.admin) return null
  const record = recordApiPath(cube, id)
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Schema &amp; API: field metadata, record JSON and OpenAPI for this {cube} record
      </summary>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Cube</dt>
        <dd>
          <code>{cube}</code>
        </dd>
        <dt className="text-muted-foreground">Record id</dt>
        <dd>{id === "" ? "(empty)" : <code>{id}</code>}</dd>
        <dt className="text-muted-foreground">Field metadata (JSON)</dt>
        <dd>
          <Link className="underline" href={metadataApiPath(cube)}>
            Field metadata for {cube}
          </Link>
        </dd>
        <dt className="text-muted-foreground">Current record (JSON)</dt>
        <dd>
          {record ? (
            <Link className="underline" href={record}>
              Record JSON for {id}
            </Link>
          ) : (
            "no record id, no link"
          )}
        </dd>
        <dt className="text-muted-foreground">OpenAPI (JSON)</dt>
        <dd>
          <Link className="underline" href={OPENAPI_API_PATH}>
            Complete OpenAPI document, all cubes (no per-cube spec exists; look for the {cube}{" "}
            routes inside)
          </Link>
        </dd>
      </dl>
      <p className="mt-2 text-muted-foreground">
        Links open the authenticated proxy: the current session applies, no token is exposed.
      </p>
    </details>
  )
}
