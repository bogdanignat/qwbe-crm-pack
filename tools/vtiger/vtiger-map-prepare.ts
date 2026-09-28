// The preconditions of the vtiger import, each checked before the first row is written: a
// mapping that names its cube and table, a list route the session can read, and the unique
// index on externalId in the database.
import * as FileSystem from "@effect/platform/FileSystem"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import pg from "pg"
import { ensureExternalIdIndex, indexName, schemaOf } from "../db/ensure-external-id-index.ts"
import { call, type Session } from "../shared/api-client.ts"
import { Refused } from "../shared/run-tool.ts"
import { MapFile } from "./vtiger-map-pure.ts"

class MappingInvalid extends Data.TaggedError("MappingInvalid")<{ readonly message: string }> {}

/** The decoded mapping file; Refused (exit 2) when it does not declare its cube and table. */
export const readMapping = (mappingPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const m = yield* Effect.mapError(
      Effect.flatMap(fs.readFileString(mappingPath), Schema.decodeUnknown(MapFile)),
      (e) => new MappingInvalid({ message: `mapping ${mappingPath}: ${e.message}` }),
    )
    if (!m.cube || !m.table) {
      const message = 'the mapping must declare "cube" and "table": the unique index lives on the cube\'s own table'
      return yield* new Refused({ message, code: 2 })
    }
    return { ...m, cube: m.cube, table: m.table }
  })

/** The kernel creates the cube's table on first use; one list request also proves the read right. */
const touchRoute = (s: Session, route: string) =>
  Effect.flatMap(call(s.base, `${route}?limit=1`, { token: s.token }), ({ status }) =>
    status < 300
      ? Effect.void
      : new Refused({ message: `cannot read ${route}: HTTP ${status} -- the list request creates the table the index needs`, code: 1 }))

/** The one database write this tool ever makes: the partial unique index on externalId. */
const ensureIndex = (db: string, cube: string, table: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new pg.Pool({ connectionString: db, max: 1 })),
    (pool) => Effect.promise(() => pool.end()),
  ).pipe(
    Effect.flatMap((pool) => ensureExternalIdIndex(pool, schemaOf(cube), table)),
    Effect.scoped,
    Effect.mapError((e) => new Refused({ message: `could not ensure the unique index on ${cube}: ${e.message}`, code: 1 })),
  )

/** Readies the cube for writes (its table, then the index on it) and prints the index line. */
export const prepareTarget = (s: Session, db: string, target: { readonly route: string; readonly cube: string; readonly table: string }) =>
  Effect.gen(function* () {
    yield* touchRoute(s, target.route)
    const state = yield* ensureIndex(db, target.cube, target.table)
    yield* Console.log(`index:      ${schemaOf(target.cube)}.${target.table} (${indexName(target.table)}) ${state}`)
  })
