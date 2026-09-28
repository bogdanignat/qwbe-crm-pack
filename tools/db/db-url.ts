// The database URL of the pack's tools, read through effect's Config. Never a default password.
import * as Config from "effect/Config"
import type * as ConfigError from "effect/ConfigError"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export class DbUrlMissing extends Data.TaggedError("DbUrlMissing")<{ readonly message: string }> {}

// An unset or empty variable is absent, as the old `if (process.env.X)` read it.
const env = (name: string) => Config.option(Config.string(name)).pipe(Config.map(Option.filter((v) => v !== "")))

/** Connection URL from the environment; none when neither spelling is set. Never a default. */
export const databaseUrl: Effect.Effect<Option.Option<string>, ConfigError.ConfigError> = Effect.gen(function* () {
  const direct = yield* env("QWBE_DATABASE_URL")
  if (Option.isSome(direct)) return direct
  const password = yield* env("QWBE_PG_PASSWORD")
  if (Option.isNone(password)) return Option.none()
  const url = new URL("postgres://localhost/postgres")
  url.hostname = Option.getOrElse(yield* env("QWBE_PG_HOST"), () => "localhost")
  url.port = Option.getOrElse(yield* env("QWBE_PG_PORT"), () => "5433")
  url.username = Option.getOrElse(yield* env("QWBE_PG_USER"), () => "postgres")
  url.password = password.value
  return Option.some(url.toString())
})

/** For tests and tools that cannot run without a database: the URL, or a refusal naming the fix. */
export const requireDatabaseUrl: Effect.Effect<URL, DbUrlMissing | ConfigError.ConfigError> = Effect.flatMap(
  databaseUrl,
  Option.match({
    onNone: () => Effect.fail(new DbUrlMissing({ message: "set QWBE_PG_PASSWORD in the environment (no password default)" })),
    onSome: (url) => Effect.succeed(new URL(url)),
  }),
)
