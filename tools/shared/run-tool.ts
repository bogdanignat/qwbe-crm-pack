import * as NodeContext from "@effect/platform-node/NodeContext"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

/** A deliberate stop (usage, refusal): the message goes to stderr as is and the tool exits `code`. */
export class Refused extends Data.TaggedError("Refused")<{ readonly message: string; readonly code: 1 | 2 }> {}

/** Prints each line on stdout, in order. */
export const printLines = (lines: ReadonlyArray<string>) => Effect.forEach(lines, (line) => Console.log(line), { discard: true })

// The last line of every entry point: the program's number becomes the exit code; a Refused prints
// its message and exits with its code; any other failure prints its message after `label` and exits 1.
export const runTool = <E extends { readonly message: string }>(
  program: Effect.Effect<number, E, NodeContext.NodeContext>,
  label = "",
) =>
  program.pipe(
    Effect.catchAll((error) =>
      error instanceof Refused
        ? Effect.as(Console.error(error.message), error.code)
        : Effect.as(Console.error(`${label}${error.message}`), 1)),
    Effect.tap((code) => Effect.sync(() => (process.exitCode = code))),
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain,
  )
