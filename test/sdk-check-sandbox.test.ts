// The cleanup guard and the staged shape (T-1452, B4): the runner deletes only a directory it made,
// and the sandbox it stages is the publication shape with the kernel as a REAL directory. Fixtures
// are real mkdtemp directories; afterAll removes only the ones this file created.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { afterAll, describe, expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { SANDBOX_PREFIX } from "./sdk-check-pure.ts"
import { isOwnSandbox, removeOwnSandbox, stageSandbox } from "./sdk-check-sandbox.ts"

const made: string[] = []
const mkdtemp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const files = (root: string, paths: Record<string, string>) => {
  for (const [path, body] of Object.entries(paths)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

layer(NodeFileSystem.layer)((it) => {
  describe("the cleanup guard", () => {
    it.effect("accepts only a directory carrying this runner's prefix under the OS temp dir", () =>
      Effect.gen(function* () {
        const mine = mkdtemp(SANDBOX_PREFIX)
        expect(yield* isOwnSandbox(mine)).toBe(true)
        // A file inside it is also inside a sandbox this runner owns.
        expect(yield* isOwnSandbox(join(mine, "cubes"))).toBe(true)
      }))

    it.effect("refuses a foreign temp directory, a checkout, the temp root itself and nonsense", () =>
      Effect.gen(function* () {
        expect(yield* isOwnSandbox(mkdtemp("someone-elses-"))).toBe(false)
        expect(yield* isOwnSandbox(tmpdir())).toBe(false)
        expect(yield* isOwnSandbox(process.cwd())).toBe(false)
        expect(yield* isOwnSandbox(sep)).toBe(false)
        expect(yield* isOwnSandbox(join(process.cwd(), `${SANDBOX_PREFIX}faked`))).toBe(false)
        expect(yield* isOwnSandbox("")).toBe(false)
        expect(yield* isOwnSandbox(undefined)).toBe(false)
      }))

    it.effect("a refused path is reported and stays on disk", () =>
      Effect.gen(function* () {
        const foreign = mkdtemp("someone-elses-")
        const error = yield* Effect.flip(removeOwnSandbox(foreign))
        expect(error.message).toMatch(/REFUSING to remove .* not a sandbox this runner created/)
        expect(lstatSync(foreign).isDirectory()).toBe(true)
      }))
  })

  describe("the staged sandbox", () => {
    it.effect("is the publication shape with the kernel installed as a real directory, removed on scope close", () =>
      Effect.gen(function* () {
        const pack = files(mkdtemp("sdk-check-pack-"), {
          "package.json": JSON.stringify({ name: "p", dependencies: { "qwbe-core": "file:../core" }, devDependencies: { x: "1" } }),
          "cubes/crm/index.ts": "export {}",
          "test/sdk-check.ts": "runner",
          ".git/HEAD": "ref",
          "shot.png": "png",
        })
        const core = files(mkdtemp("sdk-check-core-"), {
          "bin/qwbe.mjs": "bin",
          "src/main.ts": "src",
          "src/nested/node_modules/dep/index.js": "nested",
          "dist/cube-contract.js": "dist",
          "package.json": "{}",
          "qwbe.config.json": "{}",
          "node_modules/dep/index.js": "dep",
          "scripts/start.mjs": "not in files",
        })
        const sandbox = yield* Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* stageSandbox(pack, core, "1.2.3")
            expect(yield* isOwnSandbox(dir)).toBe(true)
            expect(lstatSync(join(dir, "cubes", "crm", "index.ts")).isFile()).toBe(true)
            for (const foreign of ["test", ".git", "shot.png"])
              expect(() => lstatSync(join(dir, foreign)), `${foreign} must not be staged`).toThrow()
            const staged = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>
            expect(staged).toMatchObject({ scripts: { test: "qwbe check ." }, dependencies: { "qwbe-core": "1.2.3" } })
            expect(staged.devDependencies).toBeUndefined()
            const installed = join(dir, "node_modules", "qwbe-core")
            expect(lstatSync(installed).isSymbolicLink()).toBe(false)
            expect(lstatSync(join(installed, "dist", "cube-contract.js")).isFile()).toBe(true)
            expect(() => lstatSync(join(installed, "scripts")), "only the package files list").toThrow()
            expect(() => lstatSync(join(installed, "src", "nested", "node_modules")), "no nested node_modules").toThrow()
            expect(readlinkSync(join(installed, "node_modules"))).toBe(join(core, "node_modules"))
            return dir
          }),
        )
        expect(() => lstatSync(sandbox), "the scope removed the sandbox").toThrow()
      }))
  })
})
