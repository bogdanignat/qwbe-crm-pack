// The runner's staging judgment (T-1452, B4): the package.json it stages, the dependency it refuses,
// what the outer copy keeps -- and that the KERNEL's own staging filter drops `test/` too, read out
// of its source rather than assumed. No Postgres, no spawn.
import { join, resolve, sep } from "node:path"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as FileSystem from "@effect/platform/FileSystem"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { QWBE_REPO } from "../checks/_layers/kernel.ts"
import { CANONICAL_TEST, copyFilter, isForeignEntry, publicationPackageJson } from "./sdk-check-pure.ts"

const NATIVE = {
  name: "qwbe-crm-pack",
  version: "0.0.0",
  private: true,
  type: "module",
  scripts: { test: "node --test cubes/**/*.test.ts", lint: "eslint ." },
  dependencies: { effect: "^3.21.0", "qwbe-core": "file:../../qwbe/core" },
  devDependencies: { typescript: "^5.7.0" },
}

const refusal = (result: Either.Either<unknown, { readonly message: string }>) =>
  Either.match(result, { onLeft: (error) => error.message, onRight: () => "staged" })

describe("the publication shape the sandbox is given", () => {
  it("replaces the two things the invocation gate judges, and nothing about the checkout", () => {
    const out = Either.getOrThrow(publicationPackageJson(NATIVE, "0.0.0")) as {
      scripts: Record<string, string>
      dependencies: Record<string, string>
      name: string
      devDependencies?: unknown
    }
    expect(out.scripts.test).toBe(CANONICAL_TEST)
    expect(out.dependencies["qwbe-core"]).toBe("0.0.0")
    // The real SDK version, not a placeholder, and no checkout specifier survives.
    expect(JSON.stringify(out.dependencies)).not.toMatch(/file:|link:|workspace:/)
    // The pack's identity and its other dependencies are untouched.
    expect(out.name).toBe("qwbe-crm-pack")
    expect(out.dependencies.effect).toBe("^3.21.0")
    // Only the gate's entry remains: nobody runs the node --test loop against a publication copy.
    expect(Object.keys(out.scripts)).toEqual(["test"])
    expect(out.devDependencies).toBeUndefined()
    // The INPUT object is not mutated: the caller reads the checkout's file and must keep it.
    expect(NATIVE.scripts.test).toBe("node --test cubes/**/*.test.ts")
    expect(NATIVE.dependencies["qwbe-core"]).toBe("file:../../qwbe/core")
  })

  it("refuses to stage rather than stage something the gate would wrongly pass", () => {
    expect(refusal(publicationPackageJson(NATIVE, ""))).toMatch(/declares no version/)
    expect(refusal(publicationPackageJson(NATIVE, undefined))).toMatch(/declares no version/)
    // A second checkout specifier hiding in another field is a refusal, not a silent pass.
    const sneaky = { ...NATIVE, peerDependencies: { "qwbe-core": "link:../../qwbe/core" } }
    expect(refusal(publicationPackageJson(sneaky, "0.0.0"))).toMatch(/still names a checkout: qwbe-core@link:/)
    const optional = { ...NATIVE, optionalDependencies: { helper: "file:../helper" } }
    expect(refusal(publicationPackageJson(optional, "0.0.0"))).toMatch(/helper@file:/)
  })
})

describe("what is copied into the sandbox", () => {
  it("treats session artifacts and authoring tooling as foreign", () => {
    const foreign = ["node_modules", "frontend", "docs", ".git", ".playwright-mcp", ".t1450-baseline", ".local", ".githooks"]
    for (const name of [...foreign, "focus-dropdown-admin.png", "package-lock.json", "trace.zip"])
      expect(isForeignEntry(name), `${name} must not reach the sandbox`).toBe(true)
  })

  it("keeps everything the package actually is", () => {
    for (const own of ["cubes", "probes", "tools", "mappings", "qwbe-package.json", "package.json", "README.md"])
      expect(isForeignEntry(own), `${own} must reach the sandbox`).toBe(false)
  })

  it("drops `test/`, which is where THIS runner lives, so it is never package content", () => {
    // `tools/` reaches the sandbox copy (the kernel drops it at install since PR #45); a runner that
    // spawns npm and the kernel bin still belongs with the pack's own tests, not its tooling.
    expect(isForeignEntry("test")).toBe(true)
    const root = `${sep}pack`
    const keep = copyFilter(root)
    for (const file of ["sdk-check.ts", "sdk-check-pure.ts", "sdk-check-env.ts", "sdk-check-sandbox.ts", "sdk-check-run.ts"])
      expect(keep(join(root, "test", file)), `test/${file} must not reach the sandbox`).toBe(false)
    // `tools/` stays in the sandbox copy: the kernel's own filter, not this one, keeps it out of an install.
    expect(keep(join(root, "tools", "seed-demo.mjs"))).toBe(true)
  })

  it.effect("the KERNEL's own staging filter drops `test/` too -- checked against its source, not assumed", () =>
    Effect.gen(function* () {
      // `includePackageSourcePath` decides what an INSTALL ships, via LOCAL_SOURCE_DIRECTORIES. It is
      // not re-exported through `qwbe-core/*`, so the literal is read out of the source: if someone
      // drops `test` from that set, this fails instead of the runner quietly shipping.
      const fs = yield* FileSystem.FileSystem
      const source = resolve(yield* QWBE_REPO, "core", "src", "package-source.ts")
      expect(yield* fs.exists(source), `cannot verify the kernel staging filter: no ${source} -- set QWBE_REPO`).toBe(true)
      // The literal spans lines since kernel PR #45 (`tools` and `checks` joined it): match the whole Set.
      const literal = /LOCAL_SOURCE_DIRECTORIES = new Set\(\[([^\]]*)\]\)/.exec(yield* fs.readFileString(source))?.[1]
      expect(literal, "package-source.ts no longer declares LOCAL_SOURCE_DIRECTORIES as a literal Set").toBeDefined()
      expect(literal).toMatch(/"test"/)
    }).pipe(Effect.provide(NodeFileSystem.layer)))

  it("filters on the TOP-LEVEL entry only, so a nested docs/ or dotfile still ships", () => {
    const root = `${sep}pack`
    const keep = copyFilter(root)
    expect(keep(root)).toBe(true)
    expect(keep(join(root, "cubes"))).toBe(true)
    expect(keep(join(root, "cubes", "crm", "index.ts"))).toBe(true)
    // A file named like a foreign entry BELOW the root is package content, not session state.
    expect(keep(join(root, "cubes", "crm", "docs", "notes.md"))).toBe(true)
    expect(keep(join(root, "cubes", "crm", "shot.png"))).toBe(true)
    expect(keep(join(root, "node_modules"))).toBe(false)
    expect(keep(join(root, "node_modules", "qwbe-core", "package.json"))).toBe(false)
    expect(keep(join(root, ".playwright-mcp"))).toBe(false)
    expect(keep(join(root, "frontend", "src", "app", "page.tsx"))).toBe(false)
  })
})
