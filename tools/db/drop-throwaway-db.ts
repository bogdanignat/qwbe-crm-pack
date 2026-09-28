// Drops a throwaway test database only once its last backend is really gone (QWB-72).
//
// pg-pool's end() resolves before the client socket has closed, so a DROP DATABASE ... WITH (FORCE)
// issued straight after it races the file's OWN closing backend. When FORCE wins, the FATAL
// "terminating connection due to administrator command" lands on the still-open socket, the pool
// emits 'error' with nobody listening, and node:test reports the file as "test failed" after every
// test in it passed -- only under load (the full suite), never when the file runs alone.
// Waiting for pg_stat_activity to drain removes the race; FORCE stays only as the last resort.
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import type { Client, Pool } from "pg"
import { type DbFailed, query } from "./query.ts"

const backends = (admin: Client | Pool, dbName: string) =>
  Effect.map(
    query<{ n: number }>(admin, "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", [dbName]),
    ({ rows }) => rows[0]?.n ?? 0,
  )

/** At most 40 looks, 50 ms apart, for the last backend to leave; then the drop, FORCE as the last resort. */
export const dropThrowawayDb = (admin: Client | Pool, dbName: string): Effect.Effect<void, DbFailed> =>
  backends(admin, dbName).pipe(
    Effect.repeat({ schedule: Schedule.spaced("50 millis"), until: (n) => n === 0, times: 39 }),
    Effect.zipRight(query(admin, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)),
    Effect.asVoid,
  )
