#!/usr/bin/env node
// Demo data for the local sandbox stack: 50 organizations, 50 contacts,
// 5 contracts, plus the custom fields they carry -- generated, never imported.
//
// The rule: dummy data is GENERATED, never committed; vtiger
// contributes only the STRUCTURE of the custom fields (names, types, required flags --
// read once from the real system's field definitions), never a row and never its picklist
// values. Every value is produced deterministically from a row index (seed-demo-pure.ts), so
// the same seed always yields the same sandbox: reruns fill what is missing and touch nothing
// that is already there (the idempotent-lookup pattern of the vtiger import, tools/vtiger/vtiger-map.ts).
//
// Usage:
//   node tools/demo/seed-demo.ts            create what is missing (defs first, then rows)
//   node tools/demo/seed-demo.ts --wipe     delete the demo rows and the demo field defs,
//                                           then build the whole set again
//
// Environment:
//   QWBE_API_URL        the kernel of the local stack (default http://localhost:4600)
//   QWBE_USER/PASSWORD  API credentials (default admin/admin -- the sandbox login)
//   QWBE_DATABASE_URL   required only by --wipe: there are no DELETE endpoints on the CRM
//                       cubes, so demo rows are removed directly in Postgres -- the exact
//                       connection the kernel itself runs with (core/src/pg/db.ts requires it).
//
// The custom values ride the target cubes' own API: the kernel folds defined custom keys
// into the row's `custom` sub-object (core/src/custom-values.ts), so no database write is
// needed on the way IN. Demo rows mark themselves with externalId "demo:..." -- the wipe
// deletes only marked rows, never anything a human or the vtiger import created.

import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { pathToFileURL } from "node:url"
import { printLines, Refused, runTool } from "../shared/run-tool.ts"
import { type Api, connect } from "./seed-demo-api.ts"
import { ensureDefs, ensureRows, totals } from "./seed-demo-ensure.ts"
import { defLines, rowLines, totalLines, wipeLines } from "./seed-demo-report.ts"
import { SeedFailed, wipeDemoDefs, wipeDemoRows } from "./seed-demo-wipe.ts"

const Flags = Schema.Array(Schema.Literal("--wipe"))

const Env = Config.all({
  apiUrl: Config.string("QWBE_API_URL").pipe(Config.withDefault("http://localhost:4600")),
  user: Config.string("QWBE_USER").pipe(Config.withDefault("admin")),
  password: Config.redacted("QWBE_PASSWORD").pipe(Config.withDefault(Redacted.make("admin"))),
  databaseUrl: Config.option(Config.redacted("QWBE_DATABASE_URL")),
})

const rebuildFlag = Effect.mapError(
  Schema.decodeUnknown(Flags)(process.argv.slice(2)),
  () => new Refused({ message: "usage: node tools/demo/seed-demo.ts [--wipe]", code: 2 }),
).pipe(Effect.map((flags) => flags.includes("--wipe")))

const requireDatabase = (databaseUrl: Option.Option<Redacted.Redacted>) =>
  Effect.orElseFail(databaseUrl, () =>
    new SeedFailed({ message: "refusing to guess the database: set QWBE_DATABASE_URL (the same one the kernel runs with)" }))

/** Demo rows out of Postgres, then the demo definitions out through the API. */
const wipe = (api: Api, databaseUrl: string) =>
  Effect.gen(function* () {
    yield* printLines(wipeLines(yield* wipeDemoRows(databaseUrl)))
    yield* Console.log(`wipe custom field defs: ${yield* wipeDemoDefs(api)} removed`)
  })

/** Definitions first, then the rows, then the cube totals; each step prints its counts. */
const fill = (api: Api) =>
  Effect.gen(function* () {
    yield* printLines(defLines(yield* ensureDefs(api)))
    yield* printLines(rowLines(yield* ensureRows(api)))
    yield* printLines(totalLines(yield* totals(api)))
  })

const main = Effect.gen(function* () {
  const rebuild = yield* rebuildFlag
  const env = yield* Effect.mapError(Env, (e) => new SeedFailed({ message: `config error: ${e.message}` }))
  const api = yield* connect(env.apiUrl, env.user, Redacted.value(env.password))
  if (rebuild) yield* wipe(api, Redacted.value(yield* requireDatabase(env.databaseUrl)))
  yield* fill(api)
  yield* Console.log(rebuild ? "sandbox rebuilt." : "sandbox up to date.")
  return 0
}).pipe(Effect.provide(FetchHttpClient.layer))

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTool(main, "seed-demo failed: ")
}
