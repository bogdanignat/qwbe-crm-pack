// The contact-group index tool as a real node process, in rebuilt layouts: the exit CODE is the
// assertion. Two things only a spawned process can prove:
//   * a declaration the tool cannot render is refused with exit 2 BEFORE any connection is opened;
//   * the tool runs in an INSTALLED layout, where `qwbe-core` sits in node_modules and node refuses to
//     strip its types -- the layout of the incident the tool exists for (see invariant.ts).
// Each sandbox holds the tool's whole import closure, in its own layout, and links the packages it
// needs. The child's environment is REPLACED, never inherited, so an ambient QWBE_DATABASE_URL cannot
// turn a test that should refuse into one that dials a real server.
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import * as Command from "@effect/platform/Command"
import * as FileSystem from "@effect/platform/FileSystem"
import * as NodeContext from "@effect/platform-node/NodeContext"
import { describe, expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Stream from "effect/Stream"
import { NAME_INDEX } from "../../cubes/crm/contact-groups/invariant.ts"

// From this file's own URL, never `process.cwd()`: a wrong root would build an EMPTY layout that "passes".
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const TOOL = "tools/db/ensure-contact-group-indexes.ts"
const INVARIANT = "cubes/crm/contact-groups/invariant.ts"
/** Linked even when the closure does not name them: what the tool's own imports load in turn. */
const PACKAGES = ["pg", "effect", "@effect/platform", "@effect/platform-node", "@effect/platform-node-shared"]
/** Value imports and re-exports; `import type` is erased by node and loads nothing. */
const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm

/** Every file the tool loads (relative to ROOT) and every package it names, followed from TOOL. */
const closure = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const files = new Set<string>()
  const packages = new Set(PACKAGES)
  const visit = (file: string): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      if (files.has(file)) return
      files.add(file)
      for (const [, spec] of (yield* fs.readFileString(join(ROOT, file))).matchAll(IMPORT)) {
        if (spec === undefined || spec.startsWith("node:")) continue
        if (spec.startsWith(".")) yield* visit(join(dirname(file), spec))
        else packages.add(spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"))
      }
    })
  yield* visit(TOOL)
  return { files: [...files], packages: [...packages] }
})

/** A `mkdtemp` directory under the OS tmpdir, removed when the test's scope closes. */
const sandbox = (prefix: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.acquireRelease(fs.makeTempDirectory({ directory: tmpdir(), prefix }), (dir) =>
      Effect.ignore(fs.remove(dir, { recursive: true }))))

/** The tool's closure copied into `dir` at the same paths, its packages linked from this checkout. */
const stage = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { files, packages } = yield* closure
    yield* fs.writeFileString(join(dir, "package.json"), JSON.stringify({ name: "p", type: "module", private: true }))
    for (const file of files) {
      yield* fs.makeDirectory(dirname(join(dir, file)), { recursive: true })
      yield* fs.copyFile(join(ROOT, file), join(dir, file))
    }
    for (const name of packages) {
      yield* fs.makeDirectory(dirname(join(dir, "node_modules", name)), { recursive: true })
      yield* fs.symlink(join(ROOT, "node_modules", name), join(dir, "node_modules", name))
    }
  })

/** `node argv` in `dir` with only PATH, HOME and `env`: status, stdout, stderr. Never fails on a code. */
const runNode = (dir: string, argv: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
  Effect.scoped(
    Effect.flatMap(
      Command.start(
        Command.make(process.execPath, ...argv).pipe(
          Command.workingDirectory(dir),
          Command.stdin(Stream.empty),
          Command.env({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? dir, NODE_OPTIONS: "", ...env }, { extendEnv: false }),
        ),
      ),
      (child) =>
        Effect.all(
          {
            status: child.exitCode,
            stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
            stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          },
          { concurrency: "unbounded" },
        ),
    ),
  ).pipe(Effect.timeout("120 seconds"))

layer(NodeContext.layer, { timeout: 180_000, excludeTestServices: true })((it) => {
  describe("ensure-contact-group-indexes, the declaration it refuses to render", () => {
    it.effect("exits 2 on an unrenderable declaration, without opening a connection", () =>
      Effect.scoped(
        Effect.gen(function* () {
          // The tool, with a leaf that declares a predicate it cannot render, and an unreachable URL:
          // exit 2 with the declaration's sentence proves the gate ran BEFORE any connection.
          const fs = yield* FileSystem.FileSystem
          const dir = yield* sandbox("cgidx-spec-")
          yield* stage(dir)
          yield* fs.writeFileString(
            join(dir, INVARIANT),
            `export const CUBE = "crm/contact-groups"\n` +
              `export const SCHEMA = CUBE.replace(/\\//g, "--")\n` +
              `export const UNIQUE_INDEXES = [{ table: "contact_groups", index: "${NAME_INDEX}", ` +
              `keys: [{ body: "name", normalize: "lower-btrim" }], rows: "all" }]\n`,
          )
          const run = yield* runNode(dir, [TOOL], { QWBE_DATABASE_URL: "postgres://nobody:nobody@127.0.0.1:1/nope" })
          expect(run.status, run.stderr + run.stdout).toBe(2)
          expect(run.stderr).toMatch(/refusing to render the cube's declaration/)
          expect(run.stderr).toMatch(/rows "all"/)
          expect(run.stderr, "it must refuse before it dials the database").not.toMatch(/ECONNREFUSED|nope|could not finish/)
        })))
  })

  describe("ensure-contact-group-indexes, in an INSTALLED layout", () => {
    // qwbe-core is COPIED under node_modules, not linked: node resolves a link to its real path,
    // outside node_modules, and the strip-types restriction would not apply -- the test would prove nothing.
    const installed = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const core = yield* fs.realPath(join(ROOT, "node_modules/qwbe-core"))
      const dir = yield* sandbox("cgidx-installed-")
      yield* stage(dir)
      yield* fs.copy(join(ROOT, "cubes/crm/contact-groups"), join(dir, "cubes/crm/contact-groups"), { overwrite: true })
      yield* fs.makeDirectory(join(dir, "node_modules/qwbe-core"), { recursive: true })
      yield* fs.copyFile(join(core, "package.json"), join(dir, "node_modules/qwbe-core/package.json"))
      yield* fs.copy(join(core, "src"), join(dir, "node_modules/qwbe-core/src"))
      return dir
    })

    it.effect("runs with qwbe-core inside node_modules -- where importing the cube's service would die", (ctx) =>
      Effect.scoped(
        Effect.gen(function* () {
          const built = yield* Effect.either(installed)
          // A packed install or a partial clone: skipping is honest, asserting on an unbuilt layout is not.
          if (Either.isLeft(built)) return ctx.skip(`could not build the installed layout: ${String(built.left)}`)
          const dir = built.right
          const fs = yield* FileSystem.FileSystem

          // The counterfactual FIRST: the failure the leaf was introduced to remove.
          yield* fs.writeFileString(
            join(dir, "tools/probe-service.ts"),
            `import { NAME_INDEX } from "../cubes/crm/contact-groups/service.ts"\nconsole.log(NAME_INDEX)\n`,
          )
          const viaService = yield* runNode(dir, ["tools/probe-service.ts"])
          expect(viaService.status, "importing service.ts under node_modules must still fail here").toBe(1)
          expect(viaService.stderr).toMatch(/ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/)
          expect(viaService.stderr).toMatch(/node_modules\/qwbe-core/)

          // The tool itself, reading the SAME invariant through the type-only leaf, loads and runs.
          const help = yield* runNode(dir, [TOOL, "--help"])
          expect(help.status, help.stderr).toBe(0)
          expect(help.stdout).toMatch(/ensure-contact-group-indexes/)

          // ...and it is the real tool: the declaration gate runs and the missing URL is bad input.
          const noUrl = yield* runNode(dir, [TOOL])
          expect(noUrl.status, noUrl.stderr).toBe(2)
          expect(noUrl.stderr).toMatch(/refusing to guess the database/)
        })))
  })
})
