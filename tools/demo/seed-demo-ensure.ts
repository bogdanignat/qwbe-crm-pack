// The create path: definitions first (the fold is OFF while a cube has no active definitions,
// so custom keys would be silently stripped), then the rows. Never rewrites a row that is
// already there -- a rerun must not stomp edits made through the UI.
import type * as HttpClient from "@effect/platform/HttpClient"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { ApiFailed } from "../shared/api-client.ts"
import { type Api, Created, Defs, defsPath, Keyed, Titles, Total } from "./seed-demo-api.ts"
import { COUNTS, DEF_CUBES } from "./seed-demo-fields.ts"
import { contactRow, contractRow, indexes, organizationRow } from "./seed-demo-pure.ts"

type Outcome = "created" | "existing"

const tally = (outcomes: ReadonlyArray<Outcome>) => ({
  created: outcomes.filter((o) => o === "created").length,
  existing: outcomes.filter((o) => o === "existing").length,
})

const post = (api: Api, path: string, body: unknown) => api(Created, path, { method: "POST", body })

export const ensureDefs = (api: Api) =>
  Effect.forEach(DEF_CUBES, ([cube, fields]) =>
    Effect.gen(function* () {
      const existing = yield* api(Defs, defsPath(cube))
      const known = new Set(existing.rows.filter((d) => !d.deleted).map((d) => d.name))
      const missing = fields.flatMap((field, position) => (known.has(field.name) ? [] : [{ targetCube: cube, position, ...field }]))
      yield* Effect.forEach(missing, (body) => api(Schema.Unknown, "/customfields", { method: "POST", body }), { discard: true })
      return { cube, created: missing.length, existing: fields.length - missing.length }
    }))

const findByExternalId = (api: Api, route: string, externalId: string) =>
  Effect.map(api(Keyed, `${route}?externalId=${encodeURIComponent(externalId)}&limit=1`), (page) =>
    Arr.findFirst(page.rows, (r) => r.externalId === externalId))

// Organizations: lookup by the deterministic externalId, create only what is missing.
const ensureOrganization = (api: Api) => (i: number) =>
  Effect.gen(function* () {
    const payload = organizationRow(i)
    const found = yield* findByExternalId(api, "/organizations", payload.externalId)
    const outcome: Outcome = Option.isSome(found) ? "existing" : "created"
    const id = Option.isSome(found) ? found.value.id : (yield* post(api, "/organizations", payload)).id
    return { externalId: payload.externalId, id, outcome }
  })

// Contacts: linked to their organization through the one truth, organizationId.
const ensureContact = (api: Api, orgIds: ReadonlyMap<string, string>) => (i: number) =>
  Effect.gen(function* () {
    const { organizationExternalId, custom, ...statics } = contactRow(i)
    const found = yield* findByExternalId(api, "/contacts", statics.externalId)
    if (Option.isSome(found)) return "existing" as const
    yield* post(api, "/contacts", { ...statics, organizationId: orgIds.get(organizationExternalId), ...custom })
    return "created" as const
  })

// ponytail: the scan stops at 2000 rows (10 pages of MAX_LIMIT=200) -- a sandbox holds
// the 5 demo contracts; when a real 60k-row import lands, this marker moves to a
// declared field on the cube, not to an ever-growing scan.
const contractTitles = (api: Api, offset = 0): Effect.Effect<ReadonlyArray<string>, ApiFailed, HttpClient.HttpClient> =>
  Effect.flatMap(api(Titles, `/contracts?limit=200&offset=${offset}`), (page) => {
    const titles = page.rows.map((r) => r.title)
    const next = offset + 200
    return next >= page.total || next >= 2000
      ? Effect.succeed(titles)
      : Effect.map(contractTitles(api, next), (rest) => [...titles, ...rest])
  })

// Contracts: no externalId on this cube, so the deterministic TITLES are the marker (the same
// ones the wipe deletes by). The party is the organization's id -- opaque data on a nullable
// field, exactly as the cube contract defines it.
const ensureContract = (api: Api, orgIds: ReadonlyMap<string, string>, known: ReadonlySet<string>) => (j: number) => {
  const { partyExternalId, ...statics } = contractRow(j)
  return known.has(statics.title)
    ? Effect.succeed("existing" as const)
    : Effect.as(post(api, "/contracts", { ...statics, partyId: orgIds.get(partyExternalId) }), "created" as const)
}

/** Creates the missing demo rows; returns {created, existing} per cube. */
export const ensureRows = (api: Api) =>
  Effect.gen(function* () {
    const orgs = yield* Effect.forEach(indexes(COUNTS.organizations), ensureOrganization(api))
    const orgIds = new Map(orgs.map((o) => [o.externalId, o.id]))
    const contacts = yield* Effect.forEach(indexes(COUNTS.contacts), ensureContact(api, orgIds))
    const known = new Set(yield* contractTitles(api))
    const contracts = yield* Effect.forEach(indexes(COUNTS.contracts), ensureContract(api, orgIds, known))
    return { organizations: tally(orgs.map((o) => o.outcome)), contacts: tally(contacts), contracts: tally(contracts) }
  })

export const totals = (api: Api) =>
  Effect.forEach(["/organizations", "/contacts", "/contracts"], (route) =>
    Effect.map(api(Total, `${route}?limit=1`), ({ total }) => [route, total] as const))
