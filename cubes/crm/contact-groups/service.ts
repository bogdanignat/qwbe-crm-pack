// The contact-group RULES: the domain rules, and the two mappings from "the index refused this
// write" to what the cube says about it. Split out of index.ts so the cube file stays a manifest
// and a wiring diagram; the rules live here, where the tests can reach them. The DECLARATION they
// are about -- the two unique index specs -- is one file further out, in invariant.ts, and is
// re-exported below so a cube file still has one import for "our invariant".
//
// WHAT USED TO BE HERE, AND WHY IT IS GONE. This file once carried the whole mechanism: a
// hand-written `UniqueSpec` pair with the expected `pg_get_indexdef` string written out by hand, a
// `normalizeIndexDef` of its own, a `pg_indexes` probe run through the `usesBatch` raw-SQL
// privilege before every write, and a `warmTables` call on the read path to break the fresh-install
// deadlock. The kernel now owns all of it (`manifest.uniqueIndexes`,
// core/src/pg-index/unique-index.ts): a cube DECLARES the invariant, the kernel renders both SQL
// strings from that declaration, installs the index as the table's owner on first touch of the
// table, and re-reads the catalog before every write through the store's own gate -- including
// `indisvalid`, which the old `pg_indexes` probe here could not see at all.
//
// So the declaration in invariant.ts is the ONLY statement of the invariant in this pack, and
// there is no second copy of its SQL anywhere. `usesBatch` went with the probe: the kernel
// REFUSES a mount that declares both (`uniqueIndexReasons`), because the raw batch path calls neither
// `ensureTable` nor the write gate and would write straight around the guarantee.
//
// WHAT IS STILL OURS. The operator CLI (tools/db/ensure-contact-group-indexes.ts) stays, and it is
// not a duplicate of the kernel: the kernel's installer is memoized per table per database and
// swallows a failure per index, so a table whose live rows already duplicate the key mounts with
// reads working and writes refused, and NOTHING installs the index afterwards until the process
// restarts. The CLI is the only thing that closes that state on a running system -- transactionally,
// behind SHARE ROW EXCLUSIVE, after re-counting the duplicates inside the lock. It reads the
// declaration in invariant.ts -- the same array the manifest hands the kernel -- and never
// re-states it. That declaration sits in its own leaf, not here, because the tool must import it
// with no `effect` and no `qwbe-core` runtime in the process; see invariant.ts.

import { Effect } from "effect"
import { BadRequest, type UniqueIndexRefusal, onUniqueIndex } from "qwbe-core/errors"
import type { PageRequest } from "qwbe-core/pagination"
import { NAME_INDEX, PAIR_INDEX } from "./invariant.ts"

/**
 * The invariant is DECLARED next door, in a leaf that imports nothing at runtime, and re-exported
 * here so the cube keeps one import for "its rules". The split is not cosmetic: the operator CLI
 * reads `invariant.ts` directly and must run with no kernel and no `effect` in the process (see
 * that file's header), while this module deliberately depends on both.
 */
export { CUBE, GROUPS, MEMBERS, NAME_INDEX, PAIR_INDEX, SCHEMA, UNIQUE_INDEXES } from "./invariant.ts"

export const GROUP_ENTITY = "ContactGroup"
/** NOT the declared entity, on purpose: the kernel captures activity only for rows whose type
 *  equals the manifest's `entity` (capturesType, core/src/pg/store.ts), so membership rows stay
 *  out of the activity log. A membership is a fact about two entities, not an entity. */
export const MEMBER_TYPE = "ContactGroupMember"

// --- the domain rules --------------------------------------------------------------------

/** The uniqueness key. `lower(btrim(...))` is Postgres's, and Postgres is the arbiter; this is
 *  the JavaScript approximation used for the friendly pre-check only. They disagree on a few
 *  exotic spaces, which is precisely why the database also holds the index: when the two
 *  disagree, the write is refused by the index and answered as a 409, never let through. */
export const normalize = (name: string): string => name.trim().toLowerCase()

/** Blank is not a name. Checked here rather than in the schema so create and rename give the same
 *  domain sentence instead of a decoder dump. */
export const requireName = (name: string): Effect.Effect<string, BadRequest, never> =>
  normalize(name) === ""
    ? Effect.fail(new BadRequest({ message: "a contact group name cannot be blank" }))
    : Effect.succeed(name)

/**
 * Ordering for the MEMBER list, and the reason it is not the caller's to choose freely.
 *
 * The manifest's `sortable` fields belong to the GROUP row (`name`, `createdAt`). A membership row
 * has no `name`, and `orderClause` (core/src/pg/rows.ts:104-116) turns a sortable-but-absent field
 * into `ORDER BY body -> 'name'`, i.e. NULL for every single row: Postgres is then free to return
 * them in any order it likes, so `?sort=name` paged a member list with rows repeating and rows
 * missing. A real defect, not a cosmetic one.
 *
 * So only fields a membership row actually HAS are honoured, and the default is `id`, not
 * `createdAt`: ids are unique, timestamps are not (a batch of members added in the same
 * transaction shares `created_at` to the microsecond) and the store exposes no secondary sort key,
 * so `id` is the only tie-breaker reachable from a cube -- and the only ordering under which
 * paging cannot repeat or drop a row. Ids are random (`newId`), so this is a STABLE order, not a
 * chronological one; `createdAt` remains available for the chronological view, with the tie
 * documented. Anything else asked for is ignored, and the page's `sortedBy` says which one was
 * really used, so the UI never has to guess.
 */
export const MEMBER_SORTS: ReadonlySet<string> = new Set(["createdAt", "id"])

export const memberPageRequest = (asked: PageRequest): PageRequest => ({
  ...asked,
  sortBy: asked.sortBy !== undefined && MEMBER_SORTS.has(asked.sortBy) ? asked.sortBy : "id",
})

// --- what the cube says when the index refuses a write -----------------------------------

/**
 * Carries the kernel's reason AND its tagged refusal out of `onUniqueIndex`'s error channel and no
 * further. Private: a caller of `onNameTaken` / `onPairTaken` sees the two as arguments, never this
 * class.
 *
 * Plain fields assigned in the body -- `constructor(readonly reason: string)` is a TypeScript
 * parameter property and node's strip-only mode, which is how the kernel RUNS a cube, refuses it
 * outright. `tsc --noEmit` accepts it, so the failure would only appear at boot.
 */
class IndexRefused {
  readonly reason: string
  readonly refusal: UniqueIndexRefusal
  constructor(reason: string, refusal: UniqueIndexRefusal) {
    this.reason = reason
    this.refusal = refusal
  }
}

/**
 * ONE seam for both indexes: the named index refused this write, and the REASON is handed to a
 * recovery that re-reads the database before it says anything.
 *
 * `onUniqueIndex` (qwbe-core/errors) is the kernel's public mapping and the only storage condition
 * a cube may read. It matches TWO things on the named index and nothing else: the driver's 23505
 * carrying that index as its constraint, and the write gate's `UniqueIndexNotReady` for that same
 * index. Everything else re-dies unchanged -- INCLUDING a 23505 from another constraint, which a
 * cube that swallowed it would report as its own conflict when it is a system fault.
 *
 * WHAT THE RECOVERY IS TOLD, and why it is a TAG and not only prose. The two matched conditions
 * are not variations of one situation:
 *
 *   * `duplicate` -- the index DID enforce, and the server rejected this row because a live one
 *     holds the key. The invariant is intact and the caller simply lost a race. That is a 409 for
 *     a name and an idempotent success for a membership.
 *   * `notReady` -- the write GATE refused before the statement ran: the index is absent, carries a
 *     different definition or is marked invalid. NOTHING holds the key, nothing is enforcing it,
 *     every writer is refused, and the answer is a DEFECT (500, no details) plus a log line naming
 *     the index and the tool that inspects it. Answering 409 here would tell the user "someone else
 *     has that name" when nobody has it and no name is available at all -- a false sentence, and
 *     the operator would never see the incident.
 *
 * WHY NOT DERIVE IT FROM A RE-READ. This seam used to hand the recovery only the kernel's sentence,
 * so each caller re-read its own denormalized key and treated "a live row is there" as duplicate
 * and "no row" as a shut gate. That derivation is wrong wherever Postgres's `lower(btrim(...))` and
 * this file's `normalize` disagree -- measured on PostgreSQL 16.14 / en_US.utf8, `lower('ΟΔΟΣ')` is
 * `οδοσ` (U+03C3) while JavaScript gives `οδος` (U+03C2, final sigma) -- and it is wrong in the
 * expensive direction: a REAL duplicate, refused by a perfectly healthy index, came back as a 500
 * plus an operator alarm about a missing index. The kernel already knows which condition it saw;
 * `UniqueIndexRefusal` (qwbe-core/errors) is that knowledge, so the recovery branches on the tag
 * and re-reads only for what a re-read can actually answer (WHICH row won, for idempotence).
 */
const onIndexRefusal =
  (index: string) =>
  <A2, E2>(recover: (reason: string, refusal: UniqueIndexRefusal) => Effect.Effect<A2, E2, never>) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<A | A2, E | E2, never> =>
    effect.pipe(
      onUniqueIndex(index, (reason, refusal) => new IndexRefused(reason, refusal)),
      // The sentinel and NOTHING else: a typed failure of the write itself travels on untouched,
      // or a 409 raised elsewhere in the handler would come back out of here as a refusal.
      Effect.catchAll(
        (error): Effect.Effect<A2, E | E2, never> =>
          error instanceof IndexRefused ? recover(error.reason, error.refusal) : Effect.fail(error),
      ),
    )

/**
 * The NAME index refused this write. `duplicate` is the 409 the pre-check would have given had it
 * seen the clash in time -- unconditionally, because the index is the arbiter and it has spoken.
 * `notReady` is the operator's defect (see `indexNotReady`).
 */
export const onNameTaken = onIndexRefusal(NAME_INDEX)

/**
 * The membership PAIR index refused this write. A duplicate is NOT a conflict here: it means
 * another caller added the same contact to the same group first, so this caller's intent is
 * already satisfied, and the recovery re-reads the live pair to RETURN it -- that is what keeps
 * "adding twice is idempotent" true under a race and not merely in sequence. `notReady` is the
 * operator's defect and never a made-up success.
 */
export const onPairTaken = onIndexRefusal(PAIR_INDEX)

/**
 * The operator's sentence for the `notReady` refusal, built in ONE place so both handlers say the
 * same thing. It never reaches an HTTP body: the caller gets a 500 with no details (the kernel
 * answers a defect that way, core/src/kernel/install-parts.ts), and this text goes to the log,
 * where the index name and the command that inspects it belong.
 *
 * It is now allowed to be DEFINITE about the three states, because the tag it is built from says
 * the gate refused before the statement ran: the index is absent, carries a different definition or
 * is invalid. It no longer has to hedge about a lost race -- a lost race is `duplicate` and never
 * arrives here. The kernel's own `reason` is carried along verbatim; it is the generic,
 * name-flavoured sentence `onUniqueIndex` gives every index, which is why the tool below, not the
 * sentence, is what settles which of the three it was.
 */
export const indexNotReady = (index: string, what: string, reason: string): Error =>
  new Error(
    `${index} refused ${what}: the kernel's write gate refused before the statement ran, so the ` +
      `index is absent, carries a different definition or is invalid, and NOTHING is enforcing ` +
      `this invariant (kernel reason: ${reason}). ` +
      `Check it with node tools/db/ensure-contact-group-indexes.ts`,
  )

/**
 * The other end of the pair path: the index DID enforce, the write lost a race, and the row that
 * won it was gone by the time the recovery looked (both indexes are partial on live rows, so a soft
 * delete frees the key). Rare, harmless, and NOT an infrastructure incident -- which is exactly why
 * it has its own sentence instead of borrowing `indexNotReady`'s: sending an operator to inspect a
 * healthy index is the false alarm this whole split exists to remove.
 *
 * Still a defect rather than an invented success: the caller asked for a membership that, as of the
 * re-read, does not exist, and answering "here it is" would name a row that is deleted. A retry is
 * the honest resolution and the client is free to make one.
 */
export const lostRaceVanished = (index: string, what: string): Error =>
  new Error(
    `${index} refused ${what} as a duplicate -- the index is enforcing and another writer held ` +
      `the key -- but that row was removed before this re-read, so there is nothing to return. ` +
      `The invariant is intact; retry the request.`,
  )
