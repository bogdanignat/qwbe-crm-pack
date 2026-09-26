// The two rules the UI fixture applies to `next-env.d.ts`, the one file it
// writes that it did not create.
//
// The fixture builds the app with QWBE_DIST_DIR, and that makes `next build`
// rewrite `next-env.d.ts` (its path is fixed, so unlike tsconfig.json it cannot
// be pointed elsewhere -- see fixture.mjs). Two states, two rules:
//
//   - the file existed before the build: the snapshot is put back, but putting it
//     back unconditionally would also discard anything else that touched the file
//     during the build, so the restore is conditional;
//   - the file did NOT exist before the build (the normal state of a fresh clone:
//     it is generated and gitignored), so the build created it, naming a build
//     directory the fixture then deletes -- it is removed again, unless something
//     other than the build wrote to it meanwhile.
//
// Both conditions are what is tested here. No browser, no build, no server:
// these cases run on a temp file.

import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import { DIST_DIR, discardGeneratedTypeDeclarations, restoreGeneratedTypeDeclarations } from "./fixture.mjs"

const HEADER = ['/// <reference types="next" />', '/// <reference types="next/image-types/global" />']
const NOTICE = [
  "",
  "// NOTE: This file should not be edited",
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
  "",
]

/** The file exactly as Next generates it for one build directory. */
const generatedFor = (dist) =>
  [...HEADER, `import "./${dist}/types/routes.d.ts";`, `import "./${dist}/types/root-params.d.ts";`, ...NOTICE].join(
    "\n",
  )

/** A path in a fresh temp directory, with `content` written there if given. */
function temp(content) {
  const path = join(mkdtempSync(join(tmpdir(), "qwbe-next-env-")), "next-env.d.ts")
  if (content !== undefined) writeFileSync(path, content)
  return path
}

/** Run `act` with console.warn captured, and report what it said. */
function quietly(act) {
  const warnings = []
  const real = console.warn
  console.warn = (...args) => warnings.push(args.join(" "))
  try {
    act()
  } finally {
    console.warn = real
  }
  return warnings
}

/** Run the restore with console.warn captured. */
function restoreQuietly(path, before) {
  const warnings = quietly(() => restoreGeneratedTypeDeclarations(path, Buffer.from(before)))
  return { content: readFileSync(path, "utf8"), warnings }
}

/** Run the discard with console.warn captured. */
function discardQuietly(path) {
  const warnings = quietly(() => discardGeneratedTypeDeclarations(path))
  return { exists: existsSync(path), content: existsSync(path) ? readFileSync(path, "utf8") : null, warnings }
}

describe("the UI fixture's next-env.d.ts restore", () => {
  it("puts the snapshot back when only the build directory's own type imports moved", () => {
    const before = generatedFor(".next")
    const path = temp(generatedFor(DIST_DIR))
    const { content, warnings } = restoreQuietly(path, before)
    assert.equal(content, before, "the fixture left its own build directory in next-env.d.ts")
    assert.deepEqual(warnings, [])
  })

  it("writes nothing at all when the build changed nothing", () => {
    const before = generatedFor(".next")
    const path = temp(before)
    const { content, warnings } = restoreQuietly(path, before)
    assert.equal(content, before)
    assert.deepEqual(warnings, [])
  })

  it("leaves a concurrent edit alone and says so, instead of overwriting it", () => {
    const before = generatedFor(".next")
    // Someone added a line of their own while the build was running. The
    // generated imports moved too, but that is no licence to drop the rest.
    const edited = generatedFor(DIST_DIR).replace(HEADER[0], `${HEADER[0]}\n/// <reference types="my-own" />`)
    const path = temp(edited)
    const { content, warnings } = restoreQuietly(path, before)
    assert.equal(content, edited, "a concurrent edit of next-env.d.ts was overwritten by the fixture's snapshot")
    assert.equal(warnings.length, 1, "the fixture overwrote nothing but also said nothing")
    assert.match(warnings[0], /does not explain/)
  })

  it("leaves an edit that only rewrote one generated import's directory alone", () => {
    // Same line count, same shape, but the new path is not the fixture's own
    // output directory -- so the fixture did not write it and must not claim it.
    const before = generatedFor(".next")
    const edited = generatedFor(".next").replace(".next/types/routes.d.ts", ".next-something-else/types/routes.d.ts")
    const path = temp(edited)
    const { content, warnings } = restoreQuietly(path, before)
    assert.equal(content, edited)
    assert.equal(warnings.length, 1)
  })
})

describe("the UI fixture's next-env.d.ts removal, when the build is what created it", () => {
  it("takes the file away again when it holds nothing but this build's own output", () => {
    // A fresh clone has no next-env.d.ts; the fixture's build wrote this one,
    // and its imports name a build directory that is about to be deleted.
    const path = temp(generatedFor(DIST_DIR))
    const { exists, warnings } = discardQuietly(path)
    assert.equal(exists, false, "the fixture left behind a next-env.d.ts that only its own build had written")
    assert.deepEqual(warnings, [])
  })

  it("does nothing at all when the build never wrote the file", () => {
    // A build that failed early: there is no file, and that is not an error.
    const path = temp()
    const { exists, warnings } = discardQuietly(path)
    assert.equal(exists, false)
    assert.deepEqual(warnings, [])
  })

  it("keeps a file whose generated imports name some other build directory", () => {
    // Not this fixture's output, so not this fixture's to delete -- whoever
    // wrote `.next` in there between the snapshot check and here owns the file.
    const before = generatedFor(".next")
    const path = temp(before)
    const { exists, content, warnings } = discardQuietly(path)
    assert.equal(exists, true, "the fixture deleted a next-env.d.ts written for another build directory")
    assert.equal(content, before)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /not only this build's output/)
  })

  it("keeps a concurrent edit alone and says so, instead of deleting it with the rest", () => {
    // The generated imports are the fixture's, but the extra line is not: a
    // deletion here would take someone's edit with it.
    const edited = generatedFor(DIST_DIR).replace(HEADER[0], `${HEADER[0]}\n/// <reference types="my-own" />`)
    const path = temp(edited)
    const { exists, content, warnings } = discardQuietly(path)
    assert.equal(exists, true, "a concurrent edit of next-env.d.ts was deleted by the fixture's cleanup")
    assert.equal(content, edited)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /not only this build's output/)
  })

  it("keeps a hand-written declaration, even with the build's own imports beside it", () => {
    const edited = `${generatedFor(DIST_DIR)}\ndeclare module "my-own-module" {}\n`
    const path = temp(edited)
    const { exists, content, warnings } = discardQuietly(path)
    assert.equal(exists, true)
    assert.equal(content, edited)
    assert.equal(warnings.length, 1)
  })
})
