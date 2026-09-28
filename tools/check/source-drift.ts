// Entry point: `QWBE_REPO=<qwbe> node tools/check/source-drift.ts`, or the `--drift` gate of
// `npm run check`. Every copy the kernel holds of this pack must provably be what this repo holds now.
//
// Two copies exist after an official install: the store shelf (core/store/crm-pack, carrying its
// qwbe-source.json provenance) and the installed destination (core/plugins/crm-pack, which strips
// the manifest and the provenance as bookkeeping). The shelf is judged by the kernel's own drift
// function - the one `qwbe drift` runs - plus the pack-side rule in source-drift-pure.ts. The
// destination is decided by fingerprint against the repo minus the stripped bookkeeping files.
// Exit 1 on any red: a stale copy above this repo makes every verdict about this pack false. An
// absent copy is not drift - the pack is simply not installed there.
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runTool } from "../shared/run-tool.ts"
import { ShelfDrift, shelfVerdict, summaryLine, verdictLine, type Verdict } from "./source-drift-pure.ts"

class DriftError extends Data.TaggedError("DriftError")<{ readonly message: string }> {}

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)))

type KernelEffect = Effect.Effect<unknown, unknown, FileSystem.FileSystem>
type Kernel = {
  readonly shelfDrift: (dir: string, name: string) => KernelEffect
  readonly packageSourceFingerprint: (dir: string, exclude: ReadonlyArray<string>) => KernelEffect
  readonly MANIFEST: string
  readonly PROVENANCE: string
}

const kernelFailure = (error: unknown) => new DriftError({ message: `source-drift: ${String(error)}` })

// The kernel sources of the checkout under test; a dynamic import, so their types are declared above.
const importKernel = (qwbe: string) =>
  Effect.tryPromise({
    try: async () => {
      const load = (name: string) => import(pathToFileURL(join(qwbe, "core", "src", name)).href) as Promise<object>
      return { ...(await load("store-drift.ts")), ...(await load("package-source.ts")) } as Kernel
    },
    catch: kernelFailure,
  })

const run = (check: KernelEffect) => Effect.mapError(check, kernelFailure)

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const qwbe = resolve(yield* Config.string("QWBE_REPO").pipe(Config.withDefault(join(repo, "..", "..", "qwbe"))))
  const kernel = yield* importKernel(qwbe)
  const repoReal = yield* fs.realPath(repo)
  const stripped = [kernel.MANIFEST, kernel.PROVENANCE] // bookkeeping the destination strips at install

  const shelf = join(qwbe, "core", "store", "crm-pack")
  const shelfResult: Verdict = (yield* fs.exists(shelf))
    ? shelfVerdict(yield* Schema.decodeUnknown(ShelfDrift)(yield* run(kernel.shelfDrift(shelf, "store/crm-pack"))), repoReal)
    : { name: "store/crm-pack", ok: true, detail: "not staged in this checkout" }

  const installed = join(qwbe, "core", "plugins", "crm-pack")
  const fingerprint = (dir: string) =>
    Effect.flatMap(run(kernel.packageSourceFingerprint(dir, stripped)), Schema.decodeUnknown(Schema.String))
  const fresh = (yield* fs.exists(installed))
    ? (yield* fingerprint(installed)) === (yield* fingerprint(repo))
    : undefined
  const installedResult: Verdict = {
    name: "plugins/crm-pack",
    ok: fresh !== false,
    detail:
      fresh === undefined
        ? "not installed in this checkout"
        : fresh
          ? "matches the repo"
          : "behind the repo - reinstall from this directory",
  }

  const verdicts = [shelfResult, installedResult]
  yield* Effect.forEach(verdicts, (verdict) => Console.log(verdictLine(verdict)))
  yield* Console.log(summaryLine(verdicts))
  return verdicts.every(({ ok }) => ok) ? 0 : 1
})

runTool(program)
