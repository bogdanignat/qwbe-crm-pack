// The pure half of one import row: a JSONL line and the mapping file decide what the row loop
// does with it. No I/O and no tally here: the loop (vtiger-map-rows.ts) counts, this decides.
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { externalKey, mapRow } from "./vtiger-map-lib.ts"
import { type MapFile, orgKeyOf, Row } from "./vtiger-map-pure.ts"

export type RowPlan =
  | { readonly _tag: "Blank" }
  | { readonly _tag: "Broken" }
  | { readonly _tag: "Skipped"; readonly counter: "skippedNoKey" | "skipped" }
  | {
    readonly _tag: "Write"
    readonly externalId: string
    readonly payload: Record<string, unknown>
    /** Contacts only: the vtiger organization the row points at (none = no organization). */
    readonly orgKey?: Option.Option<string>
  }

const named = (payload: Record<string, unknown>) =>
  payload.name !== null && payload.name !== undefined && payload.name !== ""

export const planRow = (line: string, m: MapFile): RowPlan => {
  if (line.trim() === "") return { _tag: "Blank" }
  const row = Schema.decodeUnknownOption(Row)(line)
  if (Option.isNone(row)) return { _tag: "Broken" }
  // A row without its key can never carry an externalId: POSTing it would duplicate it
  // on every rerun (the unique index only guards rows that HAVE their identity).
  const externalId = externalKey(row.value, m)
  if (externalId === null) return { _tag: "Skipped", counter: "skippedNoKey" }
  const mapped = mapRow(row.value, m)
  if (Either.isLeft(mapped) || !named(mapped.right)) return { _tag: "Skipped", counter: "skipped" }
  return m.entity === "contacts"
    ? { _tag: "Write", externalId, payload: mapped.right, orgKey: orgKeyOf(row.value, m.accountKey) }
    : { _tag: "Write", externalId, payload: mapped.right }
}
