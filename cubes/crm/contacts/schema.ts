// The Contact schemas, split out of index.ts to stay under the size cap
// (split the file, never raise the cap). Same domain, same decisions —
// see index.ts for the reasoning that surrounds these fields.

import { Record, Schema } from "effect"
import { EntityMeta } from "qwbe-core/entity"

// The one input field list: the row adds the entity meta, the create and the patch derive from it.
const fields = {
  name: Schema.String,
  email: Schema.String,
  /** The external identity of a row that came from (or is destined for) a source system:
   *  "vtiger:<crmid>" for the import. Null for rows created by hand.
   *  Uniqueness lives in the DATABASE: a partial unique index on this field (only live rows,
   *  only non-null values) is ensured by tools/db/ensure-external-id-index.ts -- a plugin cube
   *  cannot create it (the kernel's per-cube role holds DML only), so the pack's tool does,
   *  as the database user that owns the tables. */
  externalId: Schema.NullOr(Schema.String),
  /** Optional in practice, so nullable in the schema rather than absent from responses. */
  phone: Schema.NullOr(Schema.String),
  /** Free text on purpose -- the Organization lives in its own cube, not folded in here. */
  company: Schema.NullOr(Schema.String),
  /** The one truth of the contact-to-organization relation. Nullable, opaque, caller-set. */
  organizationId: Schema.NullOr(Schema.NonEmptyTrimmedString),
}

// Every field optional on create with a null default; the non-null ones are overridden below
// (the spread keeps each key in its declared position, so the encoded shape stays the same).
const nullDefaults = <F extends { readonly [key: string]: Schema.Schema.All }>(f: F) =>
  Record.map(f, (s) => Schema.optionalWith(s, { default: () => null })) as unknown as {
    readonly [K in keyof F]: Schema.optionalWith<F[K], { default: () => null }>
  }

// A stored row reads organizationId as any string: the non-empty rule guards writes only.
export const Contact = Schema.Struct({
  ...EntityMeta,
  ...fields,
  organizationId: Schema.NullOr(Schema.String),
}).annotations({ identifier: "Contact" })

/** The patch: a contact can move to another organization, or be unlinked (organizationId null). */
export const ContactPatch = Schema.partial(
  Schema.Struct({ ...fields, name: Schema.NonEmptyTrimmedString }),
).annotations({ identifier: "ContactPatch" })

export const ContactCreate = Schema.Struct({
  ...nullDefaults(fields),
  name: fields.name,
  email: Schema.optionalWith(fields.email, { default: () => "" }),
}).annotations({ identifier: "ContactCreate" })
