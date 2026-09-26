#!/usr/bin/env node
// Real-browser regression for the @username UserPicker and the guards of its
// consumer, the record SharingPanel (T-1450).
//
// WHY THE SHARING PANEL. This fixture used to drive the picker through the
// GroupsPanel on /settings, then was repointed here when that mount was
// removed. /settings mounts access groups again (T-1452,
// frontend/docs/t1452-access-groups-report.md), behind an access-scope
// selector, but the coverage stays on SharingPanel: it is the consumer whose
// OWN guards and confirmation line are asserted below, and it is reachable
// without administering anyone's permission groups. The host app's own
// AccountPicker is a DIFFERENT component in a different repo and proves nothing
// about this one.
//
// WHAT IT ADDS over the previous revision (review test gap 4,
// /tmp/qwbe-crm-access-ui-review.log): the old run aborted every non-GET, so
// nothing observed a mutation and a revert of the panels' `target`
// normalization stayed green on 307 unit + 35 browser checks. The lib seam
// alone can NOT catch that regression: createUserGrant -> userGrantPayload
// normalizes again, so the POST body stays correct even with the panel
// reverted. What breaks on a revert is the panel's own GUARDS and its
// confirmation line, and those are asserted here, at the consumer boundary:
//   - raw "@admin" (the operator's own account) must be refused by the self
//     guard with NO confirmation step and NO request;
//   - raw "@maria" once maria holds a grant must be refused by the duplicate
//     guard the same way;
//   - the confirmation line must read "@maria", not "@@maria";
//   - and the POST that DOES leave must carry username "maria".
// Mutations are now FULFILLED from an in-memory store inside the browser and
// their path+body recorded. Nothing is forwarded: the Next proxy never runs,
// QWBE_API_URL is removed from the child's environment, and every request this
// fixture did not expect is ABORTED. No backend, no database, no live server.
//
// Still covered, unchanged: a real mouse click on an ENABLED option, Arrow/Enter
// keyboard selection landing on the exact chosen username, the disabled rows
// staying unpickable, the popup painting and hit-testing OUTSIDE the Card that
// OWNS the field, Escape/Tab/outside dismissal, the four directory answers
// (ready/refused/failed/empty) with Retry, the 300ms debounce, the server page
// bound (limit=20), and the query reaching the backend with its leading "@"
// stripped.
//
// THE FIXTURE ROUTE. SharingPanel lives on the contact/organization detail
// pages, under the cube-metadata renderer, the activity feed and the schema
// panel -- three more subsystems whose mocks would be most of this file and
// none of its subject. So the THROWAWAY COPY (and only it) gets one extra page
// that mounts the REAL SharingPanel with the real layout, the real Card and the
// real styles. It is written into /tmp at run time and deleted with the copy:
// the repo has no such route and nothing is ever built for production from it.
//
// Playwright is NOT a declared dependency of this project and nothing is
// installed for this run: chromium comes from the HOST repo's own
// @playwright/test install, resolved through QWBE_REPO (default ../../../qwbe
// next to this checkout). The undeclared copy sitting in this project's
// node_modules is a last-resort fallback only, for a checkout with no host
// beside it.
//
// Run: node e2e/user-picker-portal-check.mjs
//      QWBE_REPO=/path/to/qwbe node e2e/user-picker-portal-check.mjs

import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { basename, dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const frontendDir = dirname(fileURLToPath(import.meta.url)).replace(/\/e2e$/, "")
const qwbeRepo = process.env.QWBE_REPO ?? join(frontendDir, "..", "..", "..", "qwbe")

const FORBIDDEN_PORTS = new Set([4500, 4510, 4520])
// Nothing here may outlive the run: a hung dev server or a stuck locator would
// otherwise hold the port and the temp root forever.
const RUN_BUDGET_MS = 240_000
const SHOTS = "/tmp"

// The record this fixture shares. Both travel as ONE path segment each
// (lib/sharing.ts: grantsRefPath), so the cube's slash arrives percent-encoded.
const CUBE = "crm/contacts"
const ENTITY_TYPE = "Contact"
const ENTITY_ID = "c-1"
const REF_PATH = `/api/qwbe/permissions/entities/${encodeURIComponent(CUBE)}/${ENTITY_TYPE}/${ENTITY_ID}`
// The panel's default level is TOTAL: the exact six published actions.
const TOTAL_ACTIONS = ["read", "create", "edit", "delete", "share", "transfer"]

// chromium from an ALREADY INSTALLED playwright -- nothing is installed or
// downloaded for this run. The HOST repo (QWBE_REPO, which owns
// @playwright/test and playwright.config.mjs) is the one to reuse; a copy
// resolvable from this project is only a fallback for a checkout that has no
// host next to it.
//
// A candidate is accepted by actually LAUNCHING it, not by looking for a file.
// The previous revision gated on existsSync(chromium.executablePath()) and
// skipped the host for that reason -- wrongly: executablePath() names the full
// chrome build (chromium-1234), while a headless launch on playwright >= 1.49
// runs the separately downloaded headless shell, and only the shell revision is
// present here. Launching is also the only honest test of "is this usable",
// and it never installs anything: a missing browser fails fast with playwright's
// own "run npx playwright install" message, which this fixture reports and
// moves past instead of acting on.
async function launchChromium() {
  const candidates = [
    { label: `QWBE_REPO (${qwbeRepo})`, from: join(qwbeRepo, "package.json") },
    { label: `this project (${frontendDir})`, from: join(frontendDir, "package.json") },
  ]
  const tried = []
  for (const candidate of candidates) {
    if (!existsSync(candidate.from)) {
      tried.push(`${candidate.label}: no package.json there`)
      continue
    }
    let chromium = null
    try {
      const entry = createRequire(candidate.from).resolve("playwright")
      // playwright's entry is CJS: the browser types live on the default
      // export, not on a named one.
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
    // Plain headless first; the explicit headless-shell channel is the fallback
    // for an install that carries only the shell for its pinned revision.
    for (const opts of [{}, { channel: "chromium-headless-shell" }]) {
      try {
        const browser = await chromium.launch(opts)
        console.log(`chromium from ${candidate.label} ${JSON.stringify(opts)}: ${browser.version()}`)
        return browser
      } catch (e) {
        tried.push(`${candidate.label} ${JSON.stringify(opts)}: ${String(e).split("\n")[0]}`)
      }
    }
  }
  throw new Error(`no installed chromium to reuse (nothing was installed).\n  ${tried.join("\n  ")}`)
}

// The fixture-only page. It mounts the REAL SharingPanel (its own Card is the
// overflow-hidden box the portal exists to escape) inside the real root layout,
// and adds one heading to click for the outside-dismiss step. It exists ONLY
// inside the throwaway copy -- see THE FIXTURE ROUTE above.
const FIXTURE_PAGE = `// Written by e2e/user-picker-portal-check.mjs into a THROWAWAY copy of this
// project. It is not part of the repo and never reaches a production build.
import { SharingPanel } from "@/components/sharing-panel"

export default function SharingFixturePage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Sharing fixture</h1>
      <SharingPanel cube="${CUBE}" entityType="${ENTITY_TYPE}" id="${ENTITY_ID}" />
    </main>
  )
}
`

// Next 16 refuses a second `next dev` against the SAME project directory
// (.next/dev/lock) and points at the one already running -- this fixture must
// never touch the live instance on 4520. A throwaway copy of the source
// (node_modules symlinked, nothing reinstalled) gets its own project root and
// its own lock, so this run is a fully separate `next dev`. Secrets are left
// behind: no .env* file is ever copied.
function prepareFixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), "t1450-user-picker-fixture-"))
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
  mkdirSync(join(dir, "src", "app", "sharing-fixture"), { recursive: true })
  writeFileSync(join(dir, "src", "app", "sharing-fixture", "page.tsx"), FIXTURE_PAGE)
  return dir
}

async function freePort() {
  for (let i = 0; i < 50; i++) {
    const p = await new Promise((resolve) => {
      const srv = createServer()
      srv.on("error", () => resolve(0))
      srv.listen(0, "127.0.0.1", () => {
        // address() is AddressInfo | string | null; only the object form has a
        // port, and this listener is always a TCP one.
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

// "Is it on screen?" without a strict-mode throw turning into a silent false:
// every text this fixture looks for is SCOPED to the popup or the form, because
// the picker's sr-only live region carries the same sentences on purpose
// (directoryStatus) and an unscoped getByText matches both.
async function visible(locator, timeout = 6000) {
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
// Fixture directory data. MARIA carries a displayName on purpose: the option's
// accessible name is then "Maria Pop @maria", which is what the locators below
// have to match -- a row is addressed by its handle, never by a bare username
// the DOM does not contain.
// ---------------------------------------------------------------------------
const ADMIN = { id: "u-admin", username: "admin", displayName: "Admin Root" }
const EXISTING = { id: "u-existing", username: "existing", displayName: "Existing User" }
const MARIA = { id: "u-maria", username: "maria", displayName: "Maria Pop" }
const MARIANA = { id: "u-mariana", username: "mariana", displayName: null }
const DIRECTORY = [ADMIN, EXISTING, MARIA, MARIANA]
const GROUP = { id: "g1", cube: CUBE, name: "Test Group", createdBy: "admin", createdAt: "2026-01-01T00:00:00.000Z" }

const grantRow = (id, userId, actions) => ({
  id,
  cube: CUBE,
  entityType: ENTITY_TYPE,
  entityId: ENTITY_ID,
  subject: { kind: "user", userId },
  actions,
  createdBy: ADMIN.username,
  createdAt: "2026-01-01T00:00:00.000Z",
})

async function main() {
  // Fail before anything is started or copied if no chromium can be reused.
  let browser = null
  try {
    browser = await launchChromium()
  } catch (e) {
    console.error("STOP:", String(e))
    process.exit(2)
  }
  const port = await freePort()
  const base = `http://localhost:${port}`

  const fixtureRoot = prepareFixtureRoot()
  console.log(`fixture project root (own .next/dev/lock, cannot collide with 4520): ${fixtureRoot}`)
  console.log(`starting isolated next dev on ${base} (QWBE_API_URL removed: no backend is reachable)`)

  // node + next's own bin, NOT npx: an npm wrapper in between is a process
  // this script can signal but not actually stop, which is how the previous
  // revision orphaned a dev server. `detached` puts the server in its own
  // process GROUP, so one kill takes the whole tree (next-server, the postcss
  // worker) with it.
  // --webpack: Turbopack refuses the node_modules symlink pointing outside the
  // fixture root ("points out of the filesystem root"); webpack does not. It is
  // documented for exactly this case (node_modules/next/dist/docs/01-app/
  // 03-api-reference/08-turbopack.md) and is fixture-only, never the real dev
  // command.
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
  // stop() STARTED vs stop() FINISHED: the exit net below must run when a stop
  // was begun but never got to remove anything.
  let cleaned = false
  // Kills the process GROUP and waits for it to be gone BEFORE deleting the
  // project root under it, so no orphan keeps serving from a directory that no
  // longer exists. Idempotent: every exit path calls it.
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
    cleaned = true
  }
  // One bail wins. A second one used to call process.exit() while the first was
  // still inside stop()'s wait-for-exit, which killed the script before the temp
  // root was removed -- three EPIPE crashes in a row is exactly that case.
  let bailing = false
  const bail = (code) => {
    if (bailing) return
    bailing = true
    void (async () => {
      if (browser) await browser.close().catch(() => {})
      await stop()
      process.exit(code)
    })()
  }
  // exit alone is not enough: Ctrl-C and a supervisor's SIGTERM both left the
  // dev server and the temp root behind.
  process.on("SIGINT", () => bail(130))
  process.on("SIGTERM", () => bail(143))
  // An error thrown OUTSIDE the try below never reaches its finally. The real
  // case: piping this run into `head` closes stdout, the next console.log
  // raises EPIPE, and without this the dev server and the temp root outlive the
  // script. (console.error is guarded for the same reason -- the pipe it would
  // report through is the one that just broke.)
  const crash = (e) => {
    try {
      console.error("STOP:", String(e))
    } catch {
      /* stdio is gone too */
    }
    bail(4)
  }
  process.on("uncaughtException", crash)
  process.on("unhandledRejection", crash)
  // Last net, synchronous: whatever else happened, the process group does not
  // outlive this process and the temp root does not survive it.
  process.on("exit", () => {
    if (cleaned) return
    try {
      if (server.pid !== undefined) process.kill(-server.pid, "SIGKILL")
    } catch {
      /* already gone */
    }
    try {
      rmSync(fixtureRoot, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })
  const watchdog = setTimeout(() => {
    console.error(`STOP: run exceeded ${RUN_BUDGET_MS}ms`)
    bail(3)
  }, RUN_BUDGET_MS)
  watchdog.unref()

  const up = await waitForUp(`${base}/login`, 90_000)
  if (!up) {
    console.error("STOP: isolated next dev never came up.\n" + serverOut.slice(-2000))
    await browser.close().catch(() => {})
    await stop()
    process.exit(2)
  }

  // From here on EVERY exit path goes through the finally below: a thrown
  // locator timeout, a failed launch or a bad assertion all stop the server
  // group and delete the fixture root before this process leaves.
  let page = null
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    // Forge the session cookie: middleware.ts only checks presence
    // (lib/session.ts names it after the port), and every /api/qwbe/* call is
    // intercepted before the server's real token check ever sees it.
    await context.addCookies([
      { name: `qwbe_session_${port}`, value: "fixture-token", domain: "localhost", path: "/", httpOnly: true },
    ])
    page = await context.newPage()

    const seen = []
    const pageErrors = []
    // Mutations that were fulfilled from the store, with the exact body the
    // panel sent. This is the assertion surface test gap 4 was missing.
    const posted = []
    // Anything this fixture refused to answer. Both must stay empty: an
    // unexpected write, or any request to a path no mock covers.
    const blockedWrites = []
    const unexpected = []
    page.on("pageerror", (e) => pageErrors.push(String(e)))

    // The record's grants, in memory. The panel reloads the list after every
    // mutation, so this store is what makes "@maria is now already shared"
    // TRUE for the next guard instead of a second hand-written mock.
    const grants = [grantRow("gr-existing", EXISTING.id, ["read"])]
    let searchMode = "normal" // normal | recovered | recovered-net

    await page.route("**/api/qwbe/**", async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const p = url.pathname
      seen.push({ method: req.method(), path: p, query: url.search })

      // --- the ONE mutation this fixture answers ----------------------------
      if (req.method() === "POST" && p === `${REF_PATH}/grants/user`) {
        const body = req.postDataJSON()
        posted.push({ path: p, body })
        // Resolved through the directory on purpose: a username the directory
        // does not know (what a reverted panel would send) produces a grant
        // whose subject cannot be labelled, exactly as the backend's own 404
        // would leave the screen.
        const account = DIRECTORY.find((a) => a.username === body?.username)
        const grant = grantRow(`gr-${grants.length + 1}`, account?.id ?? `unknown-${body?.username}`, body?.actions ?? [])
        grants.push(grant)
        return route.fulfill({ status: 200, json: grant })
      }
      if (req.method() !== "GET") {
        // No other mutation is answered, and none is forwarded either.
        blockedWrites.push(`${req.method()} ${p}`)
        await route.abort()
        return
      }

      if (p.endsWith("/auth/me")) return route.fulfill({ status: 200, json: { ...ADMIN, permissions: [] } })
      if (p.endsWith("/openapi.json")) return route.fulfill({ status: 200, json: {} })
      if (p === `${REF_PATH}/grants`) {
        return route.fulfill({ status: 200, json: { rows: grants, total: grants.length, offset: 0, limit: 50 } })
      }
      if (p.endsWith("/permissions/groups")) return route.fulfill({ status: 200, json: [GROUP] })
      if (p.endsWith("/account")) {
        const ids = url.searchParams.get("ids")
        if (ids !== null) {
          const wanted = new Set(ids.split(","))
          return route.fulfill({ status: 200, json: { rows: DIRECTORY.filter((a) => wanted.has(a.id)) } })
        }
        const q = url.searchParams.get("q") ?? ""
        if (q === "refuseme") {
          if (searchMode === "recovered") return route.fulfill({ status: 200, json: { rows: DIRECTORY } })
          return route.fulfill({ status: 403, json: { message: "account:read denied" } })
        }
        if (q === "failnet") {
          if (searchMode === "recovered-net") return route.fulfill({ status: 200, json: { rows: DIRECTORY } })
          return route.abort("connectionrefused")
        }
        if (q === "zzzznomatch") return route.fulfill({ status: 200, json: { rows: [] } })
        if (q === "loadslow") {
          await new Promise((r) => setTimeout(r, 700))
          return route.fulfill({ status: 200, json: { rows: DIRECTORY } })
        }
        const rows = DIRECTORY.filter((a) => q === "" || a.username.includes(q))
        return route.fulfill({ status: 200, json: { rows } })
      }
      unexpected.push(`${req.method()} ${p}`)
      await route.abort()
    })

    await page.goto(`${base}/sharing-fixture`)
    check("fixture route rendered (no /login bounce)", page.url().endsWith("/sharing-fixture"), page.url())

    // --- the panel is the REAL one: its grant list loaded -------------------
    const sharedWith = page.getByRole("list", { name: "Shared with" })
    check(
      "the real SharingPanel loaded its grant page (the existing chip is on screen)",
      await visible(sharedWith.getByText("@existing"), 20_000),
    )

    // cmdk puts role="combobox" on its input AFTER the caller's props, so this
    // control is NEVER a "textbox".
    const input = page.getByRole("combobox", { name: "Username" })
    const chevron = page.getByRole("button", { name: /account suggestions/ })
    const listbox = page.getByRole("listbox", { name: "Search users" })
    // An option's accessible name is its whole SUBTREE: "Maria Pop @maria" for
    // a row with a displayName, "@mariana" for one without, and the exclusion
    // Badge joins it when the row is blocked ("Maria Pop @maria Already
    // shared"). So a row is addressed by its handle followed by a word boundary:
    // anchoring at the end would stop matching the moment the row is disabled,
    // and a bare substring would make "@maria" match "@mariana" as well.
    const handle = (name) => new RegExp(`@${name}(\\s|$)`)
    const optAdmin = page.getByRole("option", { name: handle(ADMIN.username) })
    const optMaria = page.getByRole("option", { name: handle(MARIA.username) })
    const optMariana = page.getByRole("option", { name: handle(MARIANA.username) })
    const optExisting = page.getByRole("option", { name: handle(EXISTING.username) })
    // The portalled popup itself: the parent of cmdk's list is Popover.Content.
    // Every message below is read from HERE, never from the page, so the
    // sr-only live region (which repeats them by design) cannot stand in for a
    // panel that never painted.
    const popup = page.locator("[cmdk-list]").first().locator("xpath=..")
    const shareButton = page.getByRole("button", { name: "Share", exact: true })
    const confirmPanel = page.getByRole("group", { name: "Confirm share" })

    const lastAccountSearch = () => [...seen].reverse().find((r) => r.path.endsWith("/account") && !r.query.includes("ids="))

    // --- open with empty query: first page, bounded limit=20 ----------------
    seen.length = 0
    await chevron.click()
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    const firstReq = lastAccountSearch()
    check(
      "open-with-empty-query hits GET .../account with no q and limit=20",
      Boolean(firstReq) && firstReq.query.includes("limit=20") && !firstReq.query.includes("q="),
      firstReq?.query,
    )
    await page.screenshot({ path: `${SHOTS}/t1450-picker-open.png` })

    // --- the two excluded accounts are present, disabled, with their reasons -
    check("the account that already holds a grant shows the panel's reason", await visible(optExisting.getByText("Already shared")))
    check("that option is aria-disabled", (await optExisting.getAttribute("aria-disabled")) === "true")
    check("the operator's OWN account shows the panel's self reason", await visible(optAdmin.getByText("You manage this record")))
    check("the operator's own option is aria-disabled", (await optAdmin.getAttribute("aria-disabled")) === "true")
    const beforeBlocked = await input.inputValue()
    await optExisting.click({ force: true })
    check(
      "clicking a blocked row picks nothing (the field is unchanged)",
      (await input.inputValue()) === beforeBlocked,
      await input.inputValue(),
    )

    // --- clipping: the popup paints and hit-tests OUTSIDE ITS OWN Card ------
    // The Card is derived from the FIELD, not from "the first card on the
    // page", so the assertion cannot pass by measuring some other card.
    const owningCard = input.locator('xpath=ancestor::*[@data-slot="card"][1]')
    const cardBox = await owningCard.boundingBox()
    const popupBox = await page.locator("[cmdk-list]").first().boundingBox()
    const cardOverflow = await owningCard.evaluate((el) => getComputedStyle(el).overflow)
    check("the Card that OWNS the field is overflow-hidden (the bug's precondition)", cardOverflow === "hidden", String(cardOverflow))
    check(
      "the popup is not a DOM descendant of the Card that owns the field",
      await page.locator("[cmdk-list]").first().evaluate((el) => el.closest('[data-slot="card"]') === null),
    )
    // The layout-independent form of the fix: there is no clipping box of ANY
    // kind between the popup and <body>. Reverting the portal puts the
    // overflow-hidden Card back on this chain and turns this RED, whatever the
    // panel's height or the page's content happens to be that day.
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
    check(
      "the popup paints over the owning Card's own area (it is positioned against the field)",
      Boolean(popupBox && cardBox && popupBox.y > cardBox.y && popupBox.y < cardBox.y + cardBox.height),
      JSON.stringify({ cardBox, popupBox }),
    )
    const hitTest = await page.evaluate(() => {
      const opt = document.querySelector('[cmdk-list] [role="option"]:not([aria-disabled="true"])')
      if (!opt) return { ok: false, reason: "no enabled option" }
      const r = opt.getBoundingClientRect()
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { ok: Boolean(el && opt.contains(el)), tag: el?.tagName }
    })
    check("elementFromPoint at the option's own screen position hits the option (not clipped)", hitTest.ok, JSON.stringify(hitTest))
    await page.screenshot({ path: `${SHOTS}/t1450-picker-clipping.png` })

    // --- mouse click selects, and fills the BARE username, never the handle --
    await optMaria.click()
    check("mouse click on an ENABLED option sets the exact username (no @)", (await input.inputValue()) === "maria", await input.inputValue())
    check("picking closes the popup", !(await listbox.isVisible()))

    // --- keyboard: type "@ma", Arrow x2 + Enter -----------------------------
    await input.click()
    await input.fill("")
    seen.length = 0
    await page.keyboard.type("@ma", { delay: 30 })
    await page.waitForTimeout(120)
    check("debounce: no request fired before ~300ms", lastAccountSearch() === undefined, JSON.stringify(lastAccountSearch()))
    await page.waitForTimeout(400)
    const afterDebounce = lastAccountSearch()
    check(
      "after the debounce the backend receives the query WITHOUT the leading @",
      Boolean(afterDebounce) && afterDebounce.query.includes("q=ma") && !afterDebounce.query.toLowerCase().includes("%40"),
      afterDebounce?.query,
    )
    check("the field still shows exactly what was typed, sigil included", (await input.inputValue()) === "@ma", await input.inputValue())
    check("the heading echoes the typed text", await visible(popup.getByText("Matches for “@ma”")))
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    check(
      "the arrows carry the active option: the second enabled row is aria-selected",
      (await optMariana.getAttribute("aria-selected")) === "true" && (await optMaria.getAttribute("aria-selected")) === "false",
    )
    await page.keyboard.press("Enter")
    check("Arrow x2 + Enter selects the SECOND enabled option, not the first", (await input.inputValue()) === "mariana", await input.inputValue())

    // --- Escape closes, caret stays in the field ----------------------------
    await chevron.click()
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    await page.keyboard.press("Escape")
    check("Escape closes the popup", !(await listbox.isVisible()))
    check("Escape leaves the caret in the input", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Username")

    // --- Tab off the control's OWN focusables dismisses ---------------------
    await chevron.click()
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    await page.keyboard.press("Tab") // input -> chevron, still inside the control
    check("Tab to the control's own chevron keeps the popup open", await listbox.isVisible())
    await page.keyboard.press("Tab") // chevron -> the access level radios, outside the control
    check("Tab leaving the control's last focusable dismisses the popup", !(await listbox.isVisible()))

    // --- outside pointerdown dismisses --------------------------------------
    await chevron.click()
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    await page.getByRole("heading", { name: "Sharing fixture" }).click()
    check("a pointerdown outside the control dismisses the popup", !(await listbox.isVisible()))

    // --- loading state while the request is in flight -----------------------
    await input.click()
    await input.fill("loadslow")
    await page.waitForTimeout(150)
    check('shows "Searching…" while the request is in flight', await visible(popup.getByText("Searching…"), 2000))
    await page.waitForTimeout(800)

    // --- refused (403): note + Retry, then recovers -------------------------
    await input.fill("")
    await input.fill("refuseme")
    check("403 shows the refusal note", await visible(popup.getByText("Directory search unavailable: type the exact username.")))
    const refusedRetry = popup.getByRole("button", { name: "Retry" })
    check("403 offers a Retry button", await visible(refusedRetry))
    searchMode = "recovered"
    await refusedRetry.click()
    check("Retry after a refusal re-asks and shows suggestions once granted", await visible(optMaria))

    // --- failed (network): message + Retry, then recovers -------------------
    await input.fill("")
    await input.fill("failnet")
    check("a network failure shows a failed message, not empty", await visible(popup.getByText("network error")))
    const failedRetry = popup.getByRole("button", { name: "Retry" })
    check("network failure offers a Retry button", await visible(failedRetry))
    searchMode = "recovered-net"
    await failedRetry.click()
    check("Retry after a network failure re-asks and shows suggestions once it lands", await visible(optMaria))

    // --- empty: a real zero-row answer says "no matches" --------------------
    await input.fill("")
    await input.fill("zzzznomatch")
    check('a real empty page says "no matches", not "refused" or "failed"', await visible(popup.getByText("no matches")))

    // --- popover stays inside a short viewport ------------------------------
    await page.setViewportSize({ width: 900, height: 420 })
    await input.fill("")
    // The chevron TOGGLES: the popup is still open from the step above, so
    // clicking it here would close the very list this step measures.
    await input.click()
    await listbox.waitFor({ state: "visible", timeout: 15_000 })
    // The panel is display:none while closed, so floating-ui measures it at
    // 0x0 and only corrects the position on the next autoUpdate tick after it
    // unhides: measure after the list is actually painted.
    await page.waitForTimeout(300)
    const constrained = await page.locator("[cmdk-list]").first().boundingBox()
    const viewport = page.viewportSize()
    check(
      "popup repositions to stay fully inside a short viewport (Popper flip)",
      Boolean(constrained && viewport && constrained.y >= 0 && constrained.y + constrained.height <= viewport.height + 1),
      JSON.stringify({ constrained, viewport }),
    )
    await page.setViewportSize({ width: 1280, height: 900 })

    // =======================================================================
    // The consumer boundary: the panel's own guards and the mutation it sends.
    // Everything below types the username BY HAND, sigil included, and never
    // picks a suggestion -- the manual path is the one that was broken.
    // =======================================================================

    // A typed username, then the popup out of the way: Share is a real click
    // on a real button, not a form submitted around the open list.
    const typeRaw = async (text) => {
      await input.click()
      await input.fill("")
      await input.fill(text)
      await page.waitForTimeout(450)
      await page.keyboard.press("Escape")
      await shareButton.click()
    }

    // --- self: "@admin" is the operator's own account -----------------------
    await typeRaw(`@${ADMIN.username}`)
    check(
      "raw @admin is refused by the panel's SELF guard (it reads the identity, not the typed text)",
      await visible(page.getByText("you already manage this record")),
    )
    check("the self refusal offers no confirmation step", !(await confirmPanel.isVisible()))
    check("nothing was sent for the operator's own account", posted.length === 0, JSON.stringify(posted))

    // --- duplicate: "@existing" already holds a grant on this page ----------
    await typeRaw(`@${EXISTING.username}`)
    check(
      "raw @existing is refused by the panel's DUPLICATE guard",
      await visible(page.getByText(`already shared directly with @${EXISTING.username} on this page`)),
    )
    check("the duplicate refusal offers no confirmation step", !(await confirmPanel.isVisible()))
    check("nothing was sent for an account that already holds a grant", posted.length === 0, JSON.stringify(posted))

    // --- the one that goes through: raw "@maria" ----------------------------
    await typeRaw(`@${MARIA.username}`)
    check("raw @maria reaches the confirmation step", await visible(confirmPanel))
    // "@@maria" here is the reverted panel: subjectLabel is built from the
    // normalized identity, so this line is the cheapest witness of the seam.
    const subject = await confirmPanel.locator("strong").first().textContent()
    check("the confirmation names the account ONCE (@maria, not @@maria)", subject === `@${MARIA.username}`, String(subject))
    await confirmPanel.getByRole("button", { name: "Confirm share" }).click()
    await visible(sharedWith.getByText(`@${MARIA.username}`), 10_000)
    check("exactly one grant was POSTed", posted.length === 1, JSON.stringify(posted))
    const sent = posted[0]
    check(
      "it went to this record's own grants/user route",
      sent?.path === `${REF_PATH}/grants/user`,
      String(sent?.path),
    )
    // The assertion test gap 4 asked for: the wire carries the IDENTITY.
    check(
      'the POST body carries username "maria" -- the sigil never reaches the backend',
      sent?.body?.username === MARIA.username,
      JSON.stringify(sent?.body),
    )
    check(
      "the POST body carries the EXPLICIT TOTAL action set (no silent backend default)",
      JSON.stringify(sent?.body?.actions) === JSON.stringify(TOTAL_ACTIONS),
      JSON.stringify(sent?.body?.actions),
    )
    check("the new grant shows as its own chip after the reload", await visible(sharedWith.getByText(`@${MARIA.username}`)))
    check("the field is cleared after a successful share", (await input.inputValue()) === "", await input.inputValue())

    // --- and now maria is the duplicate: the guard follows the SERVER state -
    await input.click()
    await input.fill("mar")
    await visible(optMaria)
    check(
      "the freshly shared account is now rendered disabled with its reason",
      (await optMaria.getAttribute("aria-disabled")) === "true" && (await visible(optMaria.getByText("Already shared"))),
    )
    await typeRaw(`@${MARIA.username}`)
    check(
      "raw @maria is now refused by the duplicate guard too",
      await visible(page.getByText(`already shared directly with @${MARIA.username} on this page`)),
    )
    check("the second attempt sent nothing", posted.length === 1, JSON.stringify(posted))

    check("no request reached a path this fixture does not mock", unexpected.length === 0, unexpected.join(" | "))
    check("no mutation other than the one grant was attempted", blockedWrites.length === 0, blockedWrites.join(" | "))
    check("no uncaught page error during the whole run", pageErrors.length === 0, pageErrors.join(" | "))
  } catch (e) {
    check("the fixture ran to the end", false, String(e))
    if (page) await page.screenshot({ path: `${SHOTS}/t1450-picker-FAIL.png`, fullPage: true }).catch(() => {})
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
