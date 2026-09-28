// Install lifecycle of this pack in a scratch store (use, restart, switch off, uninstall)
import { join } from "node:path"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { call } from "../_layers/api-client.ts"
import { exists, installFrom, mountedCrm, SourceBefore, sourceBefore, sourceFingerprint } from "../_layers/install-from.ts"
import { asAdmin, asReader, bootedAsAdmin } from "../_layers/session.ts"
import { bootedServer, TestServer, testWorkspace } from "../_layers/test-server.ts"
import { Workspace } from "../_layers/workspace.ts"

// The installed pack over three more boots on one database: written and read, kept across a
// restart, one cube switched off and on, then uninstalled. The setup boots once to install this
// repo through install-from and to write a kernel note the uninstall must leave alone. Rows are
// private to their owner (row visibility), so rows are read back as the admin who wrote them.

const OPTIONS = { timeout: 120_000, excludeTestServices: true } as const
const CONTACT = "/contacts?name=QWB31%20Proba"

const Id = Schema.Struct({ id: Schema.String })
const idOf = (body: unknown) => Effect.map(Effect.orDie(Schema.decodeUnknown(Id)(body)), ({ id }) => id)

const installed = Layer.effectDiscard(bootedAsAdmin((admin) =>
  installFrom(admin).pipe(
    Effect.filterOrDie((reply) => reply.status === 200, (reply) => new Error(`install-from: ${JSON.stringify(reply.body)}`)),
    Effect.zipRight(admin.send("POST", "/notes", { title: "QWB31 note" })),
  )))

const setup = installed.pipe(Layer.provideMerge(sourceBefore), Layer.provideMerge(testWorkspace("install-remove")))

const status = (path: string) => Effect.flatMap(asAdmin, (admin) => admin.status(path))

layer(setup, OPTIONS)((it) => {
  it.layer(bootedServer())("the installed pack in use", (it) => {
    it.effect("E2E: contact + contract created, read back, partyId opaque and pointing at the contact", () =>
      Effect.gen(function* () {
        const admin = yield* asAdmin
        const contact = yield* idOf((yield* admin.send("POST", "/contacts", { name: "QWB31 Proba", email: "qwb31@example.com", company: "Proba SRL" })).body)
        const contract = yield* admin.send("POST", "/contracts", { title: "QWB31 Contract", amount: 4200, currency: "RON", partyId: contact })
        expect(contract.body).toMatchObject({ partyId: contact })
        expect(yield* admin.get(`/contracts/${yield* idOf(contract.body)}`)).toMatchObject({ status: 200, body: { partyId: contact } })
        expect((yield* admin.get(CONTACT)).body).toMatchObject({ rows: [{ id: contact }] })
      }))

    it.effect("boundaries: 401 anon, 403 reader-create, 400 invalid payload, 404 unknown id", () =>
      Effect.gen(function* () {
        const anon = yield* call((yield* TestServer).base, "/contacts")
        const forbidden = yield* (yield* asReader).send("POST", "/contacts", { name: "Refused" })
        const invalid = yield* (yield* asAdmin).send("POST", "/contracts", { title: "Bad money", amount: 10.5, currency: "RON" })
        const missing = yield* status("/contacts/cont_qwb31_missing")
        expect([anon.status, forbidden.status, invalid.status, missing]).toEqual([401, 403, 400, 404])
      }))
  })

  it.layer(bootedServer())("after a restart", (it) => {
    it.effect("restart keeps the plugin mounted and the CRM rows", () =>
      Effect.gen(function* () {
        const admin = yield* asAdmin
        expect(yield* mountedCrm).toEqual(expect.arrayContaining(["crm/contacts", "crm/contracts"]))
        expect(yield* admin.get(CONTACT)).toMatchObject({ status: 200, body: { total: 1, rows: [{ name: "QWB31 Proba" }] } })
        expect((yield* admin.get("/contracts")).body).toMatchObject({ rows: [{ title: "QWB31 Contract" }] })
      }))

    it.effect("contracts disabled: contacts and Qwbe keep answering, contracts is gone", () =>
      Effect.gen(function* () {
        const off = yield* (yield* asAdmin).switchCube("crm/contracts", false)
        const answers = [off.status, yield* status("/contacts"), yield* status("/settings/cubes"), yield* status("/contracts")]
        expect(answers).toEqual([200, 200, 200, 404])
      }))

    it.effect("re-enabling contracts brings it back with its data", () =>
      Effect.gen(function* () {
        const admin = yield* asAdmin
        expect((yield* admin.switchCube("crm/contracts", true)).status).toBe(200)
        expect(yield* admin.get("/contracts")).toMatchObject({ status: 200, body: { total: 1 } })
      }))

    it.effect("uninstall crm-pack accepted (requiresRestart)", () =>
      Effect.map(Effect.flatMap(asAdmin, (admin) => admin.send("DELETE", "/settings/packages/crm-pack")), (reply) =>
        expect(reply).toMatchObject({ status: 200, body: { requiresRestart: true } })))

    it.effect("uninstall removes the mounted copy, keeps the store shelf", () =>
      Effect.gen(function* () {
        const { pluginsDir, storeDir } = yield* Workspace
        expect([yield* exists(join(pluginsDir, "crm-pack")), yield* exists(storeDir, "crm-pack", "qwbe-package.json")]).toEqual([false, true])
      }))
  })

  it.layer(bootedServer())("after the next restart", (it) => {
    it.effect("after restart: the CRM cubes unmounted, notes data untouched", () =>
      Effect.gen(function* () {
        expect(yield* mountedCrm).toEqual([])
        expect(yield* status("/contacts")).toBe(404)
        expect((yield* (yield* asAdmin).get("/notes")).body).toMatchObject({ total: 1, rows: [{ title: "QWB31 note" }] })
      }))
  })

  it.effect("the plugin source tree is byte-identical after the whole run", () =>
    Effect.gen(function* () {
      expect(yield* sourceFingerprint).toBe(yield* SourceBefore)
    }))
})
