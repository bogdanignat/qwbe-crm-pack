// Which columns a list shows, in which order. Three sources, the most specific
// wins: an applied saved view (or the reader's own pick in the column picker),
// then the caller's default set (the Organizations list starts from vtiger's
// "All" filter), then the metadata's own default (columnsFromFields). The
// Settings hide-list (lib/field-prefs) trims the defaults only.

import type { ColumnSpec } from "./cube.ts"

// Bookkeeping no reader picks as a column.
export const UNLISTED_COLUMNS: ReadonlySet<string> = new Set(["id", "type", "deleted"])

export function defaultColumnNamesOf(
  all: readonly ColumnSpec[],
  defaults: readonly string[] | undefined,
  hidden: readonly string[],
): string[] {
  const names = new Set(all.map((c) => c.field.name))
  const base = defaults ? defaults.filter((name) => names.has(name)) : all.filter((c) => c.visible).map((c) => c.field.name)
  return base.filter((name) => !hidden.includes(name))
}

export function columnsNamed(all: readonly ColumnSpec[], names: readonly string[]): ColumnSpec[] {
  const byName = new Map(all.map((c) => [c.field.name, c]))
  return names.flatMap((name) => byName.get(name) ?? [])
}

// The picker's list: the current columns first, in their order, then the rest
// by label. The unlisted bookkeeping never shows.
export function pickerColumnsOf(
  all: readonly ColumnSpec[],
  current: readonly string[],
  unlisted: ReadonlySet<string> = UNLISTED_COLUMNS,
): ColumnSpec[] {
  const rest = all
    .filter((c) => !current.includes(c.field.name) && !unlisted.has(c.field.name))
    .sort((a, b) => a.field.label.localeCompare(b.field.label))
  return [...columnsNamed(all, current), ...rest]
}

// A column switched on goes to the right end; the title column never goes.
export function toggledColumns(current: readonly string[], name: string, on: boolean, title: string | undefined): string[] {
  if (on) return current.includes(name) ? [...current] : [...current, name]
  return name === title ? [...current] : current.filter((n) => n !== name)
}

// The reader's pick, per cube, in this browser.
export const columnsKey = (cube: string) => `crm.listColumns.${cube}`

export function readColumnChoice(cube: string, storage: Storage | undefined = globalThis.localStorage): string[] | null {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(columnsKey(cube)) ?? "null")
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "string") ? parsed : null
  } catch {
    return null
  }
}

export function writeColumnChoice(cube: string, names: readonly string[] | null, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    if (names === null) storage?.removeItem(columnsKey(cube))
    else storage?.setItem(columnsKey(cube), JSON.stringify(names))
  } catch {
    // Storage full or blocked: the pick lasts for this page only.
  }
}
