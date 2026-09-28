import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { freePort } from "./free-port.ts"

// From the deleted probes/src/kernel.test.ts: the async callback must actually resume, and the
// port must be one a server can listen on.
it("freePort gives an integer in 1024..65535", async () => {
  const port = await Effect.runPromise(freePort)
  expect(Number.isInteger(port)).toBe(true)
  expect(port).toBeGreaterThanOrEqual(1024)
  expect(port).toBeLessThanOrEqual(65535)
})
