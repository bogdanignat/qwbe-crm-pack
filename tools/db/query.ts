// The one query helper of tools/db, and the entry preamble the two db tools share: no database
// variable set means a refusal and exit 2, never a guessed default.
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import pg from "pg"
import { databaseUrl } from "./db-url.ts"

export class DbFailed extends Data.TaggedError("DbFailed")<{ readonly message: string }> {}

export const query = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  db: pg.Client | pg.Pool,
  text: string,
  values: ReadonlyArray<unknown> = [],
) =>
  Effect.tryPromise({
    try: () => db.query<R>(text, [...values]),
    catch: (error) => new DbFailed({ message: error instanceof Error ? error.message : String(error) }),
  })

/** Runs `use` on a one-connection pool to the configured database; exit 2 when none is configured. */
export const withDatabase = <E>(use: (db: pg.Pool) => Effect.Effect<number, E>) =>
  Effect.gen(function* () {
    const url = yield* Effect.orElseSucceed(databaseUrl, () => Option.none<string>())
    if (Option.isNone(url)) {
      yield* Console.error(
        "refusing to guess the database: set QWBE_DATABASE_URL, or QWBE_PG_PASSWORD (plus optional QWBE_PG_HOST/PORT/USER)",
      )
      return 2
    }
    const pool = Effect.acquireRelease(
      Effect.sync(() => new pg.Pool({ connectionString: url.value, max: 1 })),
      (db) => Effect.promise(() => db.end()),
    )
    return yield* Effect.scoped(Effect.flatMap(pool, use))
  })
