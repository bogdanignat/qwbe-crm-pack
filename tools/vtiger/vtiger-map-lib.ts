// Pure mapping: an exported vtiger
// row + a mapping file -> the payload for the qwbe cube API. No I/O, so the tests can run it
// on synthetic fixtures.
//
// Idempotency rule: the vtiger id (the mapping's `key` column, e.g. vtigerId) is the external
// key. It becomes the row's OWN identity -- `externalId: "vtiger:<crmid>"` -- stored in the
// cube and guarded by a UNIQUE index in the database (tools/db/ensure-external-id-index.ts).
// The map tool looks each row up through the generic list's `?externalId=` filter and POSTs
// only when it is missing; there is no ledger file left to lose or reconcile.

import * as Data from "effect/Data"
import * as Either from "effect/Either"
import * as Schema from "effect/Schema"

const Names = Schema.Array(Schema.String)

/** A mapping file: `key` names the external-id column, `map` the column -> field rules. Other
 *  keys of the file (entity, route, comment, dropped, ...) are ignored here. */
export const Mapping = Schema.Struct({
  key: Schema.String,
  map: Schema.Record({
    key: Schema.String,
    value: Schema.Union(Schema.String, Schema.Struct({ join: Schema.optional(Names) })),
  }),
  booleans: Schema.optional(Names),
  integers: Schema.optional(Names),
  emptyString: Schema.optional(Names),
})
export type Mapping = typeof Mapping.Type

/** A row that cannot be mapped; the message names the column, never its value. */
export class RowRejected extends Data.TaggedError("RowRejected")<{ readonly message: string }> {}

const emptyToNull = (v: unknown): unknown => (v === undefined || v === null || String(v).trim() === "" ? null : v)
const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "on" || v === "true"

/**
 * Build the create/patch payload for one exported row.
 * Mapping shapes:
 *   "vtigerCol": "qwbeField"                 -- straight copy (null for empty)
 *   "qwbeField": { "join": ["a", "b"] }      -- join non-empty parts with one space
 * `booleans` / `integers` coerce the varchar(3)-style vtiger flags and int columns.
 * `emptyString` lists qwbe fields that must stay a string even when vtiger is empty
 * (the contact cube's `email` is `""`, not null).
 * Returns the payload, or RowRejected (e.g. a non-integer in an integer column).
 */
export const mapRow = (
  row: Record<string, unknown>,
  mapping: Mapping,
): Either.Either<Record<string, unknown>, RowRejected> => {
  const booleans = new Set(mapping.booleans ?? [])
  const integers = new Set(mapping.integers ?? [])
  const emptyString = new Set(mapping.emptyString ?? [])
  const payload: Record<string, unknown> = {}
  for (const [src, dst] of Object.entries(mapping.map)) {
    if (typeof dst === "string") {
      let v: unknown = row[src]
      if (booleans.has(src)) v = truthy(v)
      else if (integers.has(src)) {
        v = v === null || v === undefined || v === "" ? null : Number(v)
        if (v !== null && !Number.isInteger(v)) return Either.left(new RowRejected({ message: `${src} is not an integer` }))
      } else v = emptyToNull(v)
      if (v === null && emptyString.has(dst)) v = ""
      payload[dst] = v
    } else if (dst.join !== undefined) {
      const joined = dst.join
        .map((part) => String(row[part] ?? "").trim())
        .filter((part) => part !== "")
        .join(" ")
      payload[src] = joined === "" ? null : joined
    }
  }
  return Either.right(payload)
}

/** The external key of a row (the mapping's `key` column), as a string, or null if absent. */
export const rowKey = (row: Record<string, unknown>, mapping: Mapping): string | null => {
  const v = row[mapping.key]
  return v === undefined || v === null ? null : String(v)
}

/** The external identity a row is stored under: "vtiger:<crmid>". One name for the source
 *  system and the source row, stable across runs -- this is what the unique index guards and
 *  what the rerun looks up. Null when the row has no external key at all. */
export const externalKey = (row: Record<string, unknown>, mapping: Mapping): string | null => {
  const key = rowKey(row, mapping)
  return key === null ? null : `vtiger:${key}`
}
