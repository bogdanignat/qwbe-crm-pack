// CRM cubes against a real server (independence)
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"

// The decided minimal relation made observable: QWBE_MOUNTED restricts the mount set to one CRM
// cube, and that cube boots and serves its (empty) list without the others. One server per cube.

const SERVER = { timeout: 60_000, excludeTestServices: true } as const

const ONLY = [
  ["crm/contacts", "/contacts"],
  ["crm/contracts", "/contracts"],
  ["crm/organizations", "/organizations"],
] as const

for (const [only, route] of ONLY) {
  const mounted = { QWBE_MOUNTED: `auth,account,settings,cli,crm,${only}` }
  layer(testServer(`crm-only-${only.replace("/", "-")}`, mounted, plantCrmPack), SERVER)((it) => {
    it.effect(`${only} serves without the other cube`, () =>
      Effect.gen(function* () {
        const reply = yield* (yield* asAdmin).get(route)
        expect(reply.status).toBe(200)
        expect(reply.body).toMatchObject({ total: 0 })
      }))
  })
}
