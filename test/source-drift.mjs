// The SOURCE-DRIFT probe (pack side): every copy the kernel holds of this
// pack must provably be what this repo holds now.
//
//   npm run test:drift                        # QWBE_REPO defaults to ../../qwbe
//   QWBE_REPO=<qwbe> node test/source-drift.mjs
//
// It was probes/source-drift.mjs until 2026-09-26 (T-1452): it judges the copies installed in a
// kernel CHECKOUT, which the `qwbe check` sandbox does not have, so it is an operator check under
// test/ and not a probe the checker runs. Read-only: it never writes either checkout.
//
// Two copies exist after an official install: the store shelf (core/store/crm-pack, carrying
// its qwbe-source.json provenance) and the installed destination (core/plugins/crm-pack,
// which strips the manifest and the provenance as bookkeeping). The shelf is judged by the
// kernel's own drift function - the one `qwbe drift` runs - plus one pack-side rule the
// kernel cannot know: the shelf must have been staged from THIS repo, never from a scratch
// copy (a /tmp staging is how the drift happened). The destination is decided by
// fingerprint against the repo minus the stripped bookkeeping files. Exit 1 on any red: a
// stale copy above this repo makes every verdict about this pack false. An absent copy is
// not drift - the pack is simply not installed there.

import { existsSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const repo = resolve(import.meta.dirname, "..")
const qwbeRepo = resolve(process.env.QWBE_REPO ?? join(repo, "..", "..", "qwbe"))
const kernel = (file) => import(pathToFileURL(join(qwbeRepo, "core", "src", file)))
const { shelfDrift } = await kernel("store-drift.ts")
const { MANIFEST, PROVENANCE, packageSourceFingerprint } = await kernel("package-source.ts")
const STRIPPED = [MANIFEST, PROVENANCE] // bookkeeping the destination strips at install

let red = 0
const verdict = (name, ok, detail) => {
  if (!ok) red += 1
  console.log(`  ${ok ? "ok" : "RED"}  ${name}  ${detail}`)
}

const shelf = join(qwbeRepo, "core", "store", "crm-pack")
if (!existsSync(shelf)) {
  verdict("store/crm-pack", true, "not staged in this checkout")
} else {
  const d = shelfDrift(shelf, "store/crm-pack")
  const fromRepo = d.status === "ok" && resolve(d.sourcePath) === realpathSync(repo)
  verdict(
    d.name,
    fromRepo,
    d.status !== "ok" ? d.detail
      : fromRepo ? `staged ${d.stagedAt} from ${d.sourcePath}`
      : `staged from "${d.sourcePath}" - a scratch copy, not this repo`,
  )
}

// The destination strips the manifest and the provenance (install.ts isBookkeeping), so its
// fingerprint is the repo's minus exactly those two files.
const installed = join(qwbeRepo, "core", "plugins", "crm-pack")
if (!existsSync(installed)) {
  verdict("plugins/crm-pack", true, "not installed in this checkout")
} else {
  const fresh =
    packageSourceFingerprint(installed, STRIPPED) === packageSourceFingerprint(repo, STRIPPED)
  verdict("plugins/crm-pack", fresh, fresh ? "matches the repo" : "behind the repo - reinstall from this directory")
}

console.log(red === 0 ? "source-drift: PASS" : `source-drift: FAIL (${red} red)`)
process.exit(red === 0 ? 0 : 1)
