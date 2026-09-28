// CRM record sharing against a real server (reader account and share)
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import {
  adapter, asMihai, CUBE, createMihai, createOrg, grantPage, MIHAI, mihaiId, orgRef, Sharing,
} from "../_layers/sharing.ts"
import { testServer } from "../_layers/test-server.ts"

// The sharing adapter (frontend/src/lib/sharing.ts) against the kernel, in the probe's order:
// a reader account and an admin-owned organization, then the grantee side before and after a
// TOTAL share. The route gate stays untouched by the grant (QWB-63 separation).

const SERVER = { timeout: 60_000, excludeTestServices: true } as const

const mihaiStatus = (method: "GET" | "PATCH") =>
  Effect.gen(function* () {
    const { entityId } = yield* orgRef
    const reply = yield* (yield* asMihai).send(method, `/organizations/${entityId}`, method === "PATCH" ? { name: "Renamed By Grantee" } : undefined)
    return reply.status
  })

const mihaiGrantList = Effect.gen(function* () {
  const ref = yield* orgRef
  return yield* adapter(yield* asMihai, (doFetch) => Sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch }))
})

const onePage = Effect.flatMap(grantPage, (page) => page.ok ? Effect.succeed(page.value) : Effect.dieMessage(JSON.stringify(page)))

layer(testServer("crm-sharing", {}, plantCrmPack), SERVER)((it) => {
  it.effect("account mihai created as reader", () =>
    Effect.map(createMihai, ({ status }) => expect(status).toBe(200)))

  it.effect("organization created by admin (owner = admin)", () =>
    Effect.map(createOrg, ({ status }) => expect(status).toBe(200)))

  it.effect("mihai cannot read the record before sharing (403)", () =>
    Effect.map(mihaiStatus("GET"), (status) => expect(status).toBe(403)))

  it.effect("mihai gets 403 on the grant list with qwbe's message", () =>
    Effect.map(mihaiGrantList, (denied) => {
      expect(denied).toMatchObject({ ok: false, status: 403 })
      expect(denied.ok ? "" : denied.message).toMatch(/owner/)
    }))

  it.effect("createUserGrant TOTAL stores exactly the six actions", () =>
    Effect.gen(function* () {
      const ref = yield* orgRef
      const total = yield* adapter(yield* asAdmin, (doFetch) =>
        Sharing.createUserGrant({ ...ref, username: MIHAI.username, actions: Sharing.TOTAL_ACTIONS, doFetch }))
      expect(total).toMatchObject({ ok: true, value: { subject: { userId: yield* mihaiId } } })
      expect(total.ok && Sharing.isTotalActions(total.value.actions)).toBe(true)
    }))

  it.effect("mihai reads the record after the share (200)", () =>
    Effect.map(mihaiStatus("GET"), (status) => expect(status).toBe(200)))

  it.effect("PATCH by the TOTAL grantee is refused at the route gate (403)", () =>
    Effect.map(mihaiStatus("PATCH"), (status) => expect(status).toBe(403)))

  it.effect("a TOTAL grantee cannot re-share (403)", () =>
    Effect.gen(function* () {
      const ref = yield* orgRef
      const reshare = yield* adapter(yield* asMihai, (doFetch) =>
        Sharing.createUserGrant({ ...ref, username: "admin", actions: ["read"], doFetch }))
      expect(reshare).toMatchObject({ ok: false, status: 403 })
    }))

  it.effect("a TOTAL grantee still cannot list grants (403)", () =>
    Effect.map(mihaiGrantList, (list) => expect(list).toMatchObject({ ok: false, status: 403 })))

  it.effect("admin lists one grant with total=1", () =>
    Effect.map(onePage, (page) => {
      expect(page.total).toBe(1)
      expect(page.rows).toHaveLength(1)
    }))

  it.effect("grantsPageView: hasMore=false on the single page", () =>
    Effect.map(onePage, (page) => expect(Sharing.grantsPageView(page).hasMore).toBe(false)))

  it.effect("chip: @mihai TOTAL from the resolved name", () =>
    Effect.gen(function* () {
      const page = yield* onePage
      const admin = yield* asAdmin
      const id = yield* mihaiId
      const names = yield* adapter(admin, (doFetch) => Sharing.lookupUserNames([id], doFetch))
      const groups = yield* adapter(admin, (doFetch) => Sharing.lookupGroups(CUBE, doFetch))
      expect(Sharing.chipsOf(page.rows, names, groups ?? {})).toMatchObject([{ label: "mihai", total: true, actions: "TOTAL" }])
    }))

  it.effect("searchAccounts finds mihai by prefix and carries no email", () =>
    Effect.gen(function* () {
      const search = yield* adapter(yield* asAdmin, (doFetch) => Sharing.searchAccounts({ q: "mih", limit: 20, doFetch }))
      expect(search.ok).toBe(true)
      const rows = search.ok ? search.value.rows : []
      expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ username: "mihai" })]))
      expect(rows.every((user) => !("email" in user))).toBe(true)
    }))
})
