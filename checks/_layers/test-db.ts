import { randomBytes } from "node:crypto"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Client } from "pg"
import { requireDatabaseUrl } from "../../tools/db/db-url.ts"
import { dropThrowawayDb } from "../../tools/db/drop-throwaway-db.ts"

// qwbe's own layer imports src/pg/test-db.ts from the kernel; a pack cannot reach into qwbe
// internals, so it creates and drops the throwaway with its own tools (db-url.ts, drop-throwaway-db.ts).
export class TestDbUnavailable extends Data.TaggedError("TestDbUnavailable")<{ readonly cause: unknown }> {
  override get message() {
    return `could not create a test database (is Postgres up? set QWBE_PG_PASSWORD): ${String(this.cause)}`
  }
}

/** A throwaway Postgres database for one test file. */
export class TestDb extends Context.Tag("TestDb")<TestDb, { readonly url: string }>() {}

const missing = (cause: unknown) => new TestDbUnavailable({ cause })

// Bounded: a Postgres out of connections must fail this layer before vitest kills the worker,
// or the finalizers that stop servers and drop databases never run. The admin client itself is
// acquired, and its release ends it: an open client would keep the node process alive forever.
const connect = Effect.acquireRelease(
  Effect.gen(function* () {
    const adminUrl = yield* Effect.mapError(requireDatabaseUrl, missing)
    adminUrl.pathname = "/postgres"
    const admin = new Client({ connectionString: adminUrl.toString() })
    yield* Effect.tryPromise({ try: () => admin.connect(), catch: missing })
    return admin
  }),
  (admin) => Effect.promise(() => admin.end()).pipe(Effect.timeout("5 seconds"), Effect.ignore),
).pipe(Effect.timeoutFail({ duration: "20 seconds", onTimeout: () => missing("timed out") }))

const drop = (admin: Client, name: string) => dropThrowawayDb(admin, name).pipe(Effect.timeout("20 seconds"), Effect.ignore)

/** Creates `qwbe_check_<label>_<random>` and drops it WITH (FORCE) when the scope closes. */
export const testDb = (label: string) =>
  Layer.scoped(
    TestDb,
    Effect.gen(function* () {
      const admin = yield* connect
      const name = `qwbe_check_${label}_${randomBytes(4).toString("hex")}`
      yield* Effect.tryPromise({ try: () => admin.query(`CREATE DATABASE "${name}"`), catch: missing })
      const url = yield* Effect.mapError(requireDatabaseUrl, missing)
      url.pathname = `/${name}`
      // Finalizers run in reverse: the drop first, then the client ends.
      yield* Effect.addFinalizer(() => drop(admin, name))
      return { url: url.toString() }
    }),
  )