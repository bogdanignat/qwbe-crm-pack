// The contact-group schemas, split out of index.ts the way the contacts cube splits its own
// (split the file, never raise the cap). See index.ts for the reasoning around these fields.

import { Schema } from "effect"
import { EntityMeta } from "qwbe-core/entity"

export const ContactGroup = Schema.Struct({
  ...EntityMeta,
  /** The DISPLAY name, stored exactly as submitted: casing and surrounding space are the
   *  caller's, and this cube does not rewrite them. */
  name: Schema.String,
  /** `lower(btrim(name))` — the key uniqueness is decided on. Derived on every write and never
   *  accepted from a payload (the create/rename payloads below declare only `name`, and the
   *  kernel folds undeclared keys into `custom`, so it cannot be smuggled in flat).
   *
   *  It is published because a UI that must warn "that name is taken" needs the same key the
   *  server compares. It is NOT what the database enforces: the unique index is built on the
   *  SQL expression over `name`, so a drifted value here costs a nicer error message, never
   *  the invariant (see service.ts). */
  normalizedName: Schema.String,
}).annotations({ identifier: "ContactGroup" })

/** One membership. Auxiliary by design: the `type` is NOT this cube's declared entity, so the
 *  kernel's activity capture never records these rows (capturesType, core/src/pg/store.ts). */
export const ContactGroupMember = Schema.Struct({
  ...EntityMeta,
  groupId: Schema.String,
  /** A `crm/contacts` row id. Opaque here — this cube stores it and never reads that cube. */
  contactId: Schema.String,
}).annotations({ identifier: "ContactGroupMember" })

/** Blankness is refused in the handler, not here: `Schema.String` keeps the 400 a domain answer
 *  ("a group name cannot be blank") instead of a schema dump, and keeps create and rename saying
 *  exactly the same thing. */
export const ContactGroupCreate = Schema.Struct({ name: Schema.String }).annotations({
  identifier: "ContactGroupCreate",
})

export const ContactGroupRename = Schema.Struct({ name: Schema.String }).annotations({
  identifier: "ContactGroupRename",
})

/** Add and remove take the same reference; ids carry no space, so trimmed-and-non-empty is the
 *  honest shape check — and it is the ONLY check possible today (see index.ts, seam A). */
export const MemberRef = Schema.Struct({ contactId: Schema.NonEmptyTrimmedString }).annotations({
  identifier: "MemberRef",
})

/** What removal answers: the membership row that was retired, so a caller can log the exact row
 *  it affected rather than infer it. */
export const MemberRemoved = Schema.Struct({ removed: Schema.String }).annotations({
  identifier: "MemberRemoved",
})
