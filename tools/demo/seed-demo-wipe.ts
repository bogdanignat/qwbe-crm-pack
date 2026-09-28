// The wipe: demo rows out of Postgres (no DELETE endpoints exist on the cubes), demo definitions
// soft-deleted through the API (keeps the kernel's snapshot fresh). Only demo-marked rows are
// touched: anything a human or the vtiger import created survives and is reported.
import * as Arr from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import pg from "pg"
import { query } from "../db/query.ts"
import { type Api, Defs, defsPath } from "./seed-demo-api.ts"
import { DEF_CUBES, DEMO_PREFIX } from "./seed-demo-fields.ts"
import { demoContractTitles } from "./seed-demo-pure.ts"

export class SeedFailed extends Data.TaggedError("SeedFailed")<{ readonly message: string }> {}

const CUBES = [
  { name: "contracts", table: `"crm--contracts".contracts`, where: `body->>'title' = ANY($1)`, marker: () => demoContractTitles() },
  { name: "contacts", table: `"crm--contacts".contacts`, where: `body->>'externalId' LIKE $1`, marker: () => `${DEMO_PREFIX}contact:%` },
  { name: "organizations", table: `"crm--organizations".organizations`, where: `body->>'externalId' LIKE $1`, marker: () => `${DEMO_PREFIX}organization:%` },
] as const

const Count = Schema.Tuple(Schema.Struct({ n: Schema.Number }))

const leftover = (pool: pg.Pool, table: string) =>
  Effect.flatMap(query(pool, `SELECT count(*)::int AS n FROM ${table}`), (r) =>
    Effect.mapError(
      Schema.decodeUnknown(Count)(r.rows),
      () => new SeedFailed({ message: `count of ${table}: reply does not have the expected shape` }),
    ))

/** Deletes the demo rows (contracts, contacts, organizations, in that order) on a one-connection
 *  pool; per cube, the deleted count and the rows left. The pool lives only for the wipe. */
export const wipeDemoRows = (databaseUrl: string) =>
  Effect.scoped(Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new pg.Pool({ connectionString: databaseUrl, max: 1 })),
      (pool) => Effect.promise(() => pool.end()),
    )
    const deleted = yield* Effect.forEach(CUBES, (cube) =>
      Effect.map(query(pool, `DELETE FROM ${cube.table} WHERE ${cube.where} RETURNING id`, [cube.marker()]), (r) =>
        ({ cube, deleted: r.rowCount ?? 0 })))
    // Deleted child-first, reported parent-first (organizations, contacts, contracts).
    return yield* Effect.forEach(Arr.reverse(deleted), ({ cube, deleted }) =>
      Effect.map(leftover(pool, cube.table), ([{ n }]) => [cube.name, { deleted, left: n }] as const))
  }))

/** Soft-deletes every live demo definition through the API; returns how many. */
export const wipeDemoDefs = (api: Api) =>
  Effect.gen(function* () {
    const demoNames = new Set(DEF_CUBES.flatMap(([, fields]) => fields.map((f) => f.name)))
    const pages = yield* Effect.forEach(DEF_CUBES, ([cube]) => api(Defs, defsPath(cube)))
    const doomed = pages.flatMap((page) => page.rows.filter((d) => !d.deleted && demoNames.has(d.name)))
    yield* Effect.forEach(doomed, (def) => api(Schema.Unknown, `/customfields/${def.id}`, { method: "DELETE" }), { discard: true })
    return doomed.length
  })
