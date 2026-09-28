// The ORGANIZATIONS cube — the Organization, third child of the CRM plugin.
//
// Domain: an ORGANIZATION is the company a business deals with. This is the entity the vtiger
// users worked in all day (about 60 thousand rows), rebuilt here as a photograph of the vtiger
// standard fields that actually carry data — not a one-to-one copy. What is empty or
// vtiger-internal stays out: no `notify_owner`, no `modifiedby` mirrors (EntityMeta already
// carries createdAt), no parent-to-parent hierarchy (explicitly out of scope), and no custom
// fields (those are a separate system, not this ticket).
//
// One name everywhere: the cube, its route, its table, its permissions,
// its command and its event are all "organizations". The relation to contacts has ONE truth:
// `Contact.organizationId`. It lives on the contact, it is nullable, and an organization's
// contact list is derived by filtering contacts on it. This cube does not hold a contacts list
// and does not import the contacts cube — neither names the other.
//
// Money: vtiger's `annualrevenue` is a bare integer with no currency. A number that looks like
// money without saying which money is the exact defect the contracts cube refuses, so the field
// stays out until it can be carried with a currency, in minor units.
//
// Ids: opaque strings with the prefix `org`, same naming spirit as every sibling.
// The schemas live in ./schema.ts (size cap: split, not raise).

import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { Effect, Schema } from "effect"
import { Authorization, requirePermission } from "qwbe-core/auth"
import { defineCube } from "qwbe-core/cube"
import { type SummaryRow } from "qwbe-core/entity"
import { Forbidden, NotFound } from "qwbe-core/errors"
import { PageOf } from "qwbe-core/http"
import { genericList, ListParams } from "qwbe-core/list"
import { Organization, OrganizationCreate, OrganizationPatch, type OrganizationRow } from "./schema.ts"

// The table carries the cube's own name. It was already "organizations" before the cube was
// renamed to match: the platform's builtin credential cube owns a table under this cube's old
// name, and a table has exactly one owner -- a kernel mounting both would refuse to boot with
// DuplicateTableError. The naming decision is recorded in README.md.
const TABLE = "organizations"
const ENTITY = "Organization"

const group = HttpApiGroup.make("organizations")
  .add(
    HttpApiEndpoint.get("list")`/organizations`
      .setUrlParams(ListParams)
      .addSuccess(PageOf(Organization))
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.get("get")`/organizations/${HttpApiSchema.param("id", Schema.String)}`
      .addSuccess(Organization)
      .addError(NotFound)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.post("create")`/organizations`
      .setPayload(OrganizationCreate)
      .addSuccess(Organization)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.patch("update")`/organizations/${HttpApiSchema.param("id", Schema.String)}`
      .setPayload(OrganizationPatch)
      .addSuccess(Organization)
      .addError(NotFound)
      .addError(Forbidden),
  )
  .middleware(Authorization)

// Strips metadata the summary must not carry, and keeps the summary shape identical to the
// sibling cubes: id, one human title, a couple of detail lines.
const summary = (o: OrganizationRow): SummaryRow => ({
  id: o.id,
  title: o.name,
  details: [
    { key: "industry", value: o.industry ?? "-" },
    { key: "city", value: o.billingCity ?? "-" },
  ],
})

// The one declaration per route (QWB-54, 14c): what the manifest publishes, the mount
// wrapper enforces before the handler runs — the same strings the handlers below require.
// `list` is not declared: the kernel's read convention (`crm/organizations:read`) applies.
const ROUTES = {
  get: "crm/organizations:read",
  create: "crm/organizations:write",
  update: "crm/organizations:write",
} as const

// Named, because the kernel's generic list handler reads its `searchable` (and the declared
// relations) to build the query it serves: the manifest is the whole
// answer, so the handler must see it.
const manifest = {
  name: "organizations",
  // Bump when a field changes; the drift gate refuses to boot otherwise.
  version: "1.1.0",
  parent: "crm",
  tables: [TABLE],
  entity: ENTITY,
  sortable: ["name", "industry", "createdAt"],
  // Exact match for relational.search and the generic list's `<field>=` filters; `externalId` is the import's lookup key.
  searchable: ["name", "industry", "externalId"],
  requiresAuth: true,
  permissions: [
    { name: "crm/organizations:read", roles: ["admin", "reader"] },
    { name: "crm/organizations:write", roles: ["admin"] },
  ],
  routes: ROUTES,
  publishes: ["crm/organizations.created"],
  // The predecessor is declared, not invented: this cube IS the old `crm/accounts`, renamed.
  // Postgres schemas are named after the cube, so without this declaration the renamed cube
  // would boot on an empty `crm--organizations` schema while the rows stayed in
  // `crm--accounts`. The kernel's `migrateDataSchemas` moves the schema, and the provenance
  // LEDGER -- not this claim -- decides whether crm/accounts really belonged to crm-pack
  // (checked at boot; kernel migrate-ownership.ts). Legacy rows still carry
  // `accountNo`/`accountType` in their body: the one-shot backfill
  // (tools/db/backfill-contact-organizationid.ts) renames those keys once, in the data.
  dataMigration: [{ fromCube: "crm/accounts", toCube: "crm/organizations", fromPlugin: "crm-pack" }],
}

export const cube = defineCube(group, {
  manifest,

  create: ({ store, bus }) => ({
    commands: [
      {
        name: "crm/organizations:count",
        summary: "how many organizations exist",
        permission: "crm/organizations:read",
        run: () => Effect.map(store.count(TABLE), (n) => String(n)),
      },
    ],

    handlers: {
      // The kernel's list, not this cube's: paging, sorting, `q`, the
      // `searchable` fields and the declared relations all come from the manifest; the
      // `<name>:read` permission is required inside the generic handler.
      list: genericList<OrganizationRow>({
        cube: "crm/organizations",
        table: TABLE,
        manifest,
        store,
      }),

      get: ({ path }) =>
        Effect.gen(function* () {
          yield* requirePermission("crm/organizations:read")
          const o = yield* store.byId<OrganizationRow>(TABLE, path.id)
          if (!o) return yield* Effect.fail(new NotFound({ message: `organization ${path.id} does not exist` }))
          return o
        }),

      create: ({ payload }) =>
        Effect.gen(function* () {
          yield* requirePermission("crm/organizations:write")
          const o = (yield* store.insert(TABLE, ENTITY, "org", payload)) as OrganizationRow
          yield* bus.publish("crm/organizations.created", { id: o.id, title: o.name })
          return o
        }),

      update: ({ path, payload }) =>
        Effect.gen(function* () {
          yield* requirePermission("crm/organizations:write")
          const current = yield* store.byId<OrganizationRow>(TABLE, path.id)
          if (!current) return yield* Effect.fail(new NotFound({ message: `organization ${path.id} does not exist` }))
          // An empty PATCH changes nothing: the row is returned as is, with no version bump
          // and no outbox row — store.update with an empty patch would write anyway.
          if (Object.keys(payload).length === 0) return current
          const o = yield* store.update(TABLE, path.id, payload)
          return o as OrganizationRow
        }),
    },

    relational: {
      search: (field, value, page) =>
        Effect.gen(function* () {
          const p = yield* store.page<OrganizationRow>(TABLE, page, { field, value })
          return { rows: p.rows.map(summary), total: p.total }
        }),

      summaryById: (id) =>
        Effect.gen(function* () {
          const o = yield* store.byId<OrganizationRow>(TABLE, id)
          return o ? summary(o) : undefined
        }),

      fieldValue: (id, field) =>
        Effect.gen(function* () {
          const o = yield* store.byId<OrganizationRow>(TABLE, id)
          const v = o ? (o as unknown as Record<string, unknown>)[field] : null
          return typeof v === "string" ? v : null
        }),
    },
  }),
})
