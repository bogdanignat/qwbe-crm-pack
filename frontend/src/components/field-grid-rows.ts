// One explicit grid row per field of a two-column section, at the @2xl
// layout (field-grid.tsx). Tailwind only generates class names it finds
// written out in full, so the counts are listed, not built; a longer run of
// rows continues in a new section (gridSectionsOf).

const GRID_ROWS = [
  "@2xl:grid-rows-[repeat(1,auto)]",
  "@2xl:grid-rows-[repeat(2,auto)]",
  "@2xl:grid-rows-[repeat(3,auto)]",
  "@2xl:grid-rows-[repeat(4,auto)]",
  "@2xl:grid-rows-[repeat(5,auto)]",
  "@2xl:grid-rows-[repeat(6,auto)]",
  "@2xl:grid-rows-[repeat(7,auto)]",
  "@2xl:grid-rows-[repeat(8,auto)]",
  "@2xl:grid-rows-[repeat(9,auto)]",
  "@2xl:grid-rows-[repeat(10,auto)]",
  "@2xl:grid-rows-[repeat(11,auto)]",
  "@2xl:grid-rows-[repeat(12,auto)]",
  "@2xl:grid-rows-[repeat(13,auto)]",
  "@2xl:grid-rows-[repeat(14,auto)]",
  "@2xl:grid-rows-[repeat(15,auto)]",
  "@2xl:grid-rows-[repeat(16,auto)]",
  "@2xl:grid-rows-[repeat(17,auto)]",
  "@2xl:grid-rows-[repeat(18,auto)]",
  "@2xl:grid-rows-[repeat(19,auto)]",
  "@2xl:grid-rows-[repeat(20,auto)]",
  "@2xl:grid-rows-[repeat(21,auto)]",
  "@2xl:grid-rows-[repeat(22,auto)]",
  "@2xl:grid-rows-[repeat(23,auto)]",
  "@2xl:grid-rows-[repeat(24,auto)]",
] as const

export const MAX_GRID_ROWS = GRID_ROWS.length

export function gridRowsClassOf(rows: number): string {
  return GRID_ROWS[Math.min(Math.max(rows, 1), MAX_GRID_ROWS) - 1]
}
