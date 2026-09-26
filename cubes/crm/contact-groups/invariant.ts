// THE DECLARED INVARIANT of crm/contact-groups, and nothing else: the schema it lives in, the two
// table names, the two index names and the index specs the manifest hands the kernel.
//
// WHY THIS IS ITS OWN FILE, AND WHY IT IS A LEAF. Two very different processes read this data:
//
//   * the kernel, which mounts the cube -- `manifest.uniqueIndexes` (index.ts) is this array, so
//     the kernel renders the DDL and the expected catalog definition from it and gates every write
//     on the result;
//   * the operator CLI (tools/ensure-contact-group-indexes.mjs), which runs with NO kernel in the
//     process, against a database, at the moment the invariant is broken.
//
// The second one is why there is no runtime import here. This module imports ONLY types
// (`import type`, erased outright by node's strip-only mode), so importing it pulls in no `effect`,
// no `qwbe-core` value module and no transitive graph at all. service.ts, which does import both,
// re-exports everything below for the cube's own use -- so there is still ONE statement of the
// invariant and the tool no longer needs the cube's runtime to read it.
//
// That is not a tidiness argument. The tool exists FOR the incident in which the index is missing,
// and it used to import service.ts: in an installed layout `qwbe-core` resolves inside
// `node_modules`, where node refuses to strip types from a `.ts` file (core/package.json
// `_exportsComment`), so the import itself failed -- the tool died exactly where it was needed.
//
// Changing anything in this file changes the index on every database. The index NAMES in
// particular are matcher keys: Postgres reports one as `constraint` on a 23505 and
// `onUniqueIndex` (service.ts) matches on that string, so they are system-wide unique and are
// never renamed casually.

import type { UniqueIndexSpec } from "qwbe-core/cube"

export const CUBE = "crm/contact-groups"
export const GROUPS = "contact_groups"
export const MEMBERS = "contact_group_members"

/** The kernel's rule, restated: a cube's Postgres schema is its name with `/` replaced by `--`
 *  (`schemaName`, core/src/pg-index/identifiers.ts). DERIVED rather than typed out, and never
 *  declared -- a cube that could name its schema could name another cube's. The kernel derives the
 *  same string for itself; this constant exists only for the operator CLI and the tests, which
 *  connect to the database directly and have no kernel to ask. */
export const SCHEMA = CUBE.replace(/\//g, "--")

export const NAME_INDEX = "contact_groups_name_key"
export const PAIR_INDEX = "contact_group_members_pair_key"

/**
 * THE DECLARED INVARIANT, and the only statement of it in this pack.
 *
 * Read by exactly two places: `manifest.uniqueIndexes` in index.ts, which is what makes the
 * kernel install and enforce it, and the operator CLI, which renders its DDL from these same
 * keys. There is no SQL here on purpose -- a cube may name a table it owns, an index name and the
 * body fields of the key, nothing else (core/src/pg-index/unique-index.ts).
 *
 * Both are PARTIAL on live rows (`rows: "active"` -> `WHERE deleted = false`): a soft-deleted
 * group frees its name, and a removed membership can be added again. That is a domain decision,
 * and it is the only predicate the contract has.
 *
 * `keys` ORDER is part of the index, and the case of each `body` field is part of it too --
 * `body->>'groupid'` is NULL on every row this cube writes, so an index built on that spelling
 * would enforce nothing.
 */
export const UNIQUE_INDEXES = [
  {
    table: GROUPS,
    index: NAME_INDEX,
    // `lower(btrim(...))` is the arbiter of "the same name": Postgres computes it, so Postgres
    // decides, and service.ts's `normalize` is only the friendly approximation.
    keys: [{ body: "name", normalize: "lower-btrim" }],
    rows: "active",
  },
  {
    table: MEMBERS,
    index: PAIR_INDEX,
    keys: [{ body: "groupId" }, { body: "contactId" }],
    rows: "active",
  },
] as const satisfies ReadonlyArray<UniqueIndexSpec>
