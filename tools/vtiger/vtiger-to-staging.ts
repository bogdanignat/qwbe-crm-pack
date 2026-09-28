#!/usr/bin/env node
// Uploads a vtiger export (JSON Lines) into a qwbe staging set, in chunks.
//
// The file is read as a Stream of lines, grouped into whole-line chunks under the cap
// (vtiger-to-staging-pure.ts) and posted one at a time: never a partial line, never the whole
// file in memory.
//
// Environment: QWBE_URL (default http://127.0.0.1:4500), QWBE_USER and QWBE_PASSWORD
// (both required -- the tool exits 2 without them, no default credentials).
//
// Usage: node tools/vtiger/vtiger-to-staging.ts <file.jsonl> [setName]
// Prints: the set id, the row count and the malformed count. Never a row value.
// On a failed chunk it prints the absolute line range, the set id and the HTTP status,
// and exits 1, so the operator can resume from a known line.

import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as Path from "@effect/platform/Path"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { printLines, Refused, runTool } from "../shared/run-tool.ts"
import { fileLines } from "./export-files.ts"
import { qwbeEnv, sessionOf } from "./qwbe-env.ts"
import { uploadSet } from "./vtiger-to-staging-api.ts"
import { Args, maxChars, setName, uploadLines, USAGE } from "./vtiger-to-staging-pure.ts"

const args = Effect.orElseFail(
  Schema.decodeUnknownOption(Args)(process.argv.slice(2)),
  () => new Refused({ message: USAGE, code: 2 }),
)
const maxChunkChars = Effect.map(Effect.orDie(Config.string("QWB50_MAX_CHARS").pipe(Config.withDefault(""))), maxChars)

const main = Effect.gen(function* () {
  const [file, name] = yield* args
  const s = yield* Effect.flatMap(qwbeEnv, sessionOf)
  const sourceFile = (yield* Path.Path).basename(file)
  const run = yield* uploadSet(s, setName(sourceFile, name), sourceFile, fileLines(file), yield* maxChunkChars)
  yield* printLines(uploadLines(run.setId, run.state, run.totals, run.oversized))
  return run.oversized === 0 ? 0 : 1
}).pipe(Effect.provide(FetchHttpClient.layer))

runTool(main, "vtiger-to-staging failed: ")
