#!/usr/bin/env node
// Real-browser check for the Contact groups UI (T-1451).
//
// What it proves, in a real Chromium against the real components:
//   - the list, its search and its paging render, and the create form refuses
//     a blank name locally while letting a duplicate through to the server;
//   - create and rename both report a 409 as a duplicate-name refusal;
//   - the CONTACT picker searches `GET /contacts?q=...&limit=20`, and a
//     contact can be chosen BOTH with a real mouse click and with
//     ArrowDown/Enter -- the two ways an operator actually picks;
//   - adding posts the id of the contact that was CHOSEN, in the body, to
//     /contact-groups/<id>/members;
//   - removing posts to /members/remove, and a 404 there is reported as "no
//     longer a member" rather than a crash;
//   - a membership whose contact does not come back says "Contact unavailable"
//     instead of showing a raw id (the backend cannot validate contactId --
//     contract, known limit 1), and never diagnoses WHY (deleted, hidden by
//     permissions and never-existed are indistinguishable from here);
//   - a group of 26 members pages, and removing the ONLY row of the last page
//     lands on a page that exists: never "0-25 of 25", never "Page 2 of 1",
//     and never the empty-group sentence for a page that merely ran out;
//   - adding a contact that is ALREADY a member (chosen from another page,
//     where this page cannot know it is one) states the resulting fact and
//     claims nothing was created -- the 200 carries no created flag;
//   - switching from one group to another drops the previous group's picked
//     contact, and a LATE answer for the previous group cannot paint its name
//     or its members over the one now on screen;
//   - a 403 on the members route and a 404 group both have their own screen;
//   - the picker's popup is NOT clipped by the Card that owns it (the T-1450
//     mistake must not recur in this feature);
//   - NOTHING in this feature calls the account directory or the permissions
//     cube.
//
// Isolated fixture, no live backend, no DB, no live dev server: a bare
// `next dev` is started on a free port (never 4500/4510/4520) from a THROWAWAY
// copy of the project, and EVERY /api/qwbe/* request is intercepted inside the
// browser (Playwright route) before it reaches the Next.js server -- the proxy
// in lib/qwbe.ts never runs, and QWBE_API_URL is removed from the child's
// environment so no backend is reachable even if one slipped through.
//
// MUTATIONS ARE MOCKED, NOT FORWARDED: every non-GET is answered from an
// in-memory store inside this file and recorded, so the write PATHS and BODIES
// are asserted exactly while no row is created anywhere. Any request this
// fixture did not expect is ABORTED and recorded as unexpected.
//
// Playwright is NOT a dependency of this project and nothing is installed for
// this run: chromium comes from an already-installed copy (this project's, or
// the host repo's through QWBE_REPO).
//
// Run: node e2e/contact-groups-check.mjs

import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { basename, dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const frontendDir = dirname(fileURLToPath(import.meta.url)).replace(/\/e2e$/, "")
const qwbeRepo = process.env.QWBE_REPO ?? join(frontendDir, "..", "..", "..", "qwbe")

const FORBIDDEN_PORTS = new Set([4500, 4510, 4520])
const RUN_BUDGET_MS = 240_000
const SHOTS = "/tmp"

// chromium from an ALREADY INSTALLED playwright -- nothing is installed or
// downloaded for this run. A candidate is accepted only if its own browser
// revision is actually present, because two playwright versions pin two
// different chromium builds.
async function loadChromium() {
  const candidates = [
    { label: `this project (${frontendDir})`, from: join(frontendDir, "package.json") },
    { label: `QWBE_REPO (${qwbeRepo})`, from: join(qwbeRepo, "package.json") },
  ]
  const tried = []
  for (const candidate of candidates) {
    let chromium = null
    try {
      const entry = createRequire(candidate.from).resolve("playwright")
      const mod = await import(pathToFileURL(entry).href)
      chromium = mod.default?.chromium ?? mod.chromium ?? null
    } catch (e) {
      tried.push(`${candidate.label}: not resolvable (${String(e)})`)
      continue
    }
    if (!chromium) {
      tried.push(`${candidate.label}: no chromium export`)
      continue
    }
    const exe = chromium.executablePath()
    if (!existsSync(exe)) {
      tried.push(`${candidate.label}: browser not downloaded (${exe})`)
      continue
    }
    console.log(`chromium from ${candidate.label}: ${exe}`)
    return chromium
  }
  throw new Error(`no installed chromium to reuse.\n  ${tried.join("\n  ")}`)
}

// Next refuses a second `next dev` against the SAME project directory
// (.next/dev/lock): this fixture must never touch the live instance on 4520.
// A throwaway copy (node_modules symlinked, nothing reinstalled) gets its own
// root and its own lock. No .env* file is ever copied.
function prepareFixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), "t1451-contact-groups-fixture-"))
  const skipTop = new Set(["node_modules", ".next", ".playwright-mcp", "tsconfig.tsbuildinfo"])
  cpSync(frontendDir, dir, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(frontendDir.length + 1)
      if (rel === "") return true
      if (basename(src).startsWith(".env")) return false
      return !skipTop.has(rel.split("/")[0])
    },
  })
  symlinkSync(join(frontendDir, "node_modules"), join(dir, "node_modules"))
  return dir
}

async function freePort() {
  for (let i = 0; i < 50; i++) {
    const p = await new Promise((resolve) => {
      const srv = createServer()
      srv.on("error", () => resolve(0))
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address()
        const port = addr !== null && typeof addr === "object" ? addr.port : 0
        srv.close(() => resolve(port))
      })
    })
    if (p && !FORBIDDEN_PORTS.has(p)) return p
  }
  throw new Error("could not find a free port")
}

async function waitForUp(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    try {
      const r = await fetch(url)
      if (r.status < 500) return true
    } catch {
      /* not up yet */
    }
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 300))
  }
}

async function visible(locator, timeout = 8000) {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false)
}

const results = []
function check(name, pass, detail = "") {
  results.push({ name, pass })
  console.log(`  ${pass ? "PASS" : "RED "} ${name}${detail ? ` — ${detail}` : ""}`)
  return pass
}

// ---------------------------------------------------------------------------
// Fixture data. The store is mutated by the mocked writes, so a create really
// does appear in the next list response -- the flow is exercised end to end,
// with the "end" being this file and never a database.
// ---------------------------------------------------------------------------
// 26 further contacts, so one group is larger than the 25-row page: the last
// page then holds exactly ONE row, which is what makes the "remove the last
// row of the last page" case reachable. They come AFTER the three named ones
// so an unfiltered search still shows those first.
const BULK = Array.from({ length: 26 }, (_, i) => ({
  id: `cont-bulk-${i}`,
  name: `Bulk Member ${i}`,
  email: `bulk${i}@example.test`,
  company: "Bulk Co",
  organizationId: null,
}))
const CONTACTS = [
  { id: "cont-1", name: "Ada Popescu", email: "ada@example.test", company: "Acme", organizationId: null },
  { id: "cont-2", name: "Adrian Marin", email: "adrian@example.test", company: "Globex", organizationId: null },
  { id: "cont-3", name: "Bogdan Ionescu", email: "b@example.test", company: null, organizationId: null },
  ...BULK,
]
const iso = "2026-09-01T10:00:00.000Z"
const groupRow = (id, name) => ({
  id,
  type: "ContactGroup",
  createdAt: iso,
  deleted: false,
  name,
  normalizedName: name.trim().toLowerCase(),
})
const memberRow = (id, groupId, contactId) => ({
  id,
  type: "ContactGroupMember",
  createdAt: iso,
  deleted: false,
  groupId,
  contactId,
})

async function main() {
  const chromium = await loadChromium()
  const port = await freePort()
  const base = `http://localhost:${port}`

  const fixtureRoot = prepareFixtureRoot()
  console.log(`fixture project root (own .next/dev/lock, cannot collide with 4520): ${fixtureRoot}`)
  console.log(`starting isolated next dev on ${base} (QWBE_API_URL removed: no backend is reachable)`)

  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "QWBE_API_URL"))
  childEnv.NEXT_TELEMETRY_DISABLED = "1"
  const server = spawn(
    process.execPath,
    [join(frontendDir, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "-p", String(port)],
    { cwd: fixtureRoot, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  )
  let serverOut = ""
  server.stdout.on("data", (d) => (serverOut += d.toString()))
  server.stderr.on("data", (d) => (serverOut += d.toString()))
  const exited = new Promise((resolve) => server.on("exit", resolve))

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    try {
      if (server.pid !== undefined) process.kill(-server.pid, "SIGTERM")
    } catch {
      /* already gone */
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))])
    try {
      if (server.exitCode === null && server.pid !== undefined) process.kill(-server.pid, "SIGKILL")
    } catch {
      /* already gone */
    }
    try {
      rmSync(fixtureRoot, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
  const bail = (code) => {
    void stop().then(() => process.exit(code))
  }
  process.on("SIGINT", () => bail(130))
  process.on("SIGTERM", () => bail(143))
  const watchdog = setTimeout(() => {
    console.error(`STOP: run exceeded ${RUN_BUDGET_MS}ms`)
    bail(3)
  }, RUN_BUDGET_MS)
  watchdog.unref()

  const up = await waitForUp(`${base}/login`, 90_000)
  if (!up) {
    console.error("STOP: isolated next dev never came up.\n" + serverOut.slice(-2000))
    await stop()
    process.exit(2)
  }

  let browser = null
  let page = null
  try {
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    // Forged session cookie: middleware.ts only checks presence, and every
    // /api/qwbe/* call is intercepted before any real token check.
    await context.addCookies([
      { name: `qwbe_session_${port}`, value: "fixture-token", domain: "localhost", path: "/", httpOnly: true },
    ])
    page = await context.newPage()

    // `seen` is reset between scenarios to look at one step's traffic;
    // `allSeen` never is, so the "what did this feature ever call" checks at
    // the end cover the WHOLE run.
    const seen = []
    const allSeen = []
    // "contacts" while the pre-existing Contacts list is on screen (it loads
    // its own cube metadata, which is not this feature's traffic), "feature"
    // from the moment Contact groups opens.
    let phase = "contacts"
    const writes = []
    const unexpected = []
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e)))

    // The in-memory backend.
    const groups = [
      groupRow("cgrp-1", "Key accounts"),
      groupRow("cgrp-403", "No contact access"),
      groupRow("cgrp-big", "Bulk group"),
    ]
    const members = [
      memberRow("cgm-1", "cgrp-1", "cont-3"),
      memberRow("cgm-2", "cgrp-1", "cont-gone"),
      ...BULK.map((c, i) => memberRow(`cgm-bulk-${i}`, "cgrp-big", c.id)),
    ]
    // Flipped per scenario, so one page can be made to answer 409/404 on
    // demand without a second group having to exist for it. `delay` holds a
    // group whose answers arrive LATE, which is how a stale response for the
    // group the operator just left is produced on purpose.
    /** @type {{ removeNotFound: boolean, delay: { id: string, ms: number } | null }} */
    const modes = { removeNotFound: false, delay: null }

    const handleRoute = async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const p = url.pathname.replace("/api/qwbe", "")
      const method = req.method()
      let body
      try {
        body = method === "GET" ? undefined : JSON.parse(req.postData() ?? "null")
      } catch {
        body = null
      }
      const record = { method, path: p, query: url.search, phase }
      seen.push(record)
      allSeen.push(record)
      if (method !== "GET") writes.push({ method, path: p, body })

      // One group answers late, so the operator can leave it before its answer
      // arrives. The navigation is client-side, so the pending fetch survives
      // it -- exactly the race a late response must lose.
      const delay = modes.delay
      if (delay !== null && p.startsWith(`/contact-groups/${delay.id}`)) {
        await new Promise((r) => setTimeout(r, delay.ms))
      }

      // The account directory belongs to a different feature. Reaching it from
      // anywhere in this run is a defect, so it is refused loudly.
      if (p.startsWith("/account")) {
        unexpected.push(`${method} ${p}`)
        return route.abort()
      }

      // Saved views and their per-entity permissions are the PRE-EXISTING
      // Contacts list's own traffic (this run starts there to prove the
      // navigation). Answered emptily while that page is on screen; a defect
      // if any page of this feature ever asks -- Contact groups is a business
      // grouping and has no business with the permissions cube.
      if (p === "/views" || p.startsWith("/permissions")) {
        if (phase === "feature") {
          unexpected.push(`${method} ${p}`)
          return route.abort()
        }
        return route.fulfill({ status: 200, json: { rows: [], total: 0, offset: 0, limit: 0 } })
      }

      // The pre-existing Contacts list loads its cube metadata on mount. It is
      // answered (emptily: the list is left immediately) so the first page
      // renders without an error, and it is asserted below that NO page of
      // this feature ever asks for metadata.
      if (p.startsWith("/catalog/")) return route.fulfill({ status: 200, json: { fields: [] } })

      // --- contacts cube -----------------------------------------------------
      if (p === "/contacts") {
        const ids = url.searchParams.get("ids")
        if (ids !== null) {
          const wanted = new Set(ids.split(","))
          const rows = CONTACTS.filter((c) => wanted.has(c.id))
          return route.fulfill({ status: 200, json: { rows, total: rows.length, offset: 0, limit: rows.length } })
        }
        const q = (url.searchParams.get("q") ?? "").toLowerCase()
        if (q === "refuseme") return route.fulfill({ status: 403, json: { message: "crm/contacts:read denied" } })
        const limit = Number(url.searchParams.get("limit") ?? "20")
        const matched = q === "" ? CONTACTS : CONTACTS.filter((c) => c.name.toLowerCase().includes(q))
        // The cube honours `limit`: a search never returns the whole directory.
        const rows = matched.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20)
        return route.fulfill({ status: 200, json: { rows, total: matched.length, offset: 0, limit } })
      }

      // --- contact-groups cube ----------------------------------------------
      if (p === "/contact-groups") {
        if (method === "GET") {
          const q = (url.searchParams.get("q") ?? "").toLowerCase()
          const live = groups.filter((g) => g.normalizedName.startsWith(q))
          return route.fulfill({
            status: 200,
            json: { rows: live, total: live.length, offset: 0, limit: 25, sortedBy: "name" },
          })
        }
        if (method === "POST") {
          const name = String(body?.name ?? "")
          if (name.trim() === "") return route.fulfill({ status: 400, json: { message: "name is required" } })
          const normalized = name.trim().toLowerCase()
          if (groups.some((g) => g.normalizedName === normalized)) {
            return route.fulfill({ status: 409, json: { message: "a group with this name exists" } })
          }
          const created = groupRow(`cgrp-${groups.length + 1}`, name)
          groups.push(created)
          return route.fulfill({ status: 200, json: created })
        }
      }

      const one = p.match(/^\/contact-groups\/([^/]+)$/)
      if (one) {
        const group = groups.find((g) => g.id === one[1])
        if (!group) return route.fulfill({ status: 404, json: { message: "unknown group" } })
        if (method === "GET") return route.fulfill({ status: 200, json: group })
        if (method === "PATCH") {
          const name = String(body?.name ?? "")
          if (name.trim() === "") return route.fulfill({ status: 400, json: { message: "name is required" } })
          const normalized = name.trim().toLowerCase()
          if (groups.some((g) => g.id !== group.id && g.normalizedName === normalized)) {
            return route.fulfill({ status: 409, json: { message: "a group with this name exists" } })
          }
          group.name = name
          group.normalizedName = normalized
          return route.fulfill({ status: 200, json: group })
        }
      }

      const memberList = p.match(/^\/contact-groups\/([^/]+)\/members$/)
      if (memberList) {
        const id = memberList[1]
        if (!groups.some((g) => g.id === id)) return route.fulfill({ status: 404, json: { message: "unknown group" } })
        // The contract's second permission: group readable, members refused
        // because crm/contacts:read is missing.
        if (id === "cgrp-403") return route.fulfill({ status: 403, json: { message: "crm/contacts:read denied" } })
        if (method === "GET") {
          const live = members.filter((m) => m.groupId === id && !m.deleted)
          // Real paging: `page`/`pageSize` in, `rows`/`total`/`offset`/`limit`
          // out. A page past the end answers with NO rows and the true total,
          // which is what the UI has to correct instead of painting.
          const pageSize = Number(url.searchParams.get("pageSize") ?? "25")
          const pageNo = Number(url.searchParams.get("page") ?? "1")
          const limit = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25
          const offset = (Number.isFinite(pageNo) && pageNo > 0 ? pageNo - 1 : 0) * limit
          return route.fulfill({
            status: 200,
            json: { rows: live.slice(offset, offset + limit), total: live.length, offset, limit },
          })
        }
        if (method === "POST") {
          const contactId = String(body?.contactId ?? "")
          if (contactId === "") return route.fulfill({ status: 400, json: { message: "contactId is required" } })
          const existing = members.find((m) => m.groupId === id && m.contactId === contactId && !m.deleted)
          if (existing) return route.fulfill({ status: 200, json: existing })
          const created = memberRow(`cgm-${members.length + 1}`, id, contactId)
          members.push(created)
          return route.fulfill({ status: 200, json: created })
        }
      }

      const memberRemove = p.match(/^\/contact-groups\/([^/]+)\/members\/remove$/)
      if (memberRemove && method === "POST") {
        const id = memberRemove[1]
        const contactId = String(body?.contactId ?? "")
        const hit = members.find((m) => m.groupId === id && m.contactId === contactId && !m.deleted)
        if (modes.removeNotFound || !hit) {
          return route.fulfill({ status: 404, json: { message: "not an active member" } })
        }
        hit.deleted = true
        return route.fulfill({ status: 200, json: { removed: hit.id } })
      }

      if (p.endsWith("/auth/me")) return route.fulfill({ status: 200, json: { permissions: [] } })

      unexpected.push(`${method} ${p}`)
      await route.abort()
    }

    // A late answer may land after the page that asked for it is gone; that is
    // the point of the switch scenario, and fulfilling into a dead frame must
    // not take the run down.
    await page.route("**/api/qwbe/**", (route) => handleRoute(route).catch(() => {}))

    // --- navigation ---------------------------------------------------------
    await page.goto(`${base}/contacts`)
    const navEntry = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Contact groups" })
    check("the main navigation offers Contact groups next to Contacts", await visible(navEntry))
    const fromContacts = page.getByRole("main").getByRole("link", { name: "Contact groups" })
    check("the Contacts page links to Contact groups", await visible(fromContacts))
    await fromContacts.click()
    await page.waitForURL("**/contact-groups")
    check("Contact groups is reachable from Contacts", page.url().endsWith("/contact-groups"), page.url())
    phase = "feature"

    const heading = page.getByRole("heading", { name: "Contact groups", level: 1 })
    check("the page is LABELLED Contact groups", await visible(heading))
    check("the seeded group is listed", await visible(page.getByRole("link", { name: "Key accounts" })))
    await page.screenshot({ path: `${SHOTS}/t1451-contact-groups-list.png`, fullPage: true })

    // --- create: blank refused locally, duplicate warned, 409 reported ------
    const nameField = page.getByLabel("Group name")
    const createButton = page.getByRole("button", { name: "Create group" })
    check("a blank name disables the submit (a 400 is not worth a round trip)", await createButton.isDisabled())
    await nameField.fill("   ")
    check("a whitespace-only name is still blank", await createButton.isDisabled())

    await nameField.fill("  KEY ACCOUNTS ")
    check(
      "a name that differs only in case and spacing is WARNED about before submitting",
      await visible(page.getByText(/already uses this name/i)),
    )
    check("the duplicate warning does NOT block the submit (the server is the arbiter)", !(await createButton.isDisabled()))
    writes.length = 0
    await createButton.click()
    check(
      "a 409 on create is reported as a duplicate-name refusal",
      await visible(page.getByText(/Another group already uses this name/i)),
    )
    const createAttempt = writes.find((w) => w.method === "POST" && w.path === "/contact-groups")
    check(
      "create POSTed the name EXACTLY as typed (no trim, no lowercasing)",
      createAttempt?.body?.name === "  KEY ACCOUNTS ",
      JSON.stringify(createAttempt?.body),
    )

    writes.length = 0
    await nameField.fill("EMEA Partners")
    await createButton.click()
    check("a new group is created and appears in the list", await visible(page.getByRole("link", { name: "EMEA Partners" })))
    check(
      "the created name keeps the operator's own casing",
      await visible(page.getByRole("link", { name: "EMEA Partners", exact: true })),
    )

    // --- the group's own page ----------------------------------------------
    await page.getByRole("link", { name: "Key accounts" }).click()
    await page.waitForURL("**/contact-groups/cgrp-1")
    check("a group opens its own page", page.url().endsWith("/contact-groups/cgrp-1"), page.url())
    check(
      "the members list resolves contact NAMES (one ids= batch, no per-row request)",
      await visible(page.getByRole("link", { name: "Bogdan Ionescu" })),
    )
    const batchCalls = seen.filter((r) => r.path === "/contacts" && r.query.includes("ids="))
    check("one batch request per member page, not one per member", batchCalls.length >= 1 && batchCalls.length <= 2, String(batchCalls.length))
    check(
      "a membership whose contact does not come back says UNAVAILABLE, never shows the raw id",
      await visible(page.getByText("Contact unavailable")),
    )
    check(
      "and it does not diagnose a cause it cannot tell apart (deleted / hidden / never existed)",
      (await page.getByText(/not found|was deleted|no longer exists/i).count()) === 0,
    )
    check("the missing contact's raw id is never rendered", !(await page.getByText("cont-gone").isVisible().catch(() => false)))

    // --- rename 409 ---------------------------------------------------------
    const renameField = page.getByLabel("Rename group")
    await renameField.fill("EMEA Partners")
    writes.length = 0
    await page.getByRole("button", { name: "Rename" }).click()
    check(
      "a 409 on rename is reported as a duplicate-name refusal",
      await visible(page.getByText(/Another group already uses this name/i)),
    )
    const renameAttempt = writes.find((w) => w.method === "PATCH")
    check("rename used PATCH on the group's own path", renameAttempt?.path === "/contact-groups/cgrp-1", renameAttempt?.path)

    await renameField.fill("Key accounts EMEA")
    await page.getByRole("button", { name: "Rename" }).click()
    check(
      "a legitimate rename is accepted and the new name is shown as stored",
      await visible(page.locator('[data-slot="card-title"]', { hasText: "Key accounts EMEA" }).first()),
    )

    // --- the contact picker: it is a CONTACT picker, not the account one ----
    const pickerInput = page.getByRole("combobox", { name: "Contact" })
    const listbox = page.getByRole("listbox", { name: "Search contacts" })
    check("the add field is named Contact, and there is no Username field", await visible(pickerInput))
    check("no account picker is mounted anywhere on this page", (await page.getByRole("combobox", { name: "Username" }).count()) === 0)

    seen.length = 0
    await pickerInput.click()
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    const firstSearch = [...seen].reverse().find((r) => r.path === "/contacts" && !r.query.includes("ids="))
    check(
      "opening the picker searches the CONTACTS cube with the bounded limit",
      Boolean(firstSearch) && firstSearch.query.includes("limit=20"),
      firstSearch?.query,
    )
    await page.screenshot({ path: `${SHOTS}/t1451-picker-open.png` })

    // --- the popup is not clipped by the Card that owns the field -----------
    const owningCard = pickerInput.locator('xpath=ancestor::*[@data-slot="card"][1]')
    const cardOverflow = await owningCard.evaluate((el) => getComputedStyle(el).overflow)
    check("the Card that OWNS the field is overflow-hidden (the bug's precondition)", cardOverflow === "hidden", String(cardOverflow))
    check(
      "the popup is not a DOM descendant of the Card that owns the field",
      await page.locator("[cmdk-list]").first().evaluate((el) => el.closest('[data-slot="card"]') === null),
    )
    const clippers = await page.locator("[cmdk-list]").first().evaluate((el) => {
      const found = []
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n)
        if (`${s.overflowX} ${s.overflowY}`.match(/hidden|clip|scroll|auto/)) {
          found.push(n.getAttribute("data-slot") ?? n.tagName.toLowerCase())
        }
      }
      return found
    })
    check("no clipping ancestor between the popup and <body>", clippers.length === 0, JSON.stringify(clippers))
    const hitTest = await page.evaluate(() => {
      const opt = document.querySelector('[cmdk-list] [role="option"]:not([aria-disabled="true"])')
      if (!opt) return { ok: false, reason: "no enabled option" }
      const r = opt.getBoundingClientRect()
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { ok: Boolean(el && opt.contains(el)), tag: el?.tagName }
    })
    check("elementFromPoint at the option's own position hits the option (not clipped)", hitTest.ok, JSON.stringify(hitTest))

    // --- the existing member is present, disabled, with the reason ----------
    const blocked = page.getByRole("option", { name: /Bogdan Ionescu/ })
    check("an existing member is shown DISABLED with the caller's reason", await visible(blocked.getByText("Already in this group")))
    check("the blocked option is aria-disabled", (await blocked.getAttribute("aria-disabled")) === "true")

    // --- MOUSE: a real click picks the contact, and posts ITS id ------------
    await pickerInput.fill("Ada")
    const optAda = page.getByRole("option", { name: /Ada Popescu/ })
    await optAda.waitFor({ state: "visible", timeout: 15_000 })
    await optAda.click()
    check("a mouse click fills the field with the chosen contact's name", (await pickerInput.inputValue()) === "Ada Popescu", await pickerInput.inputValue())
    check("picking closes the popup", !(await listbox.isVisible()))
    writes.length = 0
    await page.getByRole("button", { name: "Add to group" }).click()
    // The neutral fact, said the same way whether the row was created now or
    // already existed: the 200 carries no created flag and this page does not
    // guess one from a timestamp.
    check("the addition is confirmed on screen", await visible(page.getByText("Ada Popescu is in this group.")))
    const addAda = writes.find((w) => w.method === "POST" && w.path === "/contact-groups/cgrp-1/members")
    check(
      "add POSTed the CHOSEN contact's id in the body, to the group's members route",
      addAda?.body?.contactId === "cont-1",
      JSON.stringify(addAda),
    )
    check("the new member appears in the list", await visible(page.getByRole("link", { name: "Ada Popescu" })))
    await page.screenshot({ path: `${SHOTS}/t1451-member-added.png`, fullPage: true })

    // --- KEYBOARD: ArrowDown/Enter picks, and posts THAT id -----------------
    await pickerInput.click()
    await pickerInput.fill("Adrian")
    const optAdrian = page.getByRole("option", { name: /Adrian Marin/ })
    await optAdrian.waitFor({ state: "visible", timeout: 15_000 })
    await pickerInput.press("ArrowDown")
    check("ArrowDown marks the option as the active one", (await optAdrian.getAttribute("aria-selected")) === "true")
    await pickerInput.press("Enter")
    check("Enter picks the active option", (await pickerInput.inputValue()) === "Adrian Marin", await pickerInput.inputValue())
    writes.length = 0
    await page.getByRole("button", { name: "Add to group" }).click()
    const addAdrian = writes.find((w) => w.method === "POST" && w.path === "/contact-groups/cgrp-1/members")
    check(
      "the keyboard pick posts the id of the contact that was highlighted",
      addAdrian?.body?.contactId === "cont-2",
      JSON.stringify(addAdrian),
    )

    // --- Escape dismisses, and typing after a pick drops the pick -----------
    await pickerInput.click()
    await pickerInput.fill("Ada")
    await page.getByRole("option", { name: /Ada Popescu/ }).waitFor({ state: "visible", timeout: 15_000 })
    await pickerInput.press("Escape")
    check("Escape closes the popup and leaves the caret in the field", !(await listbox.isVisible()))
    check("with nothing picked, Add is disabled (no id can be invented)", await page.getByRole("button", { name: "Add to group" }).isDisabled())

    // --- removal ------------------------------------------------------------
    writes.length = 0
    await page.getByRole("button", { name: "Remove Ada Popescu from this group" }).click()
    check("the removal is confirmed on screen", await visible(page.getByText(/Ada Popescu was removed from this group/)))
    const removal = writes.find((w) => w.method === "POST" && w.path.endsWith("/members/remove"))
    check(
      "remove POSTed the contact id to /members/remove (not DELETE with two path params)",
      removal?.body?.contactId === "cont-1",
      JSON.stringify(removal),
    )
    check(
      "the removed member is gone from the list, because the page reloads from the server",
      await page
        .getByRole("link", { name: "Ada Popescu" })
        .waitFor({ state: "detached", timeout: 8000 })
        .then(() => true)
        .catch(() => false),
    )

    // --- removal 404: not an active member any more -------------------------
    modes.removeNotFound = true
    await page.getByRole("button", { name: "Remove Adrian Marin from this group" }).click()
    check(
      "a 404 on remove says the contact is no longer a member, and does not crash",
      await visible(page.getByText(/no longer a member of this group/i)),
    )
    modes.removeNotFound = false

    // --- a group larger than one page ---------------------------------------
    await page.goto(`${base}/contact-groups/cgrp-big`)
    check("a 26-member group opens on a full first page", await visible(page.getByText("1-25 of 26")))
    check("and says how many pages there actually are", await visible(page.getByText("Page 1 of 2")))

    // --- adding someone who is ALREADY a member, from another page ----------
    // This page holds page 1; member 25 is on page 2, so the picker cannot
    // know it is a member and offers it. That is deliberate: marking every
    // member would mean downloading the whole membership list.
    const bigPicker = page.getByRole("combobox", { name: "Contact" })
    await bigPicker.click()
    await bigPicker.fill("Bulk Member 25")
    const offPage = page.getByRole("option", { name: /Bulk Member 25/ })
    await offPage.waitFor({ state: "visible", timeout: 15_000 })
    check(
      "a member on another page is offered, not falsely marked as known-absent or known-present",
      (await offPage.getAttribute("aria-disabled")) !== "true",
    )
    await offPage.click()
    writes.length = 0
    const membersBefore = members.filter((m) => m.groupId === "cgrp-big" && !m.deleted).length
    await page.getByRole("button", { name: "Add to group" }).click()
    check(
      "an idempotent add states the resulting fact and claims nothing was created",
      await visible(page.getByText("Bulk Member 25 is in this group.")),
    )
    check(
      "no 'was added' / 'new member' claim the 200 cannot back up",
      (await page.getByText(/was added|added to this group|new member/i).count()) === 0,
    )
    const idempotentAdd = writes.find((w) => w.method === "POST" && w.path === "/contact-groups/cgrp-big/members")
    check(
      "the add posted the chosen id, and the server returned the EXISTING row",
      idempotentAdd?.body?.contactId === "cont-bulk-25" &&
        members.filter((m) => m.groupId === "cgrp-big" && !m.deleted).length === membersBefore,
      JSON.stringify(idempotentAdd),
    )
    check("the member count did not move", await visible(page.getByText("1-25 of 26")))

    // --- removing the ONLY row of the LAST page -----------------------------
    // exact: the dev-tools button's own label contains "Next.js".
    await page.getByRole("button", { name: "Next", exact: true }).click()
    check("the last page holds the 26th member alone", await visible(page.getByText("26-26 of 26")))
    check("the last page is page 2 of 2", await visible(page.getByText("Page 2 of 2")))
    await page.getByRole("button", { name: "Remove Bulk Member 25 from this group" }).click()
    check(
      "removing it lands the operator on a page that exists",
      await visible(page.getByText("1-25 of 25")),
    )
    check("the page number is corrected to the last real page", await visible(page.getByText("Page 1 of 1")))
    check(
      "the impossible window and page number are never rendered",
      (await page.getByText("0-25 of 25").count()) === 0 && (await page.getByText("Page 2 of 1").count()) === 0,
    )
    check(
      "a page that merely ran out is never called an empty group",
      (await page.getByText(/no contacts yet/i).count()) === 0,
    )
    check("the corrected page really shows rows", (await page.getByRole("link", { name: /Bulk Member/ }).count()) > 0)
    await page.screenshot({ path: `${SHOTS}/t1451-members-paged.png`, fullPage: true })

    // --- the ONLY group called empty is one the server says holds nothing ---
    const backLink = page.getByRole("link", { name: "← Contact groups" })
    await backLink.click()
    await page.waitForURL("**/contact-groups")
    await page.getByRole("link", { name: "EMEA Partners" }).click()
    check(
      "a group the server reports as holding nothing is the one that says so",
      await visible(page.getByText(/This group has no contacts yet/i)),
    )

    // --- switching groups: the previous group's pick does not travel --------
    const emeaPicker = page.getByRole("combobox", { name: "Contact" })
    await emeaPicker.click()
    await emeaPicker.fill("Ada")
    const adaAgain = page.getByRole("option", { name: /Ada Popescu/ })
    await adaAgain.waitFor({ state: "visible", timeout: 15_000 })
    await adaAgain.click()
    check("a contact is picked on the group being left", (await emeaPicker.inputValue()) === "Ada Popescu")
    writes.length = 0
    await backLink.click()
    await page.waitForURL("**/contact-groups")
    await page.getByRole("link", { name: "Key accounts EMEA" }).click()
    await page.waitForURL("**/contact-groups/cgrp-1")
    const switchedPicker = page.getByRole("combobox", { name: "Contact" })
    check("the previous group's pick is not carried into the next one", (await switchedPicker.inputValue()) === "")
    check(
      "with nothing picked here, Add is disabled: the old id cannot be posted",
      await page.getByRole("button", { name: "Add to group" }).isDisabled(),
    )
    check(
      "no membership write happened during the navigation",
      writes.filter((w) => w.method === "POST" && w.path.includes("/members")).length === 0,
      writes.map((w) => `${w.method} ${w.path}`).join(" | "),
    )

    // --- switching groups: a LATE answer for the old group cannot paint -----
    modes.delay = { id: "cgrp-big", ms: 2500 }
    await backLink.click()
    await page.waitForURL("**/contact-groups")
    await page.getByRole("link", { name: "Bulk group" }).click()
    await page.waitForURL("**/contact-groups/cgrp-big")
    check(
      "while a group is being read, the screen SAYS so instead of staying silent",
      await page
        .getByText("Loading this contact group…")
        .waitFor({ state: "attached", timeout: 8000 })
        .then(() => true)
        .catch(() => false),
    )
    // Left before its answer arrives; the navigation is client-side, so that
    // answer is still in flight and lands under the NEXT group.
    await backLink.click()
    await page.waitForURL("**/contact-groups")
    await page.getByRole("link", { name: "Key accounts EMEA" }).click()
    await page.waitForURL("**/contact-groups/cgrp-1")
    check(
      "the group now on screen is the one that was opened",
      await visible(page.locator('[data-slot="card-title"]', { hasText: "Key accounts EMEA" }).first()),
    )
    await page.waitForTimeout(3500)
    check(
      "the late answer did not paint the previous group's NAME over this one",
      (await page.locator('[data-slot="card-title"]', { hasText: "Bulk group" }).count()) === 0,
    )
    check(
      "the late answer did not paint the previous group's MEMBERS here",
      (await page.getByText(/Bulk Member/).count()) === 0,
    )
    check(
      "the rename field still holds this group's own name",
      (await page.getByLabel("Rename group").inputValue()) === "Key accounts EMEA",
    )
    check(
      "this group's own members are the ones shown",
      await visible(page.getByRole("link", { name: "Bogdan Ionescu" })),
    )
    check(
      "the page number was not inherited from the group that was left",
      await visible(page.getByText("Page 1")),
    )
    modes.delay = null

    // --- 403 on the members route (group readable, contacts not) ------------
    await page.goto(`${base}/contact-groups/cgrp-403`)
    check(
      "a 403 on members is its own screen, not an empty group",
      await visible(page.getByText(/You may not see the contacts in this group/i)),
    )
    check(
      "the group itself still renders when only its members are refused",
      await visible(page.locator('[data-slot="card-title"]', { hasText: "No contact access" }).first()),
    )

    // --- 404 group ----------------------------------------------------------
    await page.goto(`${base}/contact-groups/cgrp-does-not-exist`)
    check("an unknown group says so", await visible(page.getByText(/This contact group does not exist/i)))
    check("the 404 screen offers the way back", await visible(page.getByRole("link", { name: /Back to contact groups/i })))

    // --- the whole run's traffic -------------------------------------------
    const featureCalls = allSeen.filter((r) => r.phase === "feature")
    check(
      "the account directory was never called, in the whole run",
      allSeen.every((r) => !r.path.startsWith("/account")),
      allSeen.filter((r) => r.path.startsWith("/account")).map((r) => r.path).join(" | "),
    )
    // Only this feature's own traffic: the Contacts list this run starts from
    // reads the permissions cube for its saved views, and that page is not
    // under test here.
    check(
      "no page of this feature called the permissions cube",
      featureCalls.every((r) => !r.path.startsWith("/permissions")),
      featureCalls.filter((r) => r.path.startsWith("/permissions")).map((r) => r.path).join(" | "),
    )
    check(
      "every request of this feature went to the contact-groups or contacts cube",
      featureCalls.every((r) => r.path.startsWith("/contact-groups") || r.path.startsWith("/contacts")),
      [...new Set(featureCalls.map((r) => r.path))].join(" | "),
    )
    check(
      "no page of this feature asked for cube metadata",
      featureCalls.every((r) => !r.path.startsWith("/catalog")),
      featureCalls.filter((r) => r.path.startsWith("/catalog")).map((r) => r.path).join(" | "),
    )
    check("no unexpected request was made", unexpected.length === 0, [...new Set(unexpected)].join(" | "))
    check(
      "every write was intercepted in the browser: nothing reached a server",
      writes.every((w) => w.path.startsWith("/contact-groups")),
      writes.map((w) => `${w.method} ${w.path}`).join(" | "),
    )
    check("no uncaught page error during the whole run", pageErrors.length === 0, pageErrors.join(" | "))
  } catch (e) {
    check("the fixture ran to the end", false, String(e))
    if (page) await page.screenshot({ path: `${SHOTS}/t1451-contact-groups-FAIL.png`, fullPage: true }).catch(() => {})
  } finally {
    clearTimeout(watchdog)
    if (browser) await browser.close().catch(() => {})
    await stop()
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} PASS`)
  if (failed.length > 0) {
    console.log("RED:")
    for (const f of failed) console.log(`  - ${f.name}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error("STOP:", e)
  process.exitCode = 2
})
