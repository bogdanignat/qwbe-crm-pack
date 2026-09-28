// The two processes the SDK check spawns (T-1452, B4): `npm run build` in the kernel when core/dist
// is absent, and `node <bin> check <dir>`. The checker's output is relayed, not summarised, but only
// after the WHOLE capture went through `redactSecrets`: redacting chunk by chunk would let a secret
// split across two chunks through.
import { join } from "node:path"
import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { withoutAllowScripts } from "../tools/shared/process-pure.ts"
import { redactSecrets } from "./sdk-check-env.ts"

const TIMEOUT = "300 seconds"

/** How a child ended: `status` is null when a signal ended it, as spawnSync reported it. */
export type Run = { readonly status: number | null; readonly signal: string | undefined; readonly stdout: string; readonly stderr: string }

export class BuildFailed extends Data.TaggedError("BuildFailed")<{ readonly run: Run }> {
  override get message() {
    return `core/dist build failed (exit ${this.run.status})\n${this.run.stdout}${this.run.stderr}`
  }
}

// The executor's exitCode fails when a signal ended the child; the signal is only in its text.
type Ending = Pick<Run, "status" | "signal">

const ended = (proc: CommandExecutor.Process) =>
  proc.exitCode.pipe(
    Effect.map((code): Ending => ({ status: code, signal: undefined })),
    Effect.catchAll((error) =>
      Effect.succeed<Ending>({ status: null, signal: /signal: (\w+)/.exec(error.message)?.[1] ?? "unknown" }),
    ),
  )

// Every chunk is appended as it arrives, so a timeout still reports what was printed before it.
const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Effect.gen(function* () {
    const text = yield* Ref.make("")
    const fiber = yield* stream.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Ref.update(text, (all) => all + chunk)),
      Effect.ignore,
      Effect.forkScoped,
    )
    return Fiber.join(fiber).pipe(Effect.timeout("5 seconds"), Effect.ignore, Effect.zipRight(Ref.get(text)))
  })

// SIGTERM to the child's process group, SIGKILL after a grace period; then the real ending is read.
const stopAfterTimeout = (proc: CommandExecutor.Process) =>
  proc.kill("SIGTERM").pipe(
    Effect.timeout("7 seconds"),
    Effect.catchAll(() => proc.kill("SIGKILL")),
    Effect.ignore,
    Effect.zipRight(ended(proc)),
  )

const capture = (argv: readonly [string, ...string[]], cwd: string, env: Readonly<Record<string, string | undefined>>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const command = Command.make(...argv).pipe(
        Command.workingDirectory(cwd),
        Command.env(withoutAllowScripts(env), { extendEnv: false }),
        Command.stdin(Stream.empty),
      )
      const proc = yield* Command.start(command)
      const [stdout, stderr] = [yield* collect(proc.stdout), yield* collect(proc.stderr)]
      const end = yield* ended(proc).pipe(
        Effect.timeout(TIMEOUT),
        Effect.catchTag("TimeoutException", () => stopAfterTimeout(proc)),
      )
      return { ...end, stdout: yield* stdout, stderr: yield* stderr } satisfies Run
    }),
  )

/** An installed kernel boots from dist/ (no type stripping under node_modules): a prerequisite. */
export const buildDist = (core: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (yield* fs.exists(join(core, "dist", "cube-contract.js"))) return "already built"
    const run = yield* capture(["npm", "run", "build"], core, process.env)
    if (run.status !== 0) return yield* new BuildFailed({ run })
    return "built now"
  })

/** `node <bin> check <dir>`, from `dir`, with exactly the environment `checkEnv` derived. */
export const runCheck = (bin: string, dir: string, env: Readonly<Record<string, string>>) =>
  capture([process.execPath, bin, "check", dir], dir, env)

/** Relays one run through the redactor and returns its status (null when a signal ended it). */
export const report = (label: string, bin: string, run: Run, secrets: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* Console.log(`\n===== [${label}] node ${bin} check <dir> =====`)
    yield* Effect.sync(() => process.stdout.write(redactSecrets(run.stdout, secrets)))
    if (run.stderr) yield* Effect.sync(() => process.stderr.write(redactSecrets(run.stderr, secrets)))
    yield* Console.log(`----- [${label}] exit ${run.status}${run.signal ? ` (signal ${run.signal})` : ""} -----`)
    return run.status
  })
