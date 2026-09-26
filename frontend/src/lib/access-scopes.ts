// The ACCESS SCOPES this pack may administer permission groups for: one cube
// per scope, read from the kernel's own live catalogue.
//
// Why a catalogue read and not a list in this file: the cubes a pack serves are
// decided at install time (a cube can be switched off, and a pack can ship one
// this frontend has never heard of), so a hardcoded list drifts the moment the
// installation changes. The catalogue is GET /settings/cubes -- the same
// endpoint and the same constant the /echo filter already reads
// (lib/echo.ts CUBES_PATH, settings:read, every signed-in role).
//
// The static list below is a FALLBACK for exactly one answer: 403 on the
// catalogue. It is never an auth bypass -- the group list of every scope is
// still judged by the kernel per request (a scope the caller may not administer
// answers 403 and the panel says so), and the operator is told the list of
// scopes is a fallback. Any other failure is a failure and is reported as one;
// it never silently becomes the static list.
//
// Nothing here is a permission decision. This module only answers "which cubes
// may be OFFERED in the scope selector".

import { apiFetch, errorBody, errorMessage } from "./cube.ts"
import { CUBES_PATH } from "./echo.ts"

// One entry of the scope selector: the cube name the permissions API knows
// (the full name, slash included -- the same value lib/sharing.ts sends) and
// the words the operator reads.
export type AccessScope = {
  cube: string
  label: string
}

// The catalogue row as received, narrowed to the three fields this module
// reads (qwbe core/src/http-contracts.ts CubeInfo).
export type CatalogueCube = {
  name: string
  enabled: boolean
  entity: string | null
}

export const ACCESS_SCOPE_PREFIX = "crm"

// The labels of the cubes this pack ships. A scope discovered in the catalogue
// that is not listed here still appears -- labelled by its published entity, or
// by its own leaf name -- because an unlabelled scope is better than a scope
// the operator cannot reach at all.
//
// `crm/contact-groups` is spelled out deliberately: its groups decide who may
// administer the contact-group RECORDS. It has nothing to do with which
// contacts belong to a contact group, which is business data managed at
// /contact-groups and never here.
const LABELS: Readonly<Record<string, string>> = {
  "crm/organizations": "Organizations",
  "crm/contacts": "Contacts",
  "crm/contracts": "Contracts",
  "crm/contact-groups": "Contact groups (access to the group records)",
}

// Cube-name order, the ONE order the selector is ever built in. Both sources
// (a live catalogue and the fallback list) go through this comparator, so the
// options never reorder themselves when the catalogue starts or stops
// answering -- an operator who learned the third option is Contracts must not
// find something else there after a 403.
function byCubeName(a: AccessScope, b: AccessScope): number {
  return a.cube.localeCompare(b.cube)
}

// The scopes offered when the catalogue itself refuses (403). Same cube names,
// same labels AND the same order a live answer would carry for these four, so
// the selector does not change shape between the two sources.
export const FALLBACK_ACCESS_SCOPES: ReadonlyArray<AccessScope> = Object.freeze(
  Object.keys(LABELS)
    .map((cube) => Object.freeze({ cube, label: LABELS[cube] as string }))
    .sort(byCubeName),
)

export const FALLBACK_NOTICE =
  "The cube catalogue refused this account, so this is the pack's built-in list of scopes, not the " +
  "installed one. A scope that is switched off, or one another pack added, is not shown. Access to " +
  "each scope is still decided by the server."

// `crm` itself and every cube under it. A cube whose name merely STARTS with
// the letters (`crm-legacy`) is not under it: the separator is the "/".
export function isAccessScope(name: string): boolean {
  return name === ACCESS_SCOPE_PREFIX || name.startsWith(`${ACCESS_SCOPE_PREFIX}/`)
}

// The last segment of a cube name, which is what a name with no label and no
// published entity is shown as.
function leafOf(cube: string): string {
  const cut = cube.lastIndexOf("/")
  return cut === -1 ? cube : cube.slice(cut + 1)
}

export function accessScopeLabel(cube: string, entity: string | null): string {
  return LABELS[cube] ?? (entity !== null && entity !== "" ? entity : leafOf(cube))
}

// Boundary check of the catalogue. A row of an unknown shape invalidates the
// WHOLE answer (null): a partially understood catalogue read as a scope list
// would silently hide scopes, and hiding a scope looks exactly like a scope
// that does not exist.
export function parseCubeCatalogue(raw: unknown): CatalogueCube[] | null {
  if (!Array.isArray(raw)) return null
  const rows: CatalogueCube[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null
    const row = item as Record<string, unknown>
    if (typeof row.name !== "string" || typeof row.enabled !== "boolean") return null
    if (!(row.entity === null || typeof row.entity === "string")) return null
    rows.push({ name: row.name, enabled: row.enabled, entity: row.entity })
  }
  return rows
}

// The scope list of a catalogue answer: this pack's cubes, ENABLED only (a
// disabled cube serves no routes, so its groups cannot be administered), in
// cube-name order so the selector does not reorder itself between reads.
export function accessScopesOf(rows: ReadonlyArray<CatalogueCube>): AccessScope[] {
  return rows
    .filter((row) => row.enabled && isAccessScope(row.name))
    .map((row) => ({ cube: row.name, label: accessScopeLabel(row.name, row.entity) }))
    .sort(byCubeName)
}

export type AccessScopeCatalogue = {
  scopes: ReadonlyArray<AccessScope>
  // Where the list came from, so the UI can say so instead of implying the
  // installed catalogue was read when it was not.
  source: "live" | "fallback"
  notice: string | null
}

// Reads the catalogue. Returns the live scopes, or the fallback list on a 403.
// THROWS on any other failure (network, 5xx, an unparseable body): the caller
// renders that as an error, because a scope list nobody vouches for must not
// look like the installed one.
export async function fetchAccessScopes(doFetch: typeof fetch = apiFetch): Promise<AccessScopeCatalogue> {
  const response = await doFetch(CUBES_PATH)
  if (response.status === 403) {
    return { scopes: FALLBACK_ACCESS_SCOPES, source: "fallback", notice: FALLBACK_NOTICE }
  }
  if (!response.ok) throw new Error(errorMessage(await errorBody(response)))
  const rows = parseCubeCatalogue(await response.json().catch(() => null))
  if (rows === null) throw new Error("invalid cube catalogue")
  return { scopes: accessScopesOf(rows), source: "live", notice: null }
}
