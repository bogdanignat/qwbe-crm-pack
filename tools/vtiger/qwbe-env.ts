// The kernel connection of the vtiger upload and verify tools: QWBE_URL (default
// http://127.0.0.1:4500), QWBE_USER and QWBE_PASSWORD, both required. No default credentials:
// a missing one is named and the tool exits 2.
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { login, type Session } from "../shared/api-client.ts"
import { Refused } from "../shared/run-tool.ts"

const Env = Config.all({
  base: Config.string("QWBE_URL").pipe(
    Config.withDefault("http://127.0.0.1:4500"),
    Config.map((url) => url.replace(/\/$/, "")),
  ),
  user: Config.string("QWBE_USER").pipe(Config.withDefault("")),
  password: Config.redacted("QWBE_PASSWORD").pipe(Config.withDefault(Redacted.make(""))),
})

export type QwbeEnv = Config.Config.Success<typeof Env>

/** The connection settings; Refused (exit 2) when a credential is missing. */
export const qwbeEnv = Effect.gen(function* () {
  const env = yield* Effect.orDie(Env) // every key has a default: nothing to fail on
  const missing = env.user === "" ? "QWBE_USER" : Redacted.value(env.password) === "" ? "QWBE_PASSWORD" : undefined
  if (missing !== undefined) {
    return yield* new Refused({ message: `set ${missing} in the environment (no default credentials)`, code: 2 })
  }
  return env
})

/** Logs in with the settings; the kernel base URL and the session token. */
export const sessionOf = (env: QwbeEnv) =>
  Effect.map(login(env.base, env.user, Redacted.value(env.password)), (token): Session => ({ base: env.base, token }))
