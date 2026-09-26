// The CONTACT-GROUPS cube — business groupings of CRM contacts.
//
// Domain: a CONTACT GROUP is a named set of `crm/contacts` rows — "Key accounts", "Newsletter
// Q3". Membership is a separate row per (group, contact) pair, so a contact belongs to as many
// groups as the business needs and an empty group is perfectly valid.
//
// WHAT THIS IS NOT. The kernel has groups of its own, at `/permissions/groups`: those group USER
// ACCOUNTS so that grants can be handed to several people at once. Nothing here converts, mirrors
// or touches them — different cube, different schema, different permission namespace, different
// route prefix. A contact is a person the business deals with, not someone who can log in.
//
// THE RELATION TO CONTACTS, AND THE SHARING BOUNDARY, EXACTLY. `contactId` is checked for SHAPE
// and stored opaquely. That is this project's EXPLICIT contract, not a gap waiting for a patch:
// the sibling cube treats `organizationId` the same way, the kernel has no cross-cube foreign key
// and no cascade, and a contact deleted after the membership row was written would invalidate any
// write-time check anyway. A membership row is a CLAIM whose validity is decided at READ time by
// `GET /contacts?ids=`, which already drops ids that are gone or that this caller may not read.
//
//   What a membership row therefore IS: content of the group, guarded by the group row. Reading
//   it requires BOTH access to that group row (the kernel's entity mediation: superadmin,
//   cube-admin, owner or an explicit grant) AND the `crm/contacts:read` capability. Reading a
//   group grants NO access to any contact: no grant is created, no contact row is returned, no
//   name, no email — only ids the caller already has to resolve elsewhere. Contact details resolve
//   solely through the permission-filtered contacts API, so a contact the caller may not read
//   stays unavailable there and the UI renders the id as unavailable. What this cube does NOT
//   claim: that membership rows are filtered per contact, or that `contactId` is an enforced
//   foreign key. Whoever may read the group sees which contact ids it holds. If a deployment needs
//   membership hidden from someone, the group row must not be shared with them.
//
//   Deliberately NOT done: no `exists(cube, id)` over the registry's `targetState` — that call has
//   no caller check, so exposing it to plugins would let this cube confirm the existence of
//   contacts the caller cannot read, which is a permission broadening. The kernel's permission-
//   correct primitive is `Registry.summary(entity, id, caller)`; if a check is ever wanted it must
//   be that one, exposed through a manifest flag, and it would be INPUT VALIDATION (400 on a typo),
//   never referential integrity — the UI must keep handling dangling ids either way.
//
//   Both seams this cube asked for are now OPEN, and it uses them instead of its own machinery.
//   `manifest.uniqueIndexes` (below) declares the two required unique indexes, so the kernel
//   renders their SQL, installs them as the table's owner on first touch and refuses writes while
//   one is missing, mis-defined or invalid (core/src/pg/unique-index.ts, core/src/pg/setup.ts) --
//   exactly as it already did for `permissions.permission_groups`. `onUniqueIndex`, public from
//   `qwbe-core/errors`, maps a named index's refusal to this cube's own error. What went with them:
//   this cube's `pg_indexes` write gate, its hand-written expected definitions, its `warmTables`
//   read-path bootstrap and its `usesBatch` privilege (see service.ts).
//
// `relations` is deliberately EMPTY even though this cube plainly relates to contacts: a declared
// relation becomes a `<field>=` filter on THIS cube's generic list (`filterFields`,
// core/src/metadata/declarations.ts), and `contact_groups` has no `contactId` column — declaring
// it would publish a filter that always returns nothing. The relation is documented for the UI
// instead, which resolves member ids through the contacts cube's own `GET /contacts?ids=a,b,c`.

import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { Effect, Schema } from "effect"
import { Authorization, requirePermission } from "qwbe-core/auth"
import { type CubeTools, defineCube } from "qwbe-core/cube"
import { BadRequest, Conflict, Forbidden, NotFound, type UniqueIndexRefusal } from "qwbe-core/errors"
import { PageOf } from "qwbe-core/http"
import { genericList, ListParams, listPageRequest } from "qwbe-core/list"
import { pageRequest } from "qwbe-core/pagination"
import { ContactGroup, ContactGroupCreate, ContactGroupMember, ContactGroupRename, MemberRef, MemberRemoved } from "./schema.ts"
import {
  GROUP_ENTITY,
  GROUPS,
  MEMBER_TYPE,
  MEMBERS,
  NAME_INDEX,
  PAIR_INDEX,
  UNIQUE_INDEXES,
  indexNotReady,
  lostRaceVanished,
  memberPageRequest,
  normalize,
  onNameTaken,
  onPairTaken,
  requireName,
} from "./service.ts"

type GroupRow = typeof ContactGroup.Type
type MemberRow = typeof ContactGroupMember.Type

const id = HttpApiSchema.param("id", Schema.String)

// Removal is a POST with the contact id in the PAYLOAD, not `DELETE /members/:contactId`: the
// kernel's entity mediation refuses any endpoint carrying two path parameters
// (`enforceEntityHandlers`, core/src/entity-enforcement.ts), and the kernel's own permissions
// cube uses this same shape for the same reason. It also makes the pair explicit, which is what
// keeps one group from ever retiring another group's membership.
const group = HttpApiGroup.make("contact-groups")
  .add(
    HttpApiEndpoint.get("list")`/contact-groups`
      .setUrlParams(ListParams)
      .addSuccess(PageOf(ContactGroup))
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.post("create")`/contact-groups`
      .setPayload(ContactGroupCreate)
      .addSuccess(ContactGroup)
      .addError(BadRequest)
      .addError(Conflict)
      .addError(Forbidden),
  )
  .add(HttpApiEndpoint.get("get")`/contact-groups/${id}`.addSuccess(ContactGroup).addError(NotFound).addError(Forbidden))
  .add(
    HttpApiEndpoint.patch("rename")`/contact-groups/${id}`
      .setPayload(ContactGroupRename)
      .addSuccess(ContactGroup)
      .addError(BadRequest)
      .addError(Conflict)
      .addError(NotFound)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.get("members")`/contact-groups/${id}/members`
      .setUrlParams(ListParams)
      .addSuccess(PageOf(ContactGroupMember))
      .addError(NotFound)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.post("addMember")`/contact-groups/${id}/members`
      .setPayload(MemberRef)
      .addSuccess(ContactGroupMember)
      .addError(BadRequest)
      .addError(NotFound)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.post("removeMember")`/contact-groups/${id}/members/remove`
      .setPayload(MemberRef)
      .addSuccess(MemberRemoved)
      .addError(BadRequest)
      .addError(NotFound)
      .addError(Forbidden),
  )
  .middleware(Authorization)

// One declaration per route: what the manifest publishes, the mount wrapper enforces before the
// handler runs. `list` is not declared — the kernel's read convention (`crm/contact-groups:read`)
// applies to it. `crm/contacts:read` is NOT here and cannot be: a routes entry may only name a
// permission this cube declares (`validateRoutes`, core/src/kernel/manifest-validation.ts). It is
// required inside the two handlers that expose or attach a contact identity, which is the honest
// place for it anyway — removal names an id the caller already had.
const ROUTES = {
  get: "crm/contact-groups:read",
  create: "crm/contact-groups:write",
  rename: "crm/contact-groups:write",
  members: "crm/contact-groups:read",
  addMember: "crm/contact-groups:write",
  removeMember: "crm/contact-groups:write",
} as const

const manifest = {
  name: "contact-groups",
  version: "1.0.0",
  parent: "crm",
  tables: [GROUPS, MEMBERS],
  entity: GROUP_ENTITY,
  sortable: ["name", "createdAt"],
  searchable: ["name"],
  requiresAuth: true,
  permissions: [
    { name: "crm/contact-groups:read", roles: ["admin", "reader"] },
    { name: "crm/contact-groups:write", roles: ["admin"] },
  ],
  routes: ROUTES,
  publishes: ["crm/contact-groups.created"],
  // THE DECLARED INVARIANT. The kernel installs these two as the table's owner and refuses a write
  // to either table while its index is absent, carries a different definition or is invalid; this
  // cube's role holds DML only and could never install them itself. The specs live in service.ts
  // because the operator CLI reads the same ones (no second copy of the SQL anywhere).
  uniqueIndexes: UNIQUE_INDEXES,
  // NO `usesBatch`, and it is not an omission: the raw batch path calls neither `ensureTable` nor
  // the write gate, so it writes around the invariant above -- the kernel REFUSES a manifest that
  // declares both (`uniqueIndexReasons`, core/src/pg/unique-index.ts). The cube's one former use of
  // it, a read-only pg_indexes probe, is what the kernel's gate now does properly.
  // No `dataMigration`: this cube has no predecessor, and saying so is the honest declaration.
}

/** The one live membership of a (group, contact) pair, or undefined. The pair is matched on BOTH
 *  fields — that is what stops a removal aimed at one group from retiring another group's row. */
const livePair = (store: CubeTools["store"], groupId: string, contactId: string) =>
  Effect.map(
    store.page<MemberRow>(MEMBERS, pageRequest({ offset: 0, limit: 1 }), {
      equals: [
        { field: "groupId", value: groupId },
        { field: "contactId", value: contactId },
      ],
    }),
    (p) => p.rows[0],
  )

export const cube = defineCube(group, {
  manifest,

  create: ({ store, bus }) => {
    // The ordinary list, and nothing else. It used to carry a `before` hook that counted both
    // tables so the kernel would create them, because the pack's index tool could not index a
    // table that did not exist yet and `contact_group_members` was reachable only through a write
    // the gate refused -- a fresh install deadlocked. The kernel now installs the indexes inside
    // `ensureTable` itself, on the first touch of each table, so the first write creates its own
    // table AND its own index and there is nothing left to warm.
    const listGroups = genericList<GroupRow>({
      cube: "crm/contact-groups",
      table: GROUPS,
      manifest,
      store,
    })

    /** A group, or a 404. Every member operation starts here: there is no orphan membership, and
     *  no way to reach one through a group that does not exist. */
    const requireGroup = (groupId: string) =>
      Effect.gen(function* () {
        const g = yield* store.byId<GroupRow>(GROUPS, groupId)
        if (!g) return yield* Effect.fail(new NotFound({ message: `contact group ${groupId} does not exist` }))
        return g
      })

    /** The friendly half of the uniqueness rule. The database holds the other half, and the
     *  database is the arbiter: this pre-check answers the ordinary case with a clear 409, and
     *  the index answers the race with the same one. */
    const namedSame = (name: string) =>
      Effect.map(
        store.page<GroupRow>(GROUPS, pageRequest({ offset: 0, limit: 1 }), {
          field: "normalizedName",
          value: normalize(name),
        }),
        (p) => p.rows[0],
      )

    /** The 409 both write paths give for a name somebody else holds. One sentence, whether the
     *  pre-check saw the clash or the index did. */
    const nameTaken = (name: string) =>
      new Conflict({ message: `a contact group named "${name.trim()}" already exists` })

    /**
     * The NAME index refused a write -- and what that MEANS is decided by the kernel's TAG, never by
     * re-reading this cube's own key (see `onIndexRefusal` in service.ts).
     *
     * `duplicate` means the index enforced and a live row holds the key: the ordinary clash the
     * pre-check could not see in time, answered with the same 409 and the same sentence. It is
     * unconditional, and that is the point. The pre-check compares `normalizedName`, which is
     * JavaScript's `trim().toLowerCase()`; the index compares Postgres's `lower(btrim(...))`. They
     * diverge (`lower('ΟΔΟΣ')` is `οδοσ` on the server, `οδος` here), and where they do, a re-read
     * cannot find the row the server just refused this write against. The old code read that miss as
     * "the index must be gone" and answered 500 with an operator alarm about a healthy index, for
     * what is a plain duplicate. The tag removes the guess: the index spoke, so it exists.
     *
     * `notReady` means the gate refused BEFORE the statement ran, so nobody holds that name and no
     * name is obtainable at all. Saying "already exists" would be a false sentence AND would hide
     * the incident. It dies: 500 with no details for the caller, the index name and the operator
     * command in the log.
     *
     * There is no `selfId` case left to handle. An UPDATE that keeps the row's own index key does
     * not violate a unique index, so a `duplicate` on rename is always somebody else's row; a
     * respelling of the group's own name never reaches here as a duplicate.
     */
    const nameRefused =
      (name: string) =>
      (reason: string, refusal: UniqueIndexRefusal): Effect.Effect<never, Conflict, never> =>
        refusal.reason === "duplicate"
          ? Effect.fail(nameTaken(name))
          : Effect.die(indexNotReady(NAME_INDEX, "a contact-group name write", reason))

    return {
      commands: [
        {
          name: "crm/contact-groups:count",
          summary: "how many contact groups exist",
          permission: "crm/contact-groups:read",
          run: () => Effect.map(store.count(GROUPS), (n) => String(n)),
        },
      ],

      handlers: {
        list: listGroups,

        get: ({ path }) =>
          Effect.gen(function* () {
            yield* requirePermission("crm/contact-groups:read")
            return yield* requireGroup(path.id)
          }),

        create: ({ payload }) =>
          Effect.gen(function* () {
            yield* requirePermission("crm/contact-groups:write")
            const name = yield* requireName(payload.name)
            const clash = yield* namedSame(name)
            if (clash) return yield* Effect.fail(nameTaken(name))
            const g = (yield* store
              .insert(GROUPS, GROUP_ENTITY, "cgrp", { name, normalizedName: normalize(name) })
              .pipe(onNameTaken(nameRefused(name)))) as GroupRow
            yield* bus.publish("crm/contact-groups.created", { id: g.id, title: g.name })
            return g
          }),

        // Renaming to another spelling of the group's OWN name is allowed: the clash is only a
        // clash when the row holding that normalized name is somebody else.
        rename: ({ path, payload }) =>
          Effect.gen(function* () {
            yield* requirePermission("crm/contact-groups:write")
            const name = yield* requireName(payload.name)
            const current = yield* requireGroup(path.id)
            const clash = yield* namedSame(name)
            if (clash && clash.id !== current.id) return yield* Effect.fail(nameTaken(name))
            return (yield* store
              .update(GROUPS, path.id, { name, normalizedName: normalize(name) })
              .pipe(onNameTaken(nameRefused(name)))) as GroupRow
          }),

        // The rows carry contact IDS and nothing else. Resolving them to names is the caller's
        // call against `GET /contacts?ids=...`, which is why `crm/contacts:read` is required
        // here: this endpoint exposes who is in a group.
        members: ({ path, urlParams }) =>
          Effect.gen(function* () {
            yield* requirePermission("crm/contact-groups:read")
            yield* requirePermission("crm/contacts:read")
            yield* requireGroup(path.id)
            // `memberPageRequest` narrows the ordering to fields a MEMBERSHIP row actually has:
            // `?sort=name` would otherwise order by a jsonb key that is NULL on every row, which
            // makes the pages unstable (rows repeated, rows never shown). See service.ts.
            return yield* store.page<MemberRow>(MEMBERS, memberPageRequest(listPageRequest(urlParams)), {
              field: "groupId",
              value: path.id,
            })
          }),

        // Idempotent by contract: adding a contact that is already in the group returns the
        // membership that is already there, creates nothing, and is never a 409. The same answer
        // is given when a concurrent caller wins the race — see `onPairTaken`.
        addMember: ({ path, payload }) =>
          Effect.gen(function* () {
            yield* requirePermission("crm/contact-groups:write")
            yield* requirePermission("crm/contacts:read")
            yield* requireGroup(path.id)
            const existing = yield* livePair(store, path.id, payload.contactId)
            if (existing) return existing
            const insert = Effect.map(
              store.insert(MEMBERS, MEMBER_TYPE, "cgm", { groupId: path.id, contactId: payload.contactId }),
              (row) => row as MemberRow,
            )
            // The pair index refused the insert, and the kernel's TAG says which refusal it was --
            // it is not inferred from what the re-read finds.
            //
            // `notReady`: the write GATE refused before the statement ran. The index is absent,
            // carries a different definition or is invalid, nothing holds the pair and nothing is
            // enforcing it. A defect, never a made-up success -- and decided BEFORE the re-read,
            // because a live pair found here would otherwise be answered as an idempotent success
            // while the invariant is not installed at all.
            //
            // `duplicate`: the index enforced and another writer holds the pair, so this caller's
            // intent is already satisfied. The re-read is still needed -- not to classify the
            // refusal, but to fetch WHICH row won, which is the idempotent answer. If that row is
            // gone (a soft delete frees the key), it says so truthfully instead of blaming the
            // index: `lostRaceVanished`, not an operator alarm.
            const reread = (reason: string, refusal: UniqueIndexRefusal) =>
              Effect.gen(function* () {
                if (refusal.reason === "notReady") {
                  return yield* Effect.die(indexNotReady(PAIR_INDEX, "a membership write", reason))
                }
                const row = yield* livePair(store, path.id, payload.contactId)
                if (!row) return yield* Effect.die(lostRaceVanished(PAIR_INDEX, "a membership write"))
                return row
              })
            return yield* insert.pipe(onPairTaken(reread))
          }),

        // Soft delete, and only of the exact pair. A contact that is not in THIS group is a 404
        // even when it is in another one — there is no cross-group removal.
        removeMember: ({ path, payload }) =>
          Effect.gen(function* () {
            yield* requirePermission("crm/contact-groups:write")
            yield* requireGroup(path.id)
            const row = yield* livePair(store, path.id, payload.contactId)
            if (!row) {
              return yield* Effect.fail(
                new NotFound({ message: `contact ${payload.contactId} is not a member of contact group ${path.id}` }),
              )
            }
            yield* store.update(MEMBERS, row.id, { deleted: true })
            return { removed: row.id }
          }),
      },
    }
  },
})
