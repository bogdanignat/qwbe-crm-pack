// Runtime proof for the rebuilt CRM plugin.
//
// Attacks the CRM cubes over the authenticated HTTP boundary: 401 without a token, 403 with the
// wrong permission, 404 on a missing id, create/list/get for every cube, an invalid payload
// refused at the schema edge (fractional minor units), the party relation as opaque data, money
// kept in minor units and never summed across currencies -- and, as the decided minimal
// relation, each cube booting and serving while the others are absent.
//
// Two modes, decided by QWBE_URL:
//
//   check mode (QWBE_URL set) -- the SDK contract. `qwbe check` boots a throwaway kernel with
//   this pack mounted and runs every probes/*.mjs with QWBE_URL, QWBE_ADMIN_PASSWORD and
//   QWBE_READER_PASSWORD. Nothing is imported from a kernel checkout and no server is started:
//   the probe judges the kernel it was pointed at. It refuses (exit 2) any QWBE_URL that is not
//   loopback or that names a live instance port (4500/4510/4520). The independence section
//   needs its own boots with QWBE_MOUNTED and is skipped here, printed, never counted as a pass.
//
//     npm run test:check        # test/sdk-check.mjs -> qwbe check on a publication-shaped copy
//
//   checkout mode (no QWBE_URL) -- boots its own kernel from a qwbe checkout on a scratch data
//   dir and a scratch database (probes/lib.mjs startServer), independence included:
//
//     QWBE_REPO=<qwbe> node probes/crm.mjs
//
//   Checkout mode judges the INSTALLED copy at <qwbe>/core/plugins/crm-pack (the kernel starts
//   with cwd=core and its default directories), NOT this working tree. The evidence about the
//   working tree is the sandbox run of `npm run test:check`. Installing is the official path --
//   settings:install-from <this directory> (or POST /settings/packages/install-from) and a
//   restart -- never a hand copy into core/plugins. Never run it with QWBE_DATABASE_URL exported:
//   lib.mjs would reuse that database instead of creating a scratch one. Checkout mode therefore
//   ignores QWBE_DATABASE_URL explicitly (deletes it before booting) and uses QWBE_PG_* only.
//
// Either way the probe refuses to run if the cubes are not mounted, rather than proving nothing.
//
// No helper .mjs sits next to this file on purpose: the checker runs every probes/*.mjs as a probe.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const makeScore = () => {
  const lines = []
  let passed = 0
  let failed = 0
  return {
    check(name, ok, detail = "") {
      if (ok) passed++
      else failed++
      lines.push(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
    },
    report(title) {
      console.log(`\n${title} — ${passed} pass, ${failed} fail\n`)
      console.log(lines.join("\n"))
      console.log("")
      return failed === 0 ? 0 : 1
    },
  }
}

/** Tiny JSON client (after qwbe probes/lib.mjs client). Never throws on a non-2xx. */
const makeClient = (base) => {
  const call = async (path, options = {}) => {
    const r = await fetch(base + path, options)
    const text = await r.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: r.status, body }
  }
  return {
    call,
    async login(username, password) {
      const r = await call("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      const token = r.body?.token
      return {
        status: r.status,
        token,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }
    },
  }
}

const scratchDataDir = (label) => mkdtempSync(join(tmpdir(), `${label}-data-`))
const dropScratch = (dir) => {
  if (dir?.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true })
}

// The scratch ledger has no record of any legacy cube on a fresh data dir: the boot
// authorizes its own pre-ledger history, exactly like the throwaway bench in
// tools/import.test.mjs. The full list, not a subset -- the pack declares three sources
// (contacts, contracts, crm/accounts) and the kernel checkout's own example-plugin
// declares two more (bookmarks, tags); one unattributable source refuses the boot.
// Checkout mode only: under `qwbe check` the operator authorization is the runner's.
const LEGACY = {
  QWBE_LEGACY_MIGRATIONS:
    "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack,bookmarks:example-plugin,tags:example-plugin",
}

const LIVE_PORTS = new Set(["4500", "4510", "4520"])
const checkMode = typeof process.env.QWBE_URL === "string" && process.env.QWBE_URL.length > 0

const score = makeScore()
let api
let passwords
let lib
let server
let data

if (checkMode) {
  let target
  try {
    target = new URL(process.env.QWBE_URL)
  } catch {
    console.error(`refused: QWBE_URL is not a URL`)
    process.exit(2)
  }
  const loopback = target.hostname === "127.0.0.1" || target.hostname === "localhost"
  if (!loopback || LIVE_PORTS.has(target.port)) {
    console.error(
      `refused: QWBE_URL must be a throwaway loopback kernel (127.0.0.1/localhost, not port 4500/4510/4520); got host ${target.hostname} port ${target.port || "(default)"}`,
    )
    process.exit(2)
  }
  api = makeClient(target.origin)
  // The checker always sets both (check-package.ts); a missing one means this is not a check run.
  const missingPw = ["QWBE_ADMIN_PASSWORD", "QWBE_READER_PASSWORD"].filter((k) => !process.env[k])
  if (missingPw.length > 0) {
    console.error(`refused: check mode needs ${missingPw.join(" and ")} (qwbe check sets them)`)
    process.exit(2)
  }
  passwords = { admin: process.env.QWBE_ADMIN_PASSWORD, reader: process.env.QWBE_READER_PASSWORD }
} else {
  const qwbeRepo = resolve(process.env.QWBE_REPO ?? join(import.meta.dirname, "..", "..", "..", "qwbe"))
  lib = await import(join(qwbeRepo, "probes/lib.mjs"))
  // Ignored on purpose: lib.startServer would otherwise reuse that database (ownsDb=false)
  // instead of creating -- and dropping -- a scratch one from QWBE_PG_*.
  delete process.env.QWBE_DATABASE_URL
  const port = await lib.freePort()
  data = scratchDataDir("crm")
  server = await lib.startServer(port, { QWBE_DATA_DIR: data, ...LEGACY })
  if (!server.alive) {
    dropScratch(data)
    console.error(`server did not start:\n${server.output}`)
    process.exit(1)
  }
  api = makeClient(`http://127.0.0.1:${port}`)
  // startServer sets exactly these two for the kernel it boots.
  passwords = { admin: "admin", reader: "reader" }
}

// A refusal inside the try throws Refused, so finally still stops the kernel and drops the
// scratch database; it is reported (exit 1) after finally.
class Refused extends Error {}
let refused = null

try {
  const admin = await api.login("admin", passwords.admin)
  const reader = await api.login("reader", passwords.reader)

  // Entity-level permissions: a reader sees only the records explicitly shared with it
  // (kernel entity-enforcement: an unshared GET is 403, the list is filtered and total counts
  // only what is visible). The reader-visibility assertions below therefore share each record
  // first, through the kernel's grant endpoint -- the same contract the frontend sharing panel uses.
  const grantRead = async (cube, entityType, id) => {
    const r = await api.call(
      `/permissions/entities/${encodeURIComponent(cube)}/${entityType}/${encodeURIComponent(String(id))}/grants/user`,
      { method: "POST", headers: admin.headers, body: JSON.stringify({ username: "reader", actions: ["read"] }) },
    )
    score.check(
      `admin shares ${entityType} ${id} with the reader (read)`,
      r.status === 200 && typeof r.body?.id === "string",
      `http=${r.status}`,
    )
    return r.body?.id
  }

  const cubes = await api.call("/settings/cubes", { headers: admin.headers })
  const names = (Array.isArray(cubes.body) ? cubes.body : []).map((c) => c.name)
  for (const want of ["crm", "crm/organizations", "crm/contacts", "crm/contracts"]) {
    if (!names.includes(want)) {
      throw new Refused(
        `refused: cube "${want}" is not mounted (GET /settings/cubes http=${cubes.status}) — install crm-pack first (see header).`,
      )
    }
  }

  // ---- auth boundary -------------------------------------------------------------
  const anon = await api.call("/contacts")
  score.check("contacts requires authentication (401)", anon.status === 401, `http=${anon.status}`)
  const anonC = await api.call("/contracts")
  score.check("contracts requires authentication (401)", anonC.status === 401, `http=${anonC.status}`)

  // ---- contacts: create / list / get, 403, 404 -----------------------------------
  const forbiddenCreate = await api.call("/contacts", {
    method: "POST",
    headers: reader.headers,
    body: JSON.stringify({ name: "Refused Reader" }),
  })
  score.check("reader cannot create a contact (403)", forbiddenCreate.status === 403, `http=${forbiddenCreate.status}`)

  const missing = await api.call("/contacts/cont_missing", { headers: admin.headers })
  score.check("missing contact is 404", missing.status === 404, `http=${missing.status}`)

  const created = await api.call("/contacts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Ada Ionescu", email: "ada@example.com", company: "Ada SRL" }),
  })
  const contact = created.body
  score.check(
    "admin creates a contact",
    created.status === 200 && typeof contact?.id === "string" && contact.type === "Contact",
    `http=${created.status} id=${contact?.id}`,
  )

  const unsharedList = await api.call("/contacts", { headers: reader.headers })
  const unsharedGet = await api.call(`/contacts/${contact?.id}`, { headers: reader.headers })
  score.check(
    "unshared record is hidden from the reader",
    unsharedList.status === 200 && unsharedList.body?.total === 0 && unsharedGet.status === 403,
    `list http=${unsharedList.status} total=${unsharedList.body?.total}; get http=${unsharedGet.status}`,
  )

  const adaGrant = await grantRead("crm/contacts", "Contact", contact?.id)

  const list = await api.call("/contacts", { headers: reader.headers })
  score.check(
    "reader lists contacts",
    list.status === 200 && list.body?.total === 1 && list.body?.rows?.[0]?.name === "Ada Ionescu",
    `http=${list.status} total=${list.body?.total}`,
  )

  const got = await api.call(`/contacts/${contact?.id}`, { headers: reader.headers })
  score.check(
    "company stays free text on the contact (no organization entity folded in)",
    got.status === 200 && got.body?.company === "Ada SRL",
    `http=${got.status}`,
  )

  // ---- contracts: invalid payload, create / list / get, party id -----------------
  const fractional = await api.call("/contracts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ title: "Bad money", amount: 12.5, currency: "RON" }),
  })
  score.check(
    "fractional minor units are refused at the schema edge (400)",
    fractional.status === 400,
    `http=${fractional.status}`,
  )

  const forbiddenC = await api.call("/contracts", {
    method: "POST",
    headers: reader.headers,
    body: JSON.stringify({ title: "Refused" }),
  })
  score.check("reader cannot create a contract (403)", forbiddenC.status === 403, `http=${forbiddenC.status}`)

  const missingC = await api.call("/contracts/ctr_missing", { headers: admin.headers })
  score.check("missing contract is 404", missingC.status === 404, `http=${missingC.status}`)

  const c1 = await api.call("/contracts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ title: "Maintenance 2026", amount: 15050, currency: "RON", partyId: contact?.id }),
  })
  const c2 = await api.call("/contracts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ title: "Hosting", amount: 9900, currency: "EUR" }),
  })
  score.check(
    "admin creates contracts in minor units",
    c1.status === 200 && c1.body?.amount === 15050 && c2.status === 200 && c2.body?.amount === 9900,
    `http=${c1.status},${c2.status}`,
  )

  score.check(
    "the minimal relation: partyId stored opaque and nullable",
    c1.body?.partyId === contact?.id && c2.body?.partyId === null,
    `partyId=${c1.body?.partyId}`,
  )

  await grantRead("crm/contracts", "Contract", c1.body?.id)
  await grantRead("crm/contracts", "Contract", c2.body?.id)
  const clist = await api.call("/contracts", { headers: reader.headers })
  score.check("reader lists contracts", clist.status === 200 && clist.body?.total === 2, `http=${clist.status}`)

  // ---- money: per-currency totals, never summed -----------------------------------
  const value = await api.call("/cli/exec", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ line: "crm/contracts:value" }),
  })
  const out = String(value.body?.output ?? "")
  score.check(
    "contracts:value renders per currency, never a cross-currency sum",
    value.status === 200 && out.includes("150.50 RON") && out.includes("99.00 EUR") && !out.includes("249.50"),
    `out=${JSON.stringify(out)}`,
  )

  // ---- organizations: create / get / update, 403, 404, paging, sorting ----------------
  const anonA = await api.call("/organizations")
  score.check("organizations requires authentication (401)", anonA.status === 401, `http=${anonA.status}`)

  const forbiddenA = await api.call("/organizations", {
    method: "POST",
    headers: reader.headers,
    body: JSON.stringify({ name: "Refused Reader SRL" }),
  })
  score.check("reader cannot create an organization (403)", forbiddenA.status === 403, `http=${forbiddenA.status}`)

  const missingA = await api.call("/organizations/acc_missing", { headers: admin.headers })
  score.check("missing organization is 404", missingA.status === 404, `http=${missingA.status}`)

  const createdA = await api.call("/organizations", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({
      name: "Ada Industries SRL",
      industry: "manufacturing",
      website: "https://ada.example.com",
      billingCity: "Iasi",
      employees: 42,
    }),
  })
  const org = createdA.body
  score.check(
    "admin creates an organization",
    createdA.status === 200 && typeof org?.id === "string" && org.type === "Organization" && org.employees === 42,
    `http=${createdA.status} id=${org?.id}`,
  )

  // The write routes (QWB-54, 14c): the manifest's declaration is enforced by the mount
  // wrapper, so every mutation answers 403 to a reader. create is checked above; update here.
  const forbiddenPatchA = await api.call(`/organizations/${org?.id}`, {
    method: "PATCH",
    headers: reader.headers,
    body: JSON.stringify({ billingCity: "Refused" }),
  })
  score.check(
    "reader cannot update an organization (403)",
    forbiddenPatchA.status === 403,
    `http=${forbiddenPatchA.status}`,
  )

  const updatedA = await api.call(`/organizations/${org?.id}`, {
    method: "PATCH",
    headers: admin.headers,
    body: JSON.stringify({ billingCity: "Cluj", rating: "active" }),
  })
  score.check(
    "admin updates an organization (patch keeps the rest)",
    updatedA.status === 200 && updatedA.body?.billingCity === "Cluj" && updatedA.body?.name === "Ada Industries SRL",
    `http=${updatedA.status}`,
  )

  await grantRead("crm/organizations", "Organization", org?.id)
  const pageA = await api.call("/organizations?limit=1&sortBy=name", { headers: reader.headers })
  score.check(
    "organizations list pages and sorts",
    pageA.status === 200 && pageA.body?.rows?.length === 1 && pageA.body?.total === 1 && pageA.body?.sortedBy === "name",
    `http=${pageA.status} sortedBy=${pageA.body?.sortedBy}`,
  )

  // Ticket 07: the list is the kernel's generic one, and the manifest's `searchable` fields
  // are the filter contract. Two organizations, a filter on name, exactly one back.
  const secondOrg = await api.call("/organizations", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Beta Constructions SRL", industry: "construction" }),
  })
  await grantRead("crm/organizations", "Organization", secondOrg.body?.id)
  // Without this the name filter below could pass vacuously (a reader that sees only one
  // organization gets "exactly one" back whatever the filter does).
  const unfilteredA = await api.call("/organizations", { headers: reader.headers })
  score.check(
    "reader lists 2 organizations unfiltered",
    unfilteredA.status === 200 && unfilteredA.body?.total === 2,
    `http=${unfilteredA.status} total=${unfilteredA.body?.total}`,
  )
  const filteredA = await api.call(`/organizations?name=${encodeURIComponent("Ada Industries SRL")}`, {
    headers: reader.headers,
  })
  score.check(
    "filtering organizations by name returns exactly the matching one",
    secondOrg.status === 200 &&
      filteredA.status === 200 &&
      filteredA.body?.total === 1 &&
      filteredA.body?.rows?.length === 1 &&
      filteredA.body?.rows?.[0]?.name === "Ada Industries SRL",
    `http=${filteredA.status} total=${filteredA.body?.total}`,
  )

  // ---- the relation: organizationId on the contact is the one truth -----------------------------
  const withOrganization = await api.call("/contacts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Dan Pop", email: "dan@example.com", organizationId: org?.id }),
  })
  score.check(
    "contact created with organizationId pointing at an existing organization",
    withOrganization.status === 200 && withOrganization.body?.organizationId === org?.id,
    `http=${withOrganization.status} organizationId=${withOrganization.body?.organizationId}`,
  )

  const withoutOrganization = await api.call("/contacts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Maria Radu", email: "maria@example.com" }),
  })
  score.check(
    "contact created without organizationId comes back null",
    withoutOrganization.status === 200 && withoutOrganization.body?.organizationId === null,
    `http=${withoutOrganization.status} organizationId=${withoutOrganization.body?.organizationId}`,
  )

  // Dan Pop is shared; Ada (shared above, organizationId null right now) and Maria Radu are the
  // visible organizationId=null rows the filter has to exclude.
  await grantRead("crm/contacts", "Contact", withOrganization.body?.id)
  await grantRead("crm/contacts", "Contact", withoutOrganization.body?.id)
  const orgContacts = await api.call(`/contacts?organizationId=${org?.id}`, { headers: reader.headers })
  score.check(
    "an organization's contacts are derived by filtering on organizationId",
    orgContacts.status === 200 &&
      orgContacts.body?.total === 1 &&
      orgContacts.body?.rows?.[0]?.name === "Dan Pop" &&
      orgContacts.body?.rows?.[0]?.organizationId === org?.id,
    `http=${orgContacts.status} total=${orgContacts.body?.total}`,
  )

  const badOrganizationId = await api.call("/contacts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Bad Link", email: "bad@example.com", organizationId: "   " }),
  })
  score.check(
    "a blank organizationId is refused at the schema edge (400)",
    badOrganizationId.status === 400,
    `http=${badOrganizationId.status}`,
  )

  // A well-formed but NONEXISTENT organizationId. Today the kernel offers cubes no cross-cube
  // read, so the refusal is not implementable yet: the create SUCCEEDS and this assertion
  // pins today's real behaviour. This is the assertion to FLIP to 400 once the
  // kernel-enforced relation lands (shepherd's separate change in the qwbe repo).
  const ghostOrganizationId = await api.call("/contacts", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Ghost Link", email: "ghost@example.com", organizationId: "org-doesnotexist" }),
  })
  score.check(
    "a nonexistent organizationId is still accepted (kernel relation pending) — FLIP to 400 when it lands",
    ghostOrganizationId.status === 200 && ghostOrganizationId.body?.organizationId === "org-doesnotexist",
    `http=${ghostOrganizationId.status}`,
  )

  // The contacts write routes under the same gate: update answers 403 to a reader (create
  // was checked above), before the admin PATCHes below exercise the allowed path.
  const forbiddenPatchC = await api.call(`/contacts/${contact?.id}`, {
    method: "PATCH",
    headers: reader.headers,
    body: JSON.stringify({ company: "Refused" }),
  })
  score.check("reader cannot update a contact (403)", forbiddenPatchC.status === 403, `http=${forbiddenPatchC.status}`)

  // The move: PATCH /contacts/:id changes the one truth, including unlinking.
  const movedContact = await api.call(`/contacts/${contact?.id}`, {
    method: "PATCH",
    headers: admin.headers,
    body: JSON.stringify({ organizationId: org?.id }),
  })
  score.check(
    "PATCH /contacts/:id moves a contact to another organization",
    movedContact.status === 200 && movedContact.body?.organizationId === org?.id,
    `http=${movedContact.status} organizationId=${movedContact.body?.organizationId}`,
  )
  const unlinkedContact = await api.call(`/contacts/${contact?.id}`, {
    method: "PATCH",
    headers: admin.headers,
    body: JSON.stringify({ organizationId: null }),
  })
  score.check(
    "PATCH /contacts/:id unlinks a contact (organizationId null)",
    unlinkedContact.status === 200 && unlinkedContact.body?.organizationId === null,
    `http=${unlinkedContact.status}`,
  )

  // ---- revoke: the grant is the whole reason the reader sees the record ---------------
  const revoked = await api.call(`/permissions/grants/${encodeURIComponent(String(adaGrant))}`, {
    method: "DELETE",
    headers: admin.headers,
  })
  const afterRevoke = await api.call(`/contacts/${contact?.id}`, { headers: reader.headers })
  score.check(
    "revoked grant hides the record again",
    revoked.status === 200 && afterRevoke.status === 403,
    `revoke http=${revoked.status}; get http=${afterRevoke.status}`,
  )

  // ---- independence: each cube serves while the others are absent -----------------
  // QWBE_MOUNTED restricts the mount set; boot once per cube, one cube at a time. This is the
  // decided minimal relation made observable: neither cube needs the other to start.
  if (checkMode) {
    console.log(
      "independence: skipped under qwbe check (needs a kernel checkout; run QWBE_REPO=<qwbe> node probes/crm.mjs)",
    )
  } else {
    for (const [only, route] of [
      ["crm/contacts", "/contacts"],
      ["crm/contracts", "/contracts"],
      ["crm/organizations", "/organizations"],
    ]) {
      const p2 = await lib.freePort()
      const d2 = scratchDataDir(`crm-only-${only.replace("/", "-")}`)
      const s2 = await lib.startServer(p2, {
        QWBE_DATA_DIR: d2,
        QWBE_MOUNTED: `auth,account,settings,cli,crm,${only}`,
        ...LEGACY,
      })
      if (!s2.alive) {
        score.check(`${only} boots without the other cube`, false, s2.output.split("\n").slice(-3).join(" "))
        dropScratch(d2)
        continue
      }
      try {
        const a2 = makeClient(`http://127.0.0.1:${p2}`)
        const login = await a2.login("admin", "admin")
        const res = await a2.call(route, { headers: login.headers })
        score.check(`${only} serves without the other cube`, res.status === 200 && res.body?.total === 0, `http=${res.status}`)
      } finally {
        await lib.stopServer(s2)
        dropScratch(d2)
      }
    }
  }
} catch (err) {
  if (!(err instanceof Refused)) throw err
  refused = err
} finally {
  if (server) await lib.stopServer(server)
  dropScratch(data)
}

if (refused) {
  console.error(refused.message)
  process.exit(1)
}
process.exit(score.report("crm-pack runtime probe"))
