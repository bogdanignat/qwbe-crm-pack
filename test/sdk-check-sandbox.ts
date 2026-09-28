// The publication-shaped copy `qwbe check` judges in the [sandbox] run (T-1452, B4), and the one
// path the runner may delete. The checkout is only READ: its package.json is rewritten in the copy.
// The kernel goes under the copy's own node_modules as a REAL directory (the fixture shape
// probes/check-command.mjs proves): a symlinked package is the npm-link shape stage invocation must
// refuse, and the install fingerprint is taken on real files.
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { copyFilter, publicationPackageJson, SANDBOX_PREFIX } from "./sdk-check-pure.ts"

export class SandboxNotOwned extends Data.TaggedError("SandboxNotOwned")<{ readonly path: string }> {
  override get message() {
    return `sdk-check: REFUSING to remove ${this.path} -- it is not a sandbox this runner created`
  }
}

export class KernelIncomplete extends Data.TaggedError("KernelIncomplete")<{ readonly entry: string }> {
  override get message() {
    return `the kernel checkout is missing ${this.entry}`
  }
}

/** Exactly the kernel package.json `files` list; its node_modules is linked, never copied. */
const KERNEL_ENTRIES = ["bin", "src", "dist", "package.json", "qwbe.config.json"]

const PackageJson = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown }))

/**
 * May the runner delete this path? Only a directory it made: resolved under the OS temp directory
 * AND carrying the runner's prefix. Never a sandbox it merely found, never anything in a checkout.
 */
export const isOwnSandbox = (path: string | undefined) =>
  Effect.gen(function* () {
    if (typeof path !== "string" || path.length === 0) return false
    const fs = yield* FileSystem.FileSystem
    const real = yield* fs.realPath(path).pipe(Effect.orElseSucceed(() => resolve(path)))
    const base = yield* fs.realPath(tmpdir()).pipe(Effect.orElseSucceed(() => resolve(tmpdir())))
    return real.startsWith(base + sep) && (real.slice(base.length + 1).split(sep)[0] ?? "").startsWith(SANDBOX_PREFIX)
  })

/** Removes `path` only when `isOwnSandbox` says so; anything else fails loudly and stays on disk. */
export const removeOwnSandbox = (path: string) =>
  Effect.gen(function* () {
    if (!(yield* isOwnSandbox(path))) return yield* new SandboxNotOwned({ path })
    yield* (yield* FileSystem.FileSystem).remove(path, { recursive: true, force: true })
  })

// The copy is filtered like the .mjs cpSync filter was: nested node_modules never reach the install.
const installKernel = (fs: FileSystem.FileSystem, core: string, sandbox: string) =>
  Effect.gen(function* () {
    const dest = join(sandbox, "node_modules", "qwbe-core")
    yield* fs.makeDirectory(dirname(dest), { recursive: true })
    for (const entry of KERNEL_ENTRIES) {
      const from = join(core, entry)
      if (!(yield* fs.exists(from))) return yield* new KernelIncomplete({ entry })
      yield* fs.copy(from, join(dest, entry))
      const nested = (yield* fs.stat(from)).type === "Directory" ? yield* fs.readDirectory(from, { recursive: true }) : []
      for (const rel of nested.filter((p) => p.split(sep).at(-1) === "node_modules"))
        yield* fs.remove(join(dest, entry, rel), { recursive: true, force: true })
    }
    yield* fs.symlink(join(core, "node_modules"), join(dest, "node_modules"))
  })

/**
 * The sandbox, alive for the calling scope: top-level entries of `pack` that `copyFilter` keeps,
 * the publication package.json, the kernel installed. The scope's release goes through
 * `removeOwnSandbox`; a refusal is printed, never turned into a deletion.
 */
export const stageSandbox = (pack: string, core: string, sdkVersion: string | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const sandbox = yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: SANDBOX_PREFIX }), (dir) =>
      removeOwnSandbox(dir).pipe(Effect.catchAll((error) => Console.error(error.message))),
    )
    const keep = copyFilter(pack)
    for (const name of yield* fs.readDirectory(pack))
      if (keep(join(pack, name))) yield* fs.copy(join(pack, name), join(sandbox, name))
    const native = yield* Schema.decodeUnknown(PackageJson)(yield* fs.readFileString(join(pack, "package.json")))
    const publication = yield* publicationPackageJson(native, sdkVersion)
    yield* fs.writeFileString(join(sandbox, "package.json"), `${JSON.stringify(publication, null, 2)}\n`)
    yield* installKernel(fs, core, sandbox)
    return sandbox
  })
