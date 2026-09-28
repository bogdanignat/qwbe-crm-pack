// CRM cubes against a real server (auth boundary)
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { call } from "../_layers/api-client.ts"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin, asReader } from "../_layers/session.ts"
import { TestServer, testServer } from "../_layers/test-server.ts"

// Every cube of the pack behind the kernel's gate: no token is 401, a reader writing is 403 (the
// manifest's write routes, enforced by the mount wrapper), a missing id is 404.

const SERVER = { timeout: 60_000, excludeTestServices: true } as const

const Created = Schema.Struct({ id: Schema.String })

const createdId = (path: string, body: unknown) =>
  asAdmin.pipe(
    Effect.flatMap((admin) => admin.send("POST", path, body)),
    Effect.flatMap((reply) => Effect.orDie(Schema.decodeUnknown(Created)(reply.body))),
    Effect.map(({ id }) => id),
  )

const anonymousStatus = (path: string) =>
  Effect.flatMap(TestServer, ({ base }) => Effect.map(call(base, path), (reply) => reply.status))

layer(testServer("crm-auth", {}, plantCrmPack), SERVER)((it) => {
  it.effect("contacts requires authentication (401)", () =>
    Effect.map(anonymousStatus("/contacts"), (status) => expect(status).toBe(401)))

  it.effect("contracts requires authentication (401)", () =>
    Effect.map(anonymousStatus("/contracts"), (status) => expect(status).toBe(401)))

  it.effect("organizations requires authentication (401)", () =>
    Effect.map(anonymousStatus("/organizations"), (status) => expect(status).toBe(401)))

  it.effect("reader cannot create a contact (403)", () =>
    Effect.gen(function* () {
      const reply = yield* (yield* asReader).send("POST", "/contacts", { name: "Refused Reader" })
      expect(reply.status).toBe(403)
    }))

  it.effect("reader cannot create a contract (403)", () =>
    Effect.gen(function* () {
      const reply = yield* (yield* asReader).send("POST", "/contracts", { title: "Refused" })
      expect(reply.status).toBe(403)
    }))

  it.effect("reader cannot create an organization (403)", () =>
    Effect.gen(function* () {
      const reply = yield* (yield* asReader).send("POST", "/organizations", { name: "Refused Reader SRL" })
      expect(reply.status).toBe(403)
    }))

  it.effect("reader cannot update a contact (403)", () =>
    Effect.gen(function* () {
      const id = yield* createdId("/contacts", { name: "Ada Ionescu", company: "Ada SRL" })
      const reply = yield* (yield* asReader).send("PATCH", `/contacts/${id}`, { company: "Refused" })
      expect(reply.status).toBe(403)
    }))

  it.effect("reader cannot update an organization (403)", () =>
    Effect.gen(function* () {
      const id = yield* createdId("/organizations", { name: "Ada Industries SRL" })
      const reply = yield* (yield* asReader).send("PATCH", `/organizations/${id}`, { billingCity: "Refused" })
      expect(reply.status).toBe(403)
    }))

  it.effect("missing contact is 404", () =>
    Effect.gen(function* () {
      expect(yield* (yield* asAdmin).status("/contacts/cont_missing")).toBe(404)
    }))

  it.effect("missing contract is 404", () =>
    Effect.gen(function* () {
      expect(yield* (yield* asAdmin).status("/contracts/ctr_missing")).toBe(404)
    }))

  it.effect("missing organization is 404", () =>
    Effect.gen(function* () {
      expect(yield* (yield* asAdmin).status("/organizations/acc_missing")).toBe(404)
    }))
})
