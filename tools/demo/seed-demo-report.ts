// The lines the seed prints, free of I/O: counts per cube and per step, never a row value.

interface Wiped {
  readonly deleted: number
  readonly left: number
}

interface Ensured {
  readonly created: number
  readonly existing: number
}

export const wipeLines = (rows: ReadonlyArray<readonly [string, Wiped]>) =>
  rows.map(([cube, r]) => `wipe crm/${cube}: ${r.deleted} demo row(s) deleted, ${r.left} non-demo row(s) left untouched`)

export const defLines = (defs: ReadonlyArray<Ensured & { readonly cube: string }>) =>
  defs.map((d) => `defs ${d.cube}: ${d.created} created, ${d.existing} already defined`)

export const rowLines = (rows: Readonly<Record<string, Ensured>>) =>
  Object.entries(rows).map(([cube, r]) => `crm/${cube}: ${r.created} created, ${r.existing} already present`)

export const totalLines = (totals: ReadonlyArray<readonly [string, number]>) =>
  totals.map(([route, total]) => `total in cube ${route}: ${total}`)
