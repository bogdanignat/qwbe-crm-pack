import * as Effect from "effect/Effect"
import * as Tools from "../../tools/shared/api-client.ts"

export type { CallOptions, Reply } from "../../tools/shared/api-client.ts"

// The tools' client, with every failure turned into a defect: a check has no recovery path, and a
// transport failure or refused login must fail the test, not flow through its error channel.

/** One request to `base + path`; any status comes back, only a transport failure dies. */
export const call = (base: string, path: string, options: Tools.CallOptions = {}) =>
  Effect.orDie(Tools.call(base, path, options))

/** Logs in and returns the session token; a refused login or a malformed reply fails the test. */
export const login = (base: string, username: string, password: string) =>
  Effect.orDie(Tools.login(base, username, password))
