import * as Command from "@effect/platform/Command"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

// A step is a command to run.
export type Step = readonly [string, ...string[]]

// A POSIX exit status is one byte; the executor's number is decoded, never trusted.
const ExitStatus = Schema.Int.pipe(Schema.between(0, 255))

// stdin is an empty stream, so the child reads end-of-file at once instead of waiting on the
// executor's default pipe, which nobody writes or closes.
const capture = (argv: readonly [string, ...string[]], cwd: string) =>
  Effect.scoped(
    Effect.flatMap(
      Command.start(
        Command.make(...argv).pipe(Command.workingDirectory(cwd), Command.stdin(Stream.empty)),
      ),
      (child) =>
        Effect.all(
          {
            status: Effect.flatMap(child.exitCode, Schema.decodeUnknown(ExitStatus)),
            stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
            stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          },
          { concurrency: "unbounded" },
        ),
    ),
  )

const TAIL_LINES = 20

// A red command's whole output is noise; the tail has the error and the lines that led to it.
export const tail = (output: string) => {
  const lines = output.split("\n")
  return lines.length <= TAIL_LINES ? output : lines.slice(-TAIL_LINES).join("\n")
}

const commandFindings = (root: string, argv: readonly [string, ...string[]]) =>
  Effect.map(capture(argv, root), ({ status, stdout, stderr }) =>
    status === 0 ? [] : [`${argv.join(" ")} exited ${status}\n${tail(stdout + stderr)}`],
  )

// Every step runs even after one fails, so one red step never hides the next.
export const gateFindings = (root: string, steps: ReadonlyArray<Step>) =>
  Effect.map(Effect.forEach(steps, (step) => commandFindings(root, step)), (lists) => lists.flat())
