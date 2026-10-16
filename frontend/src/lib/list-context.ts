// The list a detail page was opened from, for vtiger's previous / next record
// arrows: the ids of the page in view, in its order, per cube, kept in this
// tab's sessionStorage. Opened from anywhere else, the detail has no arrows.

export const listContextKey = (cube: string) => `crm.listContext.${cube}`

export function writeListContext(cube: string, ids: readonly string[], storage: Storage | undefined = globalThis.sessionStorage): void {
  try {
    storage?.setItem(listContextKey(cube), JSON.stringify(ids))
  } catch {
    // Storage blocked: the detail simply shows no arrows.
  }
}

export function parseListContext(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

export type Neighbors = { previous: string | null; next: string | null }

// null when the record is not in the list's page (no arrows at all).
export function neighborsOf(ids: readonly string[], id: string): Neighbors | null {
  const at = ids.indexOf(id)
  if (at === -1) return null
  return { previous: ids[at - 1] ?? null, next: ids[at + 1] ?? null }
}
