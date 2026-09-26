// Installing the local CRM plugin through the public install-from door, end to end (QWB-31).
//
//   npm run test:lifecycle                         # QWBE_REPO defaults to ../../qwbe
//   QWBE_REPO=<qwbe> node test/install-lifecycle.mjs
//
// It was probes/qwb31-install-lifecycle.mjs until 2026-09-26 (T-1452). It is an OPERATOR proof,
// not a pack runtime probe: it restarts its own kernel four times and drives install-from and
// uninstall, which `qwbe check` (one booted kernel, reached through QWBE_URL) cannot express. So it
// lives under test/, which both staging filters drop, and `qwbe check` does not run it.
//
// It proves the acceptance criteria that need a running system, in order:
//
//   1. clean Qwbe (scratch plugins + store WITHOUT crm-pack) boots and serves no /contacts or /contracts
//   2. POST /settings/packages/install-from with the local directory is the ONLY install step
//   3. restart mounts both cubes; OpenAPI declares their routes, payloads, statuses, auth
//   9. restart keeps the plugin AND the CRM rows
//   10. disabling one cube leaves the other cube and Qwbe itself answering
//   11. uninstall unmounts both cubes; the other cubes' data is untouched
//
// Everything runs on scratch, under ONE mkdtemp root laid out like the checker's sandbox:
// <root>/plugins (QWBE_PLUGINS_DIR), <root>/store (QWBE_STORE_DIR), <root>/data (QWBE_DATA_DIR),
// <root>/node_modules (links into the kernel checkout, see below) and <root>/source/crm-pack -- a clean copy of this checkout made with the runner's copyFilter,
// so the before/after fingerprint never walks node_modules or .git. All four boots share ONE
// scratch database created here (otherwise "restart keeps the CRM rows" could not hold) and
// dropped at the end. The kernel checkout's core/plugins and core/store, the owner's live data
// and database, and the live instances on 4500/4510/4520 are never touched. Never run it with
// QWBE_DATABASE_URL exported (the runner creates its database from the QWBE_PG_* coordinates).

import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

import { copyFilter } from "./sdk-check-lib.mjs"

const PACK = resolve(import.meta.dirname, "..")
const qwbeRepo = resolve(process.env.QWBE_REPO ?? join(PACK, "..", "..", "qwbe"))
const lib = await import(join(qwbeRepo, "probes/lib.mjs"))
// Deterministic tree hash, same shape as the installer's fingerprintOf: sha256 over the sorted
// (relative path, file hash) list. Re-implemented here (20 lines) because this is plain
// .mjs - importing the .ts kernel module would drag the type-stripping question into a gate.
const fingerprintOf = (dir) => {
  const entries = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(p)
      else entries.push([relative(dir, p), createHash("sha256").update(readFileSync(p)).digest("hex")])
    }
  }
  walk(dir)
  entries.sort(([a], [b]) => a.localeCompare(b))
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex")
}

// The scratch database has no provenance ledger: the boot authorizes the pack's pre-ledger
// sources exactly like probes/crm.mjs (operator authorization for an EMPTY throwaway database).
const LEGACY_MIGRATIONS =
  "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack,bookmarks:example-plugin,tags:example-plugin"

const root = mkdtempSync(join(tmpdir(), "qwb31-"))
const PLUGINS = join(root, "plugins")
const store = join(root, "store")
const data = join(root, "data")
const SOURCE = join(root, "source", "crm-pack")

// The mounted pack imports qwbe-core/*, effect and @effect/platform. Under <qwbe>/core/plugins
// those resolve through the checkout itself (qwbe-core by self-reference, the rest from
// core/node_modules); a plugins root in the temp dir has neither, and the second boot refuses with
// "Cannot find package '@effect/platform'". So <root>/node_modules gets LINKS, never copies:
// qwbe-core -> <qwbe>/core and every top-level entry of <qwbe>/core/node_modules, which keeps ONE
// effect instance shared with the kernel. The same idea as the node_modules link the checker's
// install sandbox gets (core/src/check-package.ts, stageSandbox). rmSync of the root removes the
// links, not their targets.
const kernelCore = join(qwbeRepo, "core")
const kernelModules = join(kernelCore, "node_modules")
const scratchModules = join(root, "node_modules")

/** Fills the mkdtemp root. Called inside the try below, so a setup failure still removes root. */
const setupScratch = () => {
  for (const d of [PLUGINS, store, data, join(root, "source")]) mkdirSync(d, { recursive: true })
  cpSync(PACK, SOURCE, { recursive: true, filter: copyFilter(PACK) })
  mkdirSync(scratchModules)
  symlinkSync(kernelCore, join(scratchModules, "qwbe-core"))
  for (const entry of readdirSync(kernelModules)) {
    if (!entry.startsWith(".")) symlinkSync(join(kernelModules, entry), join(scratchModules, entry))
  }
}

const score = lib.makeScore()
let dbUrl
let current
let fatal

/** A refusal that must still reach the cleanup below (process.exit would skip `finally`). */
const abort = (message) => {
  throw new Error(message)
}

const boot = async () => {
  const port = await lib.freePort()
  const server = await lib.startServer(port, {
    QWBE_DATABASE_URL: dbUrl,
    QWBE_PLUGINS_DIR: PLUGINS,
    QWBE_STORE_DIR: store,
    QWBE_DATA_DIR: data,
    QWBE_LEGACY_MIGRATIONS: LEGACY_MIGRATIONS,
  })
  current = server
  return { server, api: lib.client(port), port }
}

const stop = async (server) => {
  await lib.stopServer(server)
  if (current === server) current = undefined
}

/** /settings/cubes row names, or null when the request itself failed. */
const cubeNames = async (api, headers) => {
  const r = await api.call("/settings/cubes", { headers })
  return r.status === 200 ? (r.body ?? []).map((c) => c.name) : null
}

/** OpenAPI paths starting with a prefix, or null when the spec request failed. The spec is
 *  behind authentication (401 without a token), so the caller passes admin headers. */
const openapiPaths = async (api, prefix, headers) => {
  const r = await api.call("/openapi.json", { headers })
  if (r.status !== 200) return null
  return Object.keys(r.body?.paths ?? {}).filter((p) => p.startsWith(prefix))
}

try {
  setupScratch()
  if (!existsSync(join(SOURCE, "qwbe-package.json"))) abort(`refused: CRM source copy has no qwbe-package.json at ${SOURCE}`)
  dbUrl = await lib.scratchDatabase("qwb31")
  const sourceBefore = fingerprintOf(SOURCE)

  // ---- 1. clean boot: no CRM anywhere --------------------------------------------
  const first = await boot()
  if (!first.server.alive) {
    abort(`clean server did not start:\n${first.server.output}`)
  }
  const admin1 = await first.api.login()
  const names1 = await cubeNames(first.api, admin1.headers)
  score.check(
    "clean Qwbe boots with no CRM cubes mounted",
    names1 !== null && !names1.includes("crm") && !names1.includes("crm/contacts") && !names1.includes("crm/contracts"),
    `cubes=${names1}`,
  )
  const crmPaths1 = [
    ...((await openapiPaths(first.api, "/contacts", admin1.headers)) ?? ["<spec request failed>"]),
    ...((await openapiPaths(first.api, "/contracts", admin1.headers)) ?? ["<spec request failed>"]),
  ]
  score.check("clean OpenAPI declares no CRM routes", crmPaths1.length === 0, `found=${crmPaths1}`)

  // ---- 2. install-from, exclusively from the local directory ----------------------
  const install = await first.api.call("/settings/packages/install-from", {
    method: "POST",
    headers: admin1.headers,
    body: JSON.stringify({ path: SOURCE }),
  })
  score.check(
    "install-from accepts the local crm-pack directory",
    install.status === 200 && install.body?.package?.name === "crm-pack" && install.body?.requiresRestart === true,
    `http=${install.status} body=${JSON.stringify(install.body)?.slice(0, 160)}`,
  )
  const staged = existsSync(join(store, "crm-pack", "qwbe-package.json"))
  // install-from writes the store shelf AND the mounted copy under the (scratch) plugins root
  // directly; the kernel only mounts it on the next boot. The shelf is checked here, the mounted
  // copy after the restart.
  score.check("package staged in the (scratch) store by install-from", staged, `staged=${staged}`)
  const namesBeforeRestart = await cubeNames(first.api, admin1.headers)
  score.check(
    "before restart the CRM cubes are NOT yet mounted",
    namesBeforeRestart !== null && !namesBeforeRestart.includes("crm"),
    `cubes=${namesBeforeRestart}`,
  )
  await stop(first.server)

  // ---- 3 + 6. restart mounts; OpenAPI declares the surface -------------------------
  const second = await boot()
  if (!second.server.alive) {
    abort(`server with crm-pack did not start:\n${second.server.output}`)
  }
  const admin = await second.api.login()
  const reader = await second.api.login("reader", "reader")
  const names2 = await cubeNames(second.api, admin.headers)
  // install-from writes the copy under the plugins root immediately; the store shelf is the source
  // it was staged from. The mounted copy deliberately omits qwbe-package.json (bookkeeping -
  // the kernel's isBookkeeping filter), so presence is judged by the cube directories.
  const mountedCopy =
    existsSync(join(PLUGINS, "crm-pack", "cubes", "crm", "index.ts")) &&
    existsSync(join(PLUGINS, "crm-pack", "cubes", "crm", "contacts", "index.ts")) &&
    existsSync(join(PLUGINS, "crm-pack", "cubes", "crm", "contracts", "index.ts"))
  score.check(
    "after restart both CRM cubes are mounted and enabled (copy present under the plugins root)",
    names2?.includes("crm") && names2?.includes("crm/contacts") && names2?.includes("crm/contracts") && mountedCopy,
    `cubes=${names2} copy=${mountedCopy}`,
  )
  const spec = (await second.api.call("/openapi.json", { headers: admin.headers })).body
  const paths = Object.keys(spec?.paths ?? {})
  const want = ["/contacts", "/contacts/{id}", "/contracts", "/contracts/{id}"]
  score.check(
    "OpenAPI declares all CRM routes",
    want.every((w) => paths.includes(w)),
    `missing=${want.filter((w) => !paths.includes(w))}`,
  )
  const ops = spec?.paths?.["/contracts"] ?? {}
  const post = ops.post ?? {}
  const postStatuses = Object.keys(post.responses ?? {}).sort()
  const hasBody = Boolean(post.requestBody)
  const hasSecurity = Object.values(ops).every((op) => Array.isArray(op.security) && op.security.length > 0)
  score.check(
    "OpenAPI: POST /contracts has payload, auth and typed statuses",
    hasBody && hasSecurity && postStatuses.includes("400") && postStatuses.includes("401") && postStatuses.includes("403"),
    `statuses=${postStatuses} body=${hasBody} security=${hasSecurity}`,
  )
  const getById = spec?.paths?.["/contacts/{id}"]?.get ?? {}
  score.check(
    "OpenAPI: GET /contacts/{id} declares 401/404 and a response schema",
    Object.keys(getById.responses ?? {}).includes("404") &&
      Boolean(getById.responses?.["200"]?.content?.["application/json"]?.schema),
    `statuses=${Object.keys(getById.responses ?? {})}`,
  )

  // ---- 7. authenticated E2E through the decided model (partyId) --------------------
  const badContact = await second.api.call("/contacts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "" }),
  })
  const contact = (
    await second.api.call("/contacts", {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ name: "QWB31 Proba", email: "qwb31@example.com", company: "Proba SRL" }),
    })
  ).body
  const contract = (
    await second.api.call("/contracts", {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ title: "QWB31 Contract", amount: 4200, currency: "RON", partyId: contact?.id }),
    })
  ).body
  // Entity-level permissions: the reader sees only records shared with it (the kernel's
  // entity-enforcement), so both rows are shared through the grant endpoint before the reader
  // reads them back -- the same explicit grants probes/crm.mjs uses.
  const shares = []
  for (const [cube, entityType, id] of [
    ["crm/contacts", "Contact", contact?.id],
    ["crm/contracts", "Contract", contract?.id],
  ]) {
    const g = await second.api.call(
      `/permissions/entities/${encodeURIComponent(cube)}/${entityType}/${encodeURIComponent(String(id))}/grants/user`,
      { method: "POST", headers: admin.headers, body: JSON.stringify({ username: "reader", actions: ["read"] }) },
    )
    shares.push(g.status)
  }
  score.check("admin shares the contact and the contract with the reader (read)", shares.every((st) => st === 200), `http=${shares}`)
  const readBack = await second.api.call(`/contracts/${contract?.id}`, { headers: reader.headers })
  const listed = await second.api.call("/contacts", { headers: reader.headers })
  score.check(
    "E2E: contact + contract created, read back, partyId opaque and pointing at the contact",
    typeof contact?.id === "string" &&
      contract?.partyId === contact?.id &&
      readBack.status === 200 &&
      readBack.body?.partyId === contact?.id &&
      (listed.body?.rows ?? []).some((r) => r.id === contact?.id),
    `contact=${contact?.id} contract=${contract?.id}`,
  )

  // ---- 8. boundary statuses ---------------------------------------------------------
  const anon = await second.api.call("/contacts")
  const forbidden = await second.api.call("/contacts", {
    method: "POST",
    headers: reader.headers,
    body: JSON.stringify({ name: "Refused" }),
  })
  const invalid = await second.api.call("/contracts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ title: "Bad money", amount: 10.5, currency: "RON" }),
  })
  const missing = await second.api.call("/contacts/cont_qwb31_missing", { headers: admin.headers })
  score.check(
    "boundaries: 401 anon, 403 reader-create, 400 invalid payload, 404 unknown id",
    anon.status === 401 && forbidden.status === 403 && invalid.status === 400 && missing.status === 404,
    `${anon.status},${forbidden.status},${invalid.status},${missing.status}; empty-name=${badContact.status}`,
  )
  await stop(second.server)

  // ---- 9. restart keeps plugin AND data ----------------------------------------------
  const third = await boot()
  if (!third.server.alive) {
    abort(`restart-2 server did not start:\n${third.server.output}`)
  }
  const admin3 = await third.api.login()
  const names3 = await cubeNames(third.api, admin3.headers)
  const afterRestart = await third.api.call(`/contacts/${contact?.id}`, { headers: admin3.headers })
  const contractsAfter = await third.api.call("/contracts", { headers: admin3.headers })
  score.check(
    "restart keeps the plugin mounted and the CRM rows",
    names3?.includes("crm/contacts") &&
      names3?.includes("crm/contracts") &&
      afterRestart.status === 200 &&
      afterRestart.body?.name === "QWB31 Proba" &&
      (contractsAfter.body?.rows ?? []).some((r) => r.id === contract?.id),
    `contact http=${afterRestart.status} contracts=${contractsAfter.body?.total}`,
  )

  // ---- 10. disabling one cube does not stop the other or Qwbe ------------------------
  const off = await third.api.call("/settings/cubes/crm%2Fcontracts", {
    method: "POST",
    headers: admin3.headers,
    body: JSON.stringify({ enabled: false }),
  })
  const contractsOff = await third.api.call("/contracts", { headers: admin3.headers })
  const contactsOn = await third.api.call("/contacts", { headers: admin3.headers })
  const cubesOn = await third.api.call("/settings/cubes", { headers: admin3.headers })
  score.check(
    "contracts disabled: contacts and Qwbe keep answering, contracts is gone",
    off.status === 200 && contactsOn.status === 200 && cubesOn.status === 200 && contractsOff.status === 404,
    `toggle=${off.status} contacts=${contactsOn.status} contracts=${contractsOff.status}`,
  )
  const backOn = await third.api.call("/settings/cubes/crm%2Fcontracts", {
    method: "POST",
    headers: admin3.headers,
    body: JSON.stringify({ enabled: true }),
  })
  const contractsBack = await third.api.call("/contracts", { headers: admin3.headers })
  score.check(
    "re-enabling contracts brings it back with its data",
    backOn.status === 200 && contractsBack.status === 200 && contractsBack.body?.total === 1,
    `toggle=${backOn.status} http=${contractsBack.status}`,
  )

  // ---- 11. uninstall unmounts both cubes, other cubes untouched ----------------------
  const notesBefore = await third.api.call("/notes", { headers: admin3.headers })
  const uninstall = await third.api.call("/settings/packages/crm-pack", {
    method: "DELETE",
    headers: admin3.headers,
  })
  score.check(
    "uninstall crm-pack accepted (requiresRestart)",
    uninstall.status === 200 && uninstall.body?.requiresRestart === true,
    `http=${uninstall.status} body=${JSON.stringify(uninstall.body)}`,
  )
  const pluginsAfterRm = existsSync(join(PLUGINS, "crm-pack"))
  const shelfKept = existsSync(join(store, "crm-pack", "qwbe-package.json"))
  score.check(
    "uninstall removes the mounted copy, keeps the store shelf",
    !pluginsAfterRm && shelfKept,
    `pluginsCopy=${pluginsAfterRm} shelf=${shelfKept}`,
  )
  await stop(third.server)

  const fourth = await boot()
  if (!fourth.server.alive) {
    abort(`post-uninstall server did not start:\n${fourth.server.output}`)
  }
  const admin4 = await fourth.api.login()
  const names4 = await cubeNames(fourth.api, admin4.headers)
  const notesAfter = await fourth.api.call("/notes", { headers: admin4.headers })
  const contactsGone = await fourth.api.call("/contacts", { headers: admin4.headers })
  score.check(
    "after restart: both CRM cubes unmounted, notes data untouched",
    !names4?.includes("crm") &&
      !names4?.includes("crm/contacts") &&
      !names4?.includes("crm/contracts") &&
      contactsGone.status === 404 &&
      notesAfter.status === 200 &&
      notesAfter.body?.total === notesBefore.body?.total,
    `cubes=${names4} contacts=${contactsGone.status} notes=${notesAfter.body?.total}vs${notesBefore.body?.total}`,
  )
  await stop(fourth.server)

  // ---- source tree never written ------------------------------------------------------
  const sourceAfter = fingerprintOf(SOURCE)
  score.check("the plugin source tree is byte-identical after the whole run", sourceBefore === sourceAfter)
} catch (error) {
  fatal = error
} finally {
  if (current) await lib.stopServer(current)
  await lib.dropDatabase(dbUrl)
  // Only the mkdtemp root this run made -- never anything under $QWBE_REPO.
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
}

if (fatal) {
  console.error(fatal instanceof Error ? fatal.message : String(fatal))
  process.exit(1)
}
process.exit(score.report("QWB-31 crm-pack install-from lifecycle"))
