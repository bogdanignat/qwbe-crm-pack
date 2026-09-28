#!/usr/bin/env node
// Maps an exported vtiger JSONL file into crm/organizations / crm/contacts through the qwbe API.
// The staging set (optional --set) is only the row-count cross-check: the rows come from the
// same export file that fed the set.
//
// Idempotency: every row carries `externalId: "vtiger:<vtigerId>"` and the DATABASE holds a
// unique index on it (tools/db/ensure-external-id-index.ts, ensured here before the first write).
// Each row is looked up through the list's `?externalId=` filter: PATCHed when there, POSTed
// when not. No ledger file: a run killed at half and rerun ends with one row per identity.
// Contacts get organizationId from vtiger's accountid, looked up the same way (cached for the
// run); an organization not in qwbe is COUNTED, never quoted, and organizationId stays null.
//
// Exit code: 0; 1 when the rejected rows (errors, skipped, no key) exceed --max-rejects
// (default 0), or on a failed login, table read or index; 2 on usage or refusal. The LAST line
// always carries the rejected count. No row value is ever printed.
//
// Environment: QWBE_URL, QWBE_USER, QWBE_PASSWORD (credentials required, exit 2 without), and
// QWBE_DATABASE_URL or QWBE_PG_PASSWORD (plus optional QWBE_PG_HOST/PORT/USER) for the index.
// The input must live under QWB50_EXPORT_DIR (default <repo>/.local/vtiger-export);
// QWB50_TEST_UNSAFE_INPUT=1 lifts that for tests.
//
// Usage: node tools/vtiger/vtiger-map.ts <file.jsonl> <mapping.json> [--set <setId>] [--max-rejects <n>]

import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as Path from "@effect/platform/Path"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { databaseUrl } from "../db/db-url.ts"
import { call, type Session } from "../shared/api-client.ts"
import { printLines, Refused, runTool } from "../shared/run-tool.ts"
import { exportDir, fileLines } from "./export-files.ts"
import { qwbeEnv, sessionOf } from "./qwbe-env.ts"
import { prepareTarget, readMapping } from "./vtiger-map-prepare.ts"
import { importRows } from "./vtiger-map-rows.ts"
import {
  type MapArgs, mapArgs, type MapFile, rejectedOf, SetState, stagingLines, summaryLines, type Tally, USAGE,
} from "./vtiger-map-pure.ts"

const UnsafeInput = Config.string("QWB50_TEST_UNSAFE_INPUT").pipe(Config.withDefault(""))

// No customer-derived file may land inside the repository: the input must live under the
// export directory (.local/, git-ignored). Tests opt out explicitly.
const guardInput = (file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const dir = yield* exportDir
    if ((yield* Effect.orDie(UnsafeInput)) === "1" || path.resolve(file).startsWith(dir + path.sep)) return
    return yield* new Refused({ message: `refusing input outside ${dir}: customer files never enter the repository`, code: 2 })
  })

const requireDatabase = Effect.orElseSucceed(databaseUrl, () => Option.none<string>()).pipe(
  Effect.flatMap(Option.match({
    onSome: Effect.succeed,
    onNone: () =>
      new Refused({
        message: "set QWBE_DATABASE_URL, or QWBE_PG_PASSWORD (plus optional QWBE_PG_HOST/PORT/USER): " +
          "the unique index on externalId must be ensured in the database before any row is written",
        code: 2,
      }),
  })),
)

// The staging set is only the row-count cross-check; an unreadable set prints nothing.
const stagingCheck = (s: Session, setId: string, seen: number) =>
  Effect.flatMap(call(s.base, `/staging/sets/${setId}`, { token: s.token }), ({ status, body }) =>
    printLines(Option.match(status < 300 ? Schema.decodeUnknownOption(SetState)(body) : Option.none(), {
      onNone: () => [],
      onSome: (state) => stagingLines(setId, state, seen),
    })))

/** The run's counts, the staging cross-check, and last, always, how many rows the run refused
 *  and the threshold it was judged by; the exit code. */
const report = (s: Session, m: MapFile, tally: Tally, args: Pick<MapArgs, "setId" | "maxRejects">) =>
  Effect.gen(function* () {
    yield* printLines(summaryLines(m, tally))
    if (args.setId !== undefined) yield* stagingCheck(s, args.setId, tally.seen)
    const rejected = rejectedOf(tally)
    yield* Console.log(`rejected:   ${rejected} of ${tally.seen} row(s) (max accepted: ${args.maxRejects})`)
    return rejected > args.maxRejects ? 1 : 0
  })

const main = Effect.gen(function* () {
  const args = yield* Effect.orElseFail(mapArgs(process.argv.slice(2)), () => new Refused({ message: USAGE, code: 2 }))
  yield* guardInput(args.file)
  const env = yield* qwbeEnv
  const db = yield* requireDatabase
  const s = yield* sessionOf(env)
  const m = yield* readMapping(args.mappingPath)
  yield* prepareTarget(s, db, m)
  return yield* report(s, m, yield* importRows(s, m, fileLines(args.file)), args)
}).pipe(Effect.provide(FetchHttpClient.layer))

runTool(main, "vtiger-map failed: ")
