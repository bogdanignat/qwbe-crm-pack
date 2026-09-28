// Entry point: `node tools/check/check.ts [--live] [--drift]`. Runs every gate, exit 1 if any is
// red. `--live` adds the checks against real servers, `--drift` the source comparison.
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import { flagsFrom } from "../shared/args.ts"
import { runTool } from "../shared/run-tool.ts"
import { gatesFor } from "./gates.ts"
import { exitCodeFor, runGates } from "./run-gates.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

const gates = Effect.map(flagsFrom(process.argv.slice(2)), ({ live, drift }) =>
  gatesFor(root, live, drift),
)

runTool(gates.pipe(Effect.flatMap(runGates), Effect.map(exitCodeFor)))
