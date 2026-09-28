// CRM record sharing against a real server (group grant, revokes, duplicates)
import { expect, layer } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import {
  adapter, asMihai, CUBE, createMihai, createOrg, grantPage, MIHAI, orgRef, Sharing,
} from "../_layers/sharing.ts"
import { testServer } from "../_layers/test-server.ts"

// The second half of the probe's scenario on its own server. The setup replays the first half
// (reader account, admin-owned organization, TOTAL user grant); the checks then add a group grant
// and revoke in the probe's order. The backend does not deduplicate grants (G4).

const SERVER = { timeout: 60_000, excludeTestServices: true } as const

class UserGrant extends Context.Tag("UserGrant")<UserGrant, { readonly id: string }>() {}

const Id = Schema.Struct({ id: Schema.String })

const setup = Layer.effect(UserGrant, Effect.gen(function* () {
  yield* createMihai
  yield* createOrg
  const ref = yield* orgRef
  const total = yield* adapter(yield* asAdmin, (doFetch) =>
    Sharing.createUserGrant({ ...ref, username: MIHAI.username, actions: Sharing.TOTAL_ACTIONS, doFetch }))
  return total.ok ? { id: total.value.id } : yield* Effect.dieMessage(JSON.stringify(total))
}))

const groupId = Effect.flatMap(asAdmin, (admin) => adapter(admin, (doFetch) => Sharing.lookupGroups(CUBE, doFetch))).pipe(
  Effect.map((groups) => Object.keys(groups ?? {})[0] ?? ""),
)

const asAdminDo = <A>(call: (doFetch: typeof fetch) => Promise<A>) => Effect.flatMap(asAdmin, (admin) => adapter(admin, call))
const withRef = <A>(call: (ref: Effect.Effect.Success<typeof orgRef>, doFetch: typeof fetch) => Promise<A>) =>
  Effect.flatMap(orgRef, (ref) => asAdminDo((doFetch) => call(ref, doFetch)))
const mihaiReads = Effect.gen(function* () {
  const { entityId } = yield* orgRef
  return yield* (yield* asMihai).status(`/organizations/${entityId}`)
})
const rows = Effect.map(grantPage, (page) => (page.ok ? page.value.rows : []))

layer(setup.pipe(Layer.provideMerge(testServer("crm-sharing-revoke", {}, plantCrmPack))), SERVER)((it) => {
  it.effect("group Sales created", () =>
    Effect.map(Effect.flatMap(asAdmin, (admin) => admin.send("POST", "/permissions/groups", { cube: CUBE, name: "Sales" })),
      ({ status }) => expect(status).toBe(200)))

  it.effect("mihai added to Sales", () =>
    Effect.gen(function* () {
      const reply = yield* (yield* asAdmin).send("POST", `/permissions/groups/${yield* groupId}/members`, { username: MIHAI.username })
      expect(reply.status).toBe(200)
    }))

  it.effect("lookupGroups names Sales by id", () =>
    Effect.gen(function* () {
      const groups = yield* asAdminDo((doFetch) => Sharing.lookupGroups(CUBE, doFetch))
      expect(groups).toEqual({ [yield* groupId]: "Sales" })
    }))

  it.effect("createGroupGrant read stores [read]", () =>
    Effect.gen(function* () {
      const id = yield* groupId
      const grant = yield* withRef((ref, doFetch) => Sharing.createGroupGrant({ ...ref, groupId: id, actions: ["read"], doFetch }))
      expect(grant).toMatchObject({ ok: true, value: { actions: ["read"] } })
    }))

  it.effect("createGroupGrant refuses an empty set before any request", () =>
    Effect.gen(function* () {
      const id = yield* groupId
      const empty = yield* withRef((ref, doFetch) => Sharing.createGroupGrant({ ...ref, groupId: id, actions: [], doFetch }))
      expect(empty).toMatchObject({ ok: false, status: 400 })
    }))

  it.effect("unknown username answers 404 with qwbe's message", () =>
    Effect.map(withRef((ref, doFetch) => Sharing.createUserGrant({ ...ref, username: "nobody-here", actions: ["read"], doFetch })),
      (unknown) => {
        expect(unknown).toMatchObject({ ok: false, status: 404 })
        expect(unknown.ok ? "" : unknown.message).toMatch(/nobody-here/)
      }))

  it.effect("revokeGrant on the user grant", () =>
    Effect.gen(function* () {
      const { id } = yield* UserGrant
      expect(yield* asAdminDo((doFetch) => Sharing.revokeGrant(id, doFetch))).toEqual({ ok: true, value: { revoked: id } })
    }))

  it.effect("mihai still reads through the group grant (200)", () =>
    Effect.map(mihaiReads, (status) => expect(status).toBe(200)))

  it.effect("revoking the same grant again answers 404", () =>
    Effect.gen(function* () {
      const { id } = yield* UserGrant
      expect(yield* asAdminDo((doFetch) => Sharing.revokeGrant(id, doFetch))).toMatchObject({ ok: false, status: 404 })
    }))

  it.effect("revokeGrant on the group grant", () =>
    Effect.gen(function* () {
      const group = (yield* rows).find((row) => row.subject.kind === "group")
      const { id } = yield* Effect.orDie(Schema.decodeUnknown(Id)(group))
      expect(yield* asAdminDo((doFetch) => Sharing.revokeGrant(id, doFetch))).toMatchObject({ ok: true })
    }))

  it.effect("mihai loses access after both revokes (403)", () =>
    Effect.map(mihaiReads, (status) => expect(status).toBe(403)))

  it.effect("grant list is empty with total=0 after the revokes", () =>
    Effect.map(grantPage, (page) => expect(page).toMatchObject({ ok: true, value: { total: 0 } })))

  it.effect("two identical shares yield two rows (backend does not deduplicate)", () =>
    Effect.gen(function* () {
      const share = withRef((ref, doFetch) => Sharing.createUserGrant({ ...ref, username: MIHAI.username, actions: ["read"], doFetch }))
      expect([yield* share, yield* share]).toMatchObject([{ ok: true }, { ok: true }])
      expect(yield* grantPage).toMatchObject({ ok: true, value: { total: 2 } })
    }))

  it.effect("duplicate rows are two separately revokable chips", () =>
    Effect.map(rows, (dup) => {
      const chips = Sharing.chipsOf(dup, {}, {})
      expect(chips).toHaveLength(2)
      expect(chips[0]?.grantId).not.toBe(chips[1]?.grantId)
    }))

  it.effect("revoking one duplicate keeps the other", () =>
    Effect.gen(function* () {
      const [first] = yield* rows
      const { id } = yield* Effect.orDie(Schema.decodeUnknown(Id)(first))
      expect(yield* asAdminDo((doFetch) => Sharing.revokeGrant(id, doFetch))).toMatchObject({ ok: true })
      expect(yield* grantPage).toMatchObject({ ok: true, value: { total: 1 } })
    }))
})
