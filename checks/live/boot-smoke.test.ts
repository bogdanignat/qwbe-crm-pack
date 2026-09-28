import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { USERS } from "../_layers/boot.ts"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { TestServer, testServer } from "../_layers/test-server.ts"
import { asAdmin } from "../_layers/session.ts"

// The scratch smoke for the layers: the kernel boots with this pack planted, and the pack's
// contacts cube serves its list.

const SERVER = { timeout: 60_000, excludeTestServices: true } as const

const json = (reply: Response) => Effect.tryPromise(() => reply.json() as Promise<unknown>)

const login = (base: string) =>
  Effect.tryPromise((signal) =>
    fetch(`${base}/auth/login`, {
      signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: USERS.admin }),
    }),
  ).pipe(Effect.flatMap(json), Effect.map((body) => (body as { token: string }).token))

const get = (base: string, path: string, token?: string) =>
  Effect.tryPromise((signal) => fetch(`${base}${path}`, {
    signal,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }))

layer(
  testServer("boot-smoke", {}, plantCrmPack),
  SERVER,
)((it) => {
  it.effect("boots with the pack planted and lists contacts for admin", () =>
    Effect.gen(function* () {
      const { base } = yield* TestServer
      // 401 counts: the spec sits behind authentication, so either answer means the server is up.
      const spec = yield* get(base, "/openapi.json")
      expect(spec.status === 200 || spec.status === 401).toBe(true)
      const token = yield* login(base)
      const contacts = yield* get(base, "/contacts", token)
      expect(contacts.status).toBe(200)
    }),
  )

  it.effect("admin logs in over api-client and lists contacts", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      const reply = yield* admin.get("/contacts")
      expect(reply.status).toBe(200)
    }),
  )
})
