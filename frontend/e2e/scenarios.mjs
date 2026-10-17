// @ts-check
// The end-to-end scenarios, driven through the Orca browser.
//
// Every scenario records one PASS / RED / SKIP line and at least one screenshot into the
// dated results directory. Nothing here talks to qwbe directly except the metadata lookups
// and the API read-backs; everything else goes through the real UI. The scenario numbers
// are authoring order, not run order (10 runs between 06 and 08).

import {
  setPage,
  CONFIG,
  click,
  keypress,
  orca,
  pageArgs,
  record,
  refFor,
  shot,
  snapshot,
  type,
  waitForText,
  waitForUrl,
  qwbeClient,
} from "./lib.mjs"
import { CONTACT_LINKED, ORG_A, ORG_B } from "./seed.mjs"
// Circular on purpose: list-scenarios uses the helpers below, at call time only.
import { scenarioListActions, scenarioListUrl, scenarioReaderEcho } from "./list-scenarios.mjs"

// Read at call time: the runner sets CONFIG.frontendPort after picking a free port.
const FE = () => `http://localhost:${CONFIG.frontendPort}`

const tabs = []
export async function open(path) {
  const r = orca("tab", "create", "--url", `${FE()}${path}`)
  orca("tab", "switch", "--page", r.browserPageId, "--focus")
  tabs.push(r.browserPageId)
  // Address this tab by id from here on, so no other tab can answer for it.
  setPage(r.browserPageId)
  // The snapshot target must actually BE this tab: with stale tabs around, create/switch
  // can lose the race, so poll the origin and re-switch until it matches (or fail loudly).
  for (let i = 0; i < 15; i++) {
    const s = snapshot()
    if (s.origin.startsWith(FE())) return r.browserPageId
    try {
      orca("tab", "switch", "--page", r.browserPageId, "--focus")
    } catch {
      /* retried below */
    }
    await new Promise((res) => setTimeout(res, 2000))
  }
  throw new Error(`tab for ${FE()}${path} never became the snapshot target (origin stayed ${snapshot().origin})`)
}
/** Close leftover tabs of PREVIOUS e2e runs (they point at dead local ports). */
export function closeStaleTabs() {
  try {
    const list = orca("tab", "list")
    for (const t of list.tabs ?? []) {
      const url = String(t.url ?? "")
      if (/^http:\/\/localhost:\d+\/(login|organizations|contacts|me)/.test(url) && !tabs.includes(t.browserPageId)) {
        orca("tab", "close", "--page", t.browserPageId)
      }
    }
  } catch {
    /* best effort */
  }
}
export function closeTabs() {
  for (const id of tabs.reverse()) {
    try {
      orca("tab", "close", "--page", id)
    } catch {
      /* already gone */
    }
  }
  tabs.length = 0
}

/** Wait until the Sign in button is ENABLED (the app gates the submit on hydration). */
async function waitSignInEnabled(timeout = 15_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (!/button "Sign in" \[disabled/.test(snapshot().text)) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 500))
  }
}

/**
 * Log in through the real UI. Types are verified against the DOM values
 * before the submit: an earlier failure showed the username field holding
 * "reader" plus trailing spaces (nothing this suite typed), so the values
 * are asserted, corrected, and only then submitted.
 */
async function loginThroughUi(username, password) {
  await open("/login")
  await settle("Sign in")
  if (!(await waitSignInEnabled())) return false
  const readFields = () =>
    orca(
      "eval",
      "--expression",
      "JSON.stringify([document.getElementById('username')?.value ?? null, document.getElementById('password')?.value ?? null])",
    ).result
  for (let attempt = 0; attempt < 4; attempt++) {
    const [u, p] = JSON.parse(String(readFields() ?? "[]"))
    if (u === username && p === password) break
    if (u !== username) {
      await clickStable((v) => v.role === "textbox" && v.name === "Username", "Username")
      type(username)
    }
    if (p !== password) {
      await clickStable((v) => v.role === "textbox" && v.name === "Password", "Password")
      type(password)
    }
  }
  const [u, p] = JSON.parse(String(readFields() ?? "[]"))
  if (u !== username || p !== password) return false
  return Boolean(await clickStable((v) => v.role === "button" && v.name === "Sign in", "Sign in"))
}

/**
 * Click a freshly found ref, retrying with a NEW snapshot when Orca reports
 * the ref stale: a React re-render between the snapshot and the click can
 * replace the node the ref pointed at. The retry is on the FINDER, not on
 * the same ref — a stale ref is re-resolved, never re-clicked blindly.
 * Returns the ref that was clicked, or null when nothing matched.
 */
export async function clickStable(pred, name) {
  for (let i = 0; i < 8; i++) {
    const snap = snapshot()
    const entry = Object.entries(snap.refs).find(([, v]) => pred(v))
    if (!entry) {
      await new Promise((r) => setTimeout(r, 500))
      continue
    }
    const [ref, info] = entry
    try {
      click(ref, name ?? info.name)
      return ref
    } catch (e) {
      if (!String(e.message).includes("browser_stale_ref")) throw e
    }
  }
  return null
}

/** Find a ref with fresh snapshots (no click; focus must stay where it is). */
async function findStable(pred) {
  for (let i = 0; i < 8; i++) {
    const snap = snapshot()
    const ref = Object.entries(snap.refs).find(([, v]) => pred(v))?.[0]
    if (ref) return ref
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

export async function settle(text, timeout = 30_000) {
  const ok = await waitForText(text, timeout)
  if (!ok) throw new Error(`page never showed ${JSON.stringify(text)}`)
}

// Short settle after a click that triggers a React render: the next snapshot
// must see the DOM the click produced, not the one before it.
export const pause = async (ms = 800) => {
  await new Promise((r) => setTimeout(r, ms))
  // Touch the page with a trivial eval: the accessibility snapshot served
  // right after a render can lag the DOM, and this forces Orca to re-read it.
  try {
    orca("eval", "--expression", "1", ...pageArgs())
  } catch {
    /* the touch is best effort; the wait below still applies */
  }
}

/**
 * Leave a Radix Select open with its options readable in the snapshot.
 *
 * `orca focus` on an OPEN Radix select closes it (asynchronously); open by
 * keyboard only when the DOM says the select is closed, and when the list is
 * open wait for the options to reach the snapshot -- that is what the caller
 * reads.
 */
async function openSelect(ref) {
  const listOpen = () =>
    orca(
      "eval",
      "--expression",
      "(() => String(document.querySelector('[role=option]') !== null))()",
      ...pageArgs(),
    )?.result === "true"
  const deadline = Date.now() + 15_000
  for (;;) {
    if (listOpen()) {
      if (Object.values(snapshot().refs).some((v) => v.role === "option")) return true
    } else {
      orca("focus", "--element", ref, ...pageArgs())
      orca(
        "eval",
        "--expression",
        "(() => { const el = document.activeElement; if (!el || el.getAttribute('role') !== 'combobox') return 'no-combobox'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'opened' })()",
        ...pageArgs(),
      )
    }
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 250))
  }
}

// --- 1. login with the correct credentials lands on the identity page -----------
export async function scenarioLogin() {
  const name = "login lands on the identity page"
  if (!(await loginThroughUi(CONFIG.username, CONFIG.password))) {
    shot("01-login-page-RED", { full: true })
    return record(name, "RED", "login form fields not found or the submit never enabled", "01-login-page-RED.png")
  }
  const landed = await waitForUrl(".*/me.*")
  const textShown = await waitForText("Signed in as", 20_000)
  if (!landed || !textShown) {
    const fields = orca(
      "eval",
      "--expression",
      "JSON.stringify([...document.querySelectorAll('input')].map((i) => [i.name || i.id, i.value]))",
    )
    console.log(`  login fields after submit: ${fields.result}`)
    const page = orca("eval", "--expression", "document.body.innerText.slice(0, 300)")
    console.log(`  login page after submit: ${JSON.stringify(page.result)}`)
  }
  const snap = snapshot()
  shot("01-after-login")
  const identityShown = landed && snap.origin.endsWith("/me") && textShown
  return record(
    name,
    identityShown ? "PASS" : "RED",
    identityShown ? `identity page shows ${CONFIG.username}` : `landed on ${snap.origin}`,
    "01-after-login.png",
  )
}

// --- 2. organization list: seeded rows, sorting, searching ----------------------
export async function scenarioList() {
  const name = "organization list shows, sorts and searches the seeded organizations"
  await open("/organizations")
  await settle(ORG_A)
  let snap = snapshot()
  shot("02-organizations-list")
  const showsBoth = snap.text.includes(ORG_A) && snap.text.includes(ORG_B)
  if (!showsBoth) {
    shot("02-organizations-list-RED", { full: true })
    return record(name, "RED", `list does not show both seeded orgs (${snap.origin})`, "02-organizations-list-RED.png")
  }

  // Sorting: click the Organization Name header's sort BUTTON twice for a
  // descending sort, then Beta must come first. The role matters: the
  // columnheader cell carries the same name and clicking it does nothing. The
  // demo rows ride on top and contain neither seeded name.
  const SORT = "Organization Name"
  const sortBtn = (v) => v.role === "button" && (v.name ?? "").startsWith(SORT)
  if (!Object.values(snap.refs).some(sortBtn)) {
    shot("02-sort-RED", { full: true })
    return record(name, "RED", `${SORT} column header not clickable`, "02-sort-RED.png")
  }
  await clickStable(sortBtn)
  await waitForText(`${SORT} ↑`)
  await clickStable(sortBtn)
  await waitForText(`${SORT} ↓`)
  snap = snapshot()
  shot("02-organizations-sorted-desc")
  const betaFirst = snap.text.indexOf(ORG_B) >= 0 && snap.text.indexOf(ORG_B) < snap.text.indexOf(ORG_A)
  if (!betaFirst) {
    shot("02-sort-RED", { full: true })
    return record(name, "RED", "sorting by name descending did not put Beta before Alpha", "02-sort-RED.png")
  }

  // Searching: the quick search (a prefix of the name) narrows the list to Alpha only.
  const SEARCH = "Search (prefix match)"
  const filter = await clickStable((v) => (v.role === "searchbox" || v.role === "textbox") && v.name === SEARCH, SEARCH)
  if (!filter) {
    shot("02-search-RED", { full: true })
    return record(name, "RED", "quick search box not found", "02-search-RED.png")
  }
  type(ORG_A)
  // Every operand is a settled value: waitForText is awaited on its own line,
  // and the Beta check runs on one snapshot taken after the filter had time
  // to apply. Writing `await waitForText(X) && (async () => {...})()` binds
  // await to the LEFT operand only, so the right side becomes an unawaited
  // Promise -- always truthy -- and the assertion could never fail.
  const alphaShown = await waitForText(ORG_A)
  await new Promise((r) => setTimeout(r, 1500))
  const betaGone = !snapshot().text.includes(ORG_B)
  const narrowed = alphaShown && betaGone
  snap = snapshot()
  shot("02-organizations-searched")
  return record(name, narrowed ? "PASS" : "RED", narrowed ? "sorted desc and searched to Alpha" : "search did not narrow the list", "02-organizations-searched.png")
}

// --- 3. inline edit on an editable field saves without a reload -----------------
export async function scenarioInlineEdit(api) {
  const name = "inline edit on an editable field saves and shows without a reload"
  await open("/organizations")
  await settle(ORG_A)
  let snap = snapshot()
  // Unique per run: a previous run that crashed before teardown can leave its
  // edited value on a row, and a constant value would let THIS run's read-back
  // mistake that stale row for this run's save.
  const newValue = `E2E City Edited ${Date.now()}`
  const findEditor = (refs) =>
    Object.entries(refs).find(([, v]) => v.role === "textbox" && /city/i.test(v.name ?? ""))?.[0]
  // The row for Alpha: editable cells carry buttons whose accessible name is
  // "Edit <label>"; the city column is "Billing City". The edit lands on the
  // first city-ish button and the row context is verified by the saved value.
  // Match the BUTTON ref: the table cell carries the same accessible name
  // ("Edit Billing City") and clicking the cell does nothing.
  // The edit affordance is gated on hydration in the app: until the client
  // has committed, an editable cell renders as plain text, so a click can
  // never land on DOM the handler is not attached to yet (the race the
  // earlier retry loop hid). Wait for the BUTTON to appear, then click ONCE
  // (no retries, no synthetic fallback click).
  let cityBtn
  for (let i = 0; i < 20 && !cityBtn; i++) {
    cityBtn = Object.entries(snap.refs).find(
      ([, v]) => v.role === "button" && /^Edit .*City/i.test(v.name ?? ""),
    )?.[0]
    if (!cityBtn) {
      await new Promise((r) => setTimeout(r, 500))
      snap = snapshot()
    }
  }
  if (!cityBtn) {
    shot("03-edit-RED", { full: true })
    return record(name, "RED", "no editable City cell button found", "03-edit-RED.png")
  }
  const clicked = await clickStable((v) => v.role === "button" && /^Edit .*City/i.test(v.name ?? ""))
  if (!clicked) {
    shot("03-edit-RED", { full: true })
    return record(name, "RED", "no editable City cell button found", "03-edit-RED.png")
  }
  await pause(1500)
  snap = snapshot()
  // The open editor is a textbox labelled with the field's label ("Billing City");
  // match the role, not just the name, so the column header cannot answer.
  let target = findEditor(snap.refs)
  let firstClickOpened = Boolean(target)
  // One click is the contract. If it produced NO editor at all (an Orca
  // pointer blip on the locked desktop, not the app: the app-side delayed
  // focus that closed the editor is fixed and unit-gated), click ONCE more
  // on a freshly resolved ref and say out loud that the first click failed.
  if (!target) {
    const again = await clickStable((v) => v.role === "button" && /^Edit .*City/i.test(v.name ?? ""))
    if (!again) {
      shot("03-edit-RED", { full: true })
      const cityRefs = Object.entries(snap.refs)
        .filter(([, v]) => /city/i.test(v.name ?? ""))
        .map(([k, v]) => `${k}:${v.role}`)
        .join(",")
      return record(name, "RED", `edit input did not open; city refs: ${cityRefs}`, "03-edit-RED.png")
    }
    await pause(1500)
    snap = snapshot()
    target = findEditor(snap.refs)
  }
  if (!target) {
    shot("03-edit-RED", { full: true })
    const cityRefs = Object.entries(snap.refs)
      .filter(([, v]) => /city/i.test(v.name ?? ""))
      .map(([k, v]) => `${k}:${v.role}`)
      .join(",")
    return record(name, "RED", `edit input did not open; city refs: ${cityRefs}`, "03-edit-RED.png")
  }
  // The input is autofocused and carries the old value; replace it wholesale.
  keypress("ctrl+a")
  type(newValue)
  keypress("Return")
  const saved = await waitForText(newValue, 15_000)
  snap = snapshot()
  shot("03-after-inline-edit")
  const noError = !snap.text.includes("invalid") && !snap.text.includes("failed")
  // Page text is not proof the save reached the backend: the open editor held
  // the very text being waited for. Read the rows back through the API and
  // compare the field (the form of scenarioCustomFieldTypes). The value is
  // unique to this run, so the row that carries it can only be this run's save.
  const rows = (await api.call("/organizations?limit=50")).body?.rows ?? []
  const savedRow = rows.find((r) => r.billingCity === newValue)
  const verdict = saved && noError && Boolean(savedRow) ? "PASS" : "RED"
  const note = firstClickOpened ? "" : " (first click produced no editor; one freshly resolved retry)"
  return record(
    name,
    verdict,
    verdict === "PASS"
      ? `${newValue} visible after Enter and billingCity read back through the API${note}`
      : `new value missing on the page or in the backend row (api rows: ${rows.length}, page=${Boolean(saved)}, noError=${noError})`,
    "03-after-inline-edit.png",
  )
}

// --- 4. inline edit on a NON-editable field is refused --------------------------
// The list hides every non-editable column by design (fields absent
// from the create payload are backend bookkeeping), so the refusal is asserted
// where a non-editable field IS shown: the detail page. It must render the
// field's value as plain text and offer no edit affordance for it.
export async function scenarioNonEditable(api) {
  const name = "inline edit on a field the metadata marks not editable is refused"
  // The cube name is a single path parameter for qwbe, so it must be encoded;
  // unencoded it is two path segments and qwbe answers 404.
  const meta = await api.call(`/catalog/${encodeURIComponent("crm/organizations")}/metadata`)
  const fields = meta.body?.fields ?? []
  const nonEditable = fields.find((f) => !f.editable && f.name !== "id" && f.name !== "type") ?? fields.find((f) => !f.editable)
  if (!nonEditable) {
    shot("04-noneditable-RED", { full: true })
    return record(name, "RED", "metadata exposes no non-editable column at all", "04-noneditable-RED.png")
  }
  const row = (await api.call("/organizations?limit=1")).body?.rows?.[0]
  if (!row) {
    shot("04-noneditable-RED", { full: true })
    return record(name, "RED", "no organization row available to open", "04-noneditable-RED.png")
  }
  await open(`/organizations/${row.id}`)
  const value = row[nonEditable.name]
  await settle(nonEditable.label)
  let snap = snapshot()
  shot("04-noneditable-field")
  const valueShown = snap.text.includes(nonEditable.label) && (value === null || value === undefined || snap.text.includes(String(value)))
  // Refusal means: no edit affordance anywhere for this field. A click on the
  // value's text must open no editor either.
  const editButton = refFor(snap.refs, new RegExp(`^Edit ${nonEditable.label}`))
  if (!valueShown || editButton) {
    shot("04-noneditable-RED", { full: true })
    return record(name, "RED", editButton ? `field ${nonEditable.name} renders an edit affordance despite editable=false` : `detail page does not show ${nonEditable.name}`, "04-noneditable-RED.png")
  }
  if (await clickStable((v) => (v.name ?? "") === String(value) || (v.name ?? "").includes(nonEditable.label))) {
    const after = snapshot()
    const openedInput = refFor(after.refs, (n) => n === nonEditable.label)
    shot("04-noneditable-after-click")
    if (openedInput) {
      shot("04-noneditable-RED", { full: true })
      return record(name, "RED", `clicking the ${nonEditable.name} cell opened an editor`, "04-noneditable-RED.png")
    }
  }
  return record(name, "PASS", `field ${nonEditable.name} (editable=false) shows as plain text and offers no inline edit`, "04-noneditable-field.png")
}

// --- 5. organization -> contact -> back to the organization ---------------------
export async function scenarioNavigation(seed) {
  const name = "navigation organization to contact and back"
  // The related contacts are on the More Information tab (T-1814).
  await open(`/organizations/${seed.orgA.id}?tab=more`)
  await settle(CONTACT_LINKED)
  let snap = snapshot()
  shot("05-organization-detail")
  const contactLink = await clickStable((v) => v.name === CONTACT_LINKED && v.role !== "heading")
  if (!contactLink) {
    shot("05-nav-RED", { full: true })
    return record(name, "RED", "organization detail does not link to its contact", "05-nav-RED.png")
  }
  const onContact = await waitForUrl(".*/contacts/.*")
  snap = snapshot()
  shot("05-contact-detail")
  if (!onContact || !snap.text.includes(ORG_A)) {
    shot("05-nav-RED", { full: true })
    return record(name, "RED", `contact page did not show the organization (${snap.origin})`, "05-nav-RED.png")
  }
  const backLink = await clickStable((v) => (v.name ?? "").includes(ORG_A) && v.role !== "heading")
  if (!backLink) {
    shot("05-nav-RED", { full: true })
    return record(name, "RED", "contact detail does not link back to the organization", "05-nav-RED.png")
  }
  const back = await waitForUrl(new RegExp(`.*/organizations/${seed.orgA.id}.*`))
  snap = snapshot()
  shot("05-back-on-organization")
  return record(name, back ? "PASS" : "RED", back ? "round trip organization -> contact -> organization" : "did not land back on the organization", "05-back-on-organization.png")
}

// --- 6. logout returns to the login page and /me is no longer reachable ---------
export async function scenarioLogout() {
  const name = "logout returns to the login page and the identity page is gone"
  await open("/me")
  await settle("Signed in as")
  let snap = snapshot()
  shot("06-me-before-logout")
  // Sign out lives in the shell's account menu (T-1812): open it, then pick the item.
  const menu = await clickStable((v) => v.role === "button" && String(v.name).startsWith("Account menu"), "Account menu")
  const btn = menu && (await clickStable((v) => v.role === "menuitem" && v.name === "Sign out", "Sign out"))
  if (!btn) {
    shot("06-logout-RED", { full: true })
    return record(name, "RED", "Sign out not found in the account menu", "06-logout-RED.png")
  }
  const back = await waitForUrl(".*/login.*")
  snap = snapshot()
  shot("06-after-logout")
  if (!back) {
    shot("06-logout-RED", { full: true })
    return record(name, "RED", `logout did not return to /login (${snap.origin})`, "06-logout-RED.png")
  }
  // The identity page must be unreachable now: a direct visit is bounced back to /login.
  await open("/me")
  const bounced = await waitForUrl(".*/login.*")
  snap = snapshot()
  shot("06-me-after-logout")
  shot("06-final", { full: true })
  // The bounce now carries the destination (/login?next=%2Fme), so compare the
  // PATH, not the whole URL: endsWith("/login") would call a correct redirect
  // a failure.
  const onLogin = new URL(snapshot().origin).pathname === "/login"
  const pass = bounced && onLogin && !snap.text.includes("Signed in as")
  return record(name, pass ? "PASS" : "RED", pass ? "/me redirects to /login after logout" : "/me still reachable", "06-final.png")
}

// --- 10. create an organization through the F1 form ------------------------------
// (Numbered 10 at authoring time; it runs between 05 and 07 in runAll.) The
// create form is the shared organization form (T-1815): vtiger's blocks, the
// required fields marked, the submit through the server proxy, landing on the
// new row's detail page. externalId must NOT be
// offered: it carries the import identity, and
// its unique partial index turns a hand-typed duplicate into a 500, not a
// refusal.
export async function scenarioCreateOrganization(api) {
  const name = "create organization through the form lands on its detail page"
  const orgName = `E2E Created Org ${Date.now()}`
  await open("/organizations/new")
  await settle("New organization")
  let snap = snapshot()
  shot("10-create-form")
  const externalOffered = Object.values(snap.refs).some((v) => (v.name ?? "") === "External Id")
  const nameBox = await clickStable((v) => v.role === "textbox" && v.name === "Organization Name", "Name")
  if (!nameBox || externalOffered) {
    shot("10-create-RED", { full: true })
    return record(
      name,
      "RED",
      externalOffered ? "the form offers externalId (finding 7)" : "no Name input on the create form",
      "10-create-RED.png",
    )
  }
  type(orgName)
  // Industry, required by vtiger (the form requires it once the metadata
  // does): a select of vtiger's P4 values (pick the first one offered); typed
  // only if it is ever a text input again.
  const industryRef = await findStable((v) => (v.role === "combobox" || v.role === "textbox") && v.name === "Industry")
  const industryRole = industryRef ? snapshot().refs[industryRef]?.role : null
  if (industryRole === "textbox") {
    await clickStable((v) => v.role === "textbox" && v.name === "Industry", "Industry")
    type("e2e manufacturing")
  } else {
    const option = industryRef && (await openSelect(industryRef))
      ? Object.entries(snapshot().refs).find(([, v]) => v.role === "option")?.[0]
      : null
    if (!option) {
      shot("10-create-RED", { full: true })
      return record(name, "RED", "no Industry select with P4 values on the form", "10-create-RED.png")
    }
    click(option, snapshot().refs[option]?.name)
    await pause()
  }
  const submit = await clickStable((v) => v.role === "button" && v.name === "Save", "Save")
  if (!submit) {
    shot("10-create-RED", { full: true })
    return record(name, "RED", "no Save button on the form", "10-create-RED.png")
  }
  // The detail route is /organizations/<id>; /organizations/new must NOT match.
  const landed = await waitForUrl("organizations/(?!new)", 20_000)
  snap = snapshot()
  shot("10-after-create")
  // Page text is not proof the create reached qwbe: read the row back.
  const row = (await api.call("/organizations?limit=50")).body?.rows?.find((r) => r.name === orgName)
  const pass = landed && snap.text.includes(orgName) && Boolean(row)
  return record(
    name,
    pass ? "PASS" : "RED",
    pass
      ? `form submitted, detail page shows the name, row read back through the API (${row?.id})`
      : `landed=${landed}, name shown=${snap.text.includes(orgName)}, backend row=${Boolean(row)}`,
    "10-after-create.png",
  )
}

// --- 7. a custom field defined in Settings, used on the list, deleted ---
// The definitions panel lives off the lists and onto /settings: the panel is
// always rendered there (no button opens it) and the Entity selector picks the
// cube its definitions target. Define and delete happen on /settings; the value
// is set inline on the contacts list like any other cell.
const CF_NAME = "e2eChannel"
const CF_LABEL = "E2E Channel"
const CF_OPTIONS = "email, phone, event"

/**
 * Point the Settings panel at one entity. The selector is component state, so
 * EVERY return to /settings must choose again; without it the panel shows the
 * previously selected cube's definitions.
 */
async function chooseEntity(label) {
  const combo = await clickStable((v) => v.role === "combobox" && v.name === "Entity", "Entity")
  if (!combo) return false
  if (!(await openSelect(combo))) return false
  const option = Object.entries(snapshot().refs).find(([, v]) => v.role === "option" && v.name === label)?.[0]
  if (!option) return false
  click(option, snapshot().refs[option]?.name)
  await pause()
  return true
}

export async function scenarioCustomField(api) {
  const name = "custom field defined in Settings appears, is set inline, and disappears on delete"
  await dropDefinitions(api, "crm/contacts", [CF_NAME])

  // 1. open Settings; the panel is on the page, addressed at the contacts cube
  await open("/settings")
  if (!(await waitForText("Fields defined at runtime", 15_000))) {
    shot("07-panel-RED", { full: true })
    return record(name, "RED", "the definitions panel is not on the settings page", "07-panel-RED.png")
  }
  if (!(await chooseEntity("Contacts"))) {
    shot("07-entity-RED", { full: true })
    return record(name, "RED", "the Entity selector did not switch to Contacts", "07-entity-RED.png")
  }
  let snap = snapshot()
  shot("07-panel-open")

  // 2. define a select field
  const nameBox = await clickStable((v) => v.role === "textbox" && v.name === "Name", "Name")
  if (!nameBox) {
    shot("07-define-RED", { full: true })
    return record(name, "RED", "definition form inputs not found", "07-define-RED.png")
  }
  keypress("ctrl+a")
  type(CF_NAME)
  await clickStable((v) => v.role === "textbox" && v.name === "Label", "Label")
  keypress("ctrl+a")
  type(CF_LABEL)
  // Type select: open the combobox and pick "select".
  const typeCombo = await clickStable((v) => v.role === "combobox" && /type/i.test(v.name ?? ""))
  if (!typeCombo) {
    shot("07-define-RED", { full: true })
    return record(name, "RED", "type combobox not found in the definition form", "07-define-RED.png")
  }
  await openSelect(typeCombo)
  snap = snapshot()
  const selectOption = Object.entries(snap.refs).find(([, v]) => v.role === "option" && v.name === "select")?.[0]
  if (!selectOption) {
    shot("07-define-RED", { full: true })
    return record(name, "RED", "the select option is missing from the type combobox", "07-define-RED.png")
  }
  click(selectOption, snapshot().refs[selectOption]?.name)
  await new Promise((r) => setTimeout(r, 500))
  snap = snapshot()
  // The options input appears only for type=select (metadata-driven form).
  const optRef = await clickStable((v) => v.role === "textbox" && /Options/.test(v.name ?? ""))
  if (!optRef) {
    shot("07-define-RED", { full: true })
    return record(name, "RED", "options input did not appear for type select", "07-define-RED.png")
  }
  type(CF_OPTIONS)
  snap = snapshot()
  const addBtn = await clickStable((v) => v.role === "button" && v.name === "Add field", "Add field")
  if (!addBtn) {
    shot("07-define-RED", { full: true })
    return record(name, "RED", "Add field button not found", "07-define-RED.png")
  }
  // The definition appears in the panel's table (the panel re-reads after the
  // change), and the column appears on the contacts list from the list's own
  // metadata read.
  const definedShown = await waitForText(CF_LABEL, 15_000)
  snap = snapshot()
  shot("07-definition-appears")
  if (!definedShown) {
    shot("07-column-RED", { full: true })
    return record(name, "RED", `definition ${CF_LABEL} did not appear in the panel`, "07-column-RED.png")
  }

  // 2b. set it inline on the seeded contact, on the list. The affordance is
  // gated on hydration in the app, so wait for the BUTTON (never click plain
  // text) and then click ONCE.
  await open("/contacts")
  await settle(CONTACT_LINKED)
  if (!(await waitForText(CF_LABEL, 15_000))) {
    shot("07-column-RED", { full: true })
    return record(name, "RED", `column ${CF_LABEL} did not appear on the contacts list`, "07-column-RED.png")
  }
  let editBtn
  editBtn = await clickStable((v) => v.role === "button" && v.name === `Edit ${CF_LABEL}`)
  if (!editBtn) {
    shot("07-inline-RED", { full: true })
    return record(name, "RED", "no inline edit affordance on the custom column", "07-inline-RED.png")
  }
  snap = snapshot()
  const cellCombo = await clickStable((v) => v.role === "combobox" && v.name === CF_LABEL)
  if (!cellCombo) {
    shot("07-inline-RED", { full: true })
    return record(name, "RED", "the custom cell did not open a select", "07-inline-RED.png")
  }
  await openSelect(cellCombo)
  snap = snapshot()
  const emailOption = Object.entries(snap.refs).find(([, v]) => v.role === "option" && v.name === "email")?.[0]
  if (!emailOption) {
    shot("07-inline-RED", { full: true })
    return record(name, "RED", "the custom select does not offer the defined options", "07-inline-RED.png")
  }
  click(emailOption, snapshot().refs[emailOption]?.name)
  shot("07-inline-saved")

  // 4. the save must be VISIBLE in the cell, not merely "somewhere on the
  // page". The panel is not on the list anymore (F2), so the options string
  // can only come from a stray panel render: require the cell's edit button
  // AND the options string absent AND the bare value text on the page.
  await pause()
  snap = snapshot()
  const panelClosed = !snap.text.includes(CF_OPTIONS)
  const cellBtn = Object.entries(snap.refs).find(
    ([, v]) => v.role === "button" && v.name === `Edit ${CF_LABEL}`,
  )?.[0]
  const cellShowsValue = snap.text.includes("email")
  // The cell text is not proof either (the panel sat right above it): read the
  // contact back through the API and require the saved value under `custom` --
  // the save must reach qwbe, not only the page.
  //
  // Through the ROW'S OWN endpoint, like scenarioCustomFieldTypes and the
  // runner's fold probe. NOT through the list: the kernel widens only an
  // endpoint's top-level success schema with `custom`
  // (qwbe core/src/runtime-composition.ts, widenTypeLiteral), so a list
  // response carries `custom` on the `{rows, total}` envelope while Effect
  // strips it from every row inside. A list-based check here reported
  // backend=false against a save that had in fact landed.
  const savedToBackend = (
    await Promise.all(
      ((await api.call("/contacts?limit=50")).body?.rows ?? []).map((r) => api.call(`/contacts/${r.id}`)),
    )
  ).some((r) => r.body?.custom?.[CF_NAME] === "email")
  if (!panelClosed || !cellBtn || !cellShowsValue || !savedToBackend) {
    shot("07-inline-RED", { full: true })
    return record(
      name,
      "RED",
      `cell after save: panel closed=${panelClosed}, edit button=${Boolean(cellBtn)}, value text=${cellShowsValue}, backend=${savedToBackend}`,
      "07-inline-RED.png",
    )
  }

  // 5. delete the definition in Settings (F2); the column disappears on the
  // list's next metadata read. Navigation reset the Entity selector, so
  // address the contacts cube again. The delete is a two-step confirm in the
  // UI: the first click scans how many rows carry a value.
  await open("/settings")
  if (!(await waitForText("Fields defined at runtime", 15_000))) {
    shot("07-delete-RED", { full: true })
    return record(name, "RED", "the definitions panel is not on the settings page", "07-delete-RED.png")
  }
  if (!(await chooseEntity("Contacts"))) {
    shot("07-delete-RED", { full: true })
    return record(name, "RED", "the Entity selector did not switch back to Contacts", "07-delete-RED.png")
  }
  snap = snapshot()
  const deleteBtn = await clickStable((v) => v.role === "button" && v.name === `Delete ${CF_LABEL}`)
  if (!deleteBtn) {
    shot("07-delete-RED", { full: true })
    return record(name, "RED", "delete button for the definition not found", "07-delete-RED.png")
  }
  await pause()
  snap = snapshot()
  const confirmBtn = await clickStable((v) => v.role === "button" && v.name === `Confirm delete ${CF_LABEL}`)
  if (!confirmBtn) {
    shot("07-delete-RED", { full: true })
    return record(name, "RED", "the delete confirm step did not appear", "07-delete-RED.png")
  }
  // The definition row must vanish from the panel...
  let rowGone = true
  const panelDeadline = Date.now() + 15_000
  for (;;) {
    snap = snapshot()
    rowGone = !Object.values(snap.refs).some((v) => v.role === "button" && v.name === `Delete ${CF_LABEL}`)
    if (rowGone || Date.now() >= panelDeadline) break
    await new Promise((r) => setTimeout(r, 500))
  }
  // ...and the column must vanish from the list on its next metadata read.
  await open("/contacts")
  await settle(CONTACT_LINKED)
  let columnGone = true
  const deadline = Date.now() + 15_000
  for (;;) {
    snap = snapshot()
    columnGone = !snap.text.includes(CF_LABEL)
    if (columnGone || Date.now() >= deadline) break
    await new Promise((r) => setTimeout(r, 500))
  }
  shot("07-column-gone")
  // Both vanishings are page reads, not proof qwbe dropped the definition.
  // Read the definitions back.
  const stillDefined = (await definitionRows(api, "crm/contacts")).some((r) => r.name === CF_NAME)
  const deleted = rowGone && columnGone && !stillDefined
  return record(
    name,
    deleted ? "PASS" : "RED",
    deleted
      ? "column appeared, was set inline, the saved value is in the cell and in the backend, and the definition is gone from the panel, the list and qwbe after the confirmed delete"
      : `after delete: row gone=${rowGone}, column gone=${columnGone}, still defined in qwbe=${stillDefined}; page text: ${snap.text.replace(/\s+/g, " ").slice(0, 300)}`,
    "07-column-gone.png",
  )
}

// --- 8. the permission half -----------------------------------------------
// A reader (customfields:read only, no customfields:write) gets the Settings
// area's refusal message instead of the definitions panel (F2 moved the panel
// there), and a direct call to the definition endpoints answers 403 from
// qwbe. Runs AFTER the logout scenario: logging in as the reader replaces the
// browser's session cookie, and the admin scenarios are done by then.
export async function scenarioReader(qwbePort) {
  const name = "a reader sees no definitions panel and the definition API refuses the write"
  if (!(await loginThroughUi("reader", "reader"))) {
    const fields = orca(
      "eval",
      "--expression",
      "JSON.stringify([document.getElementById('username')?.value, document.getElementById('password')?.value])",
    )
    shot("08-reader-RED", { full: true })
    return record(name, "RED", `reader login through the UI failed; fields: ${fields.result}`, "08-reader-RED.png")
  }
  await open("/settings")
  // The refusal message is the reader's view of the settings page. Settle on
  // IT, not on "Settings": the nav link carries that label on every page.
  const told = await waitForText("does not have", 15_000)
  let snap = snapshot()
  shot("08-reader-settings")
  const noPanel = !snap.text.includes("Fields defined at runtime")
  const noAdd = !Object.values(snap.refs).some((v) => v.role === "button" && v.name === "Add field")
  if (!told || !noPanel || !noAdd) {
    shot("08-reader-RED", { full: true })
    return record(
      name,
      "RED",
      `the reader sees management UI on /settings (message=${told}, noPanel=${noPanel}, noAdd=${noAdd})`,
      "08-reader-RED.png",
    )
  }
  // Direct calls against qwbe itself, with a reader session of its own:
  // qwbe must refuse the write, not the proxy.
  const reader = qwbeClient(qwbePort)
  await reader.login("reader", "reader")
  const post = await reader.call("/customfields", {
    method: "POST",
    body: { targetCube: "crm/contacts", name: "readerProbe", fieldType: "text" },
  })
  const del = await reader.call("/customfields/whatever-id", { method: "DELETE" })
  const list = await reader.call("/customfields?cube=crm/contacts&limit=5")
  const refusalOk = post.status === 403 && del.status === 403
  const readOk = list.status === 200
  return record(
    name,
    refusalOk && readOk ? "PASS" : "RED",
    refusalOk && readOk
      ? `no panel for the reader; direct POST http ${post.status}, DELETE http ${del.status}, list http ${list.status}`
      : `POST ${post.status}, DELETE ${del.status}, list ${list.status}`,
    "08-reader-contacts.png",
  )
}


// --- 9. the type coverage ----------------------------------------------------
// bool / number / date custom fields set inline (bool through the checkbox
// editor, number and date through the text editor), a required TEXT field
// emptied to "" refused with qwbe's own message, and every definition
// cleaned up through the two-step delete. Values are asserted against the
// backend (the row's own API) as well as the page.
const V_NAME = "e2eScore"
const V_LABEL = "E2E Score"
const B_NAME = "e2eVip"
const B_LABEL = "E2E Vip"
const D_NAME = "e2eStart"
const D_LABEL = "E2E Start"
const N_NAME = "e2eNote"
const N_LABEL = "E2E Note"

/**
 * Define one field through the open panel; fresh snapshot for every step.
 *
 * `required` ticks the panel's Required box before the field is added: the
 * refusal this suite asserts on ("... is required and cannot be emptied")
 * only exists for a field the definition actually marks required, and the
 * panel starts every new field optional.
 */
async function defineField(name, label, typeName, options, required = false) {
  for (let i = 0; i < 20; i++) {
    const nameBox = await clickStable((v) => v.role === "textbox" && v.name === "Name", "Name")
    // The combobox is only LOOKED UP here: clicking it would move the focus
    // away from the name box the next type() must land in.
    const typeCombo = await findStable((v) => v.role === "combobox" && /type/i.test(v.name ?? ""))
    if (nameBox && typeCombo) {
      keypress("ctrl+a")
      type(name)
      const labelBox2 = await clickStable((v) => v.role === "textbox" && v.name === "Label", "Label")
      keypress("ctrl+a")
      type(label)
      if (labelBox2 && (await openSelect(typeCombo))) {
        const s2 = snapshot()
        const option = Object.entries(s2.refs).find(([, v]) => v.role === "option" && v.name === typeName)?.[0]
        if (option) {
          click(option, snapshot().refs[option]?.name)
          await new Promise((r) => setTimeout(r, 500))
          const s3 = snapshot()
          if (typeName === "select") {
            const optionsBox = Object.entries(s3.refs).find(([, v]) => v.role === "textbox" && /Options/.test(v.name ?? ""))?.[0]
            if (optionsBox && (await clickStable((v) => v.role === "textbox" && /Options/.test(v.name ?? "")))) {
              type(options ?? "")
            }
          }
          if (required) {
            const box = await clickStable((v) => v.role === "checkbox" && v.name === "Required", "Required")
            if (!box) return false
            await new Promise((r) => setTimeout(r, 300))
            // A click that misses the checkbox would define an OPTIONAL field
            // and quietly make the refusal assertion unprovable; read the box
            // back instead of assuming the click landed.
            const checked = orca(
              "eval",
              "--expression",
              `(() => { const el = document.getElementById("cf-required");` +
                ` return el ? String(el.getAttribute("aria-checked")) : "missing" })()`,
              ...pageArgs(),
            )
            if (checked?.result !== "true") return false
          }
          const addBtn = await clickStable((v) => v.role === "button" && v.name === "Add field", "Add field")
          if (addBtn) {
            // The definition row appears (its delete button names it).
            for (let j = 0; j < 20; j++) {
              if (Object.values(snapshot().refs).some((v) => v.role === "button" && v.name === `Delete ${label}`)) return true
              await new Promise((r) => setTimeout(r, 500))
            }
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** Open the inline editor of one custom cell with a SINGLE click. */
async function openCellEditor(label) {
  for (let i = 0; i < 20; i++) {
    const snap = snapshot()
    const btn = Object.entries(snap.refs).find(
      ([, v]) => v.role === "button" && v.name === `Edit ${label}`,
    )?.[0]
    if (btn) {
      try {
        click(btn, snap.refs[btn]?.name)
        await pause(1200)
        return true
      } catch (e) {
        if (!String(e.message).includes("browser_stale_ref")) throw e
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** Delete one definition through the two-step confirm; true when its row is gone. */
async function deleteField(label) {
  for (let i = 0; i < 20; i++) {
    const del = await clickStable((v) => v.role === "button" && v.name === `Delete ${label}`)
    if (del) {
      await pause()
      const confirm = await clickStable((v) => v.role === "button" && v.name === `Confirm delete ${label}`)
      if (confirm) {
        for (let j = 0; j < 20; j++) {
          if (!Object.values(snapshot().refs).some((v) => v.role === "button" && v.name === `Delete ${label}`)) return true
          await new Promise((r) => setTimeout(r, 500))
        }
        return false
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * Delete any definition this suite left behind on a previous run.
 *
 * Definitions live in the same Postgres database across runs, and a scenario
 * that goes RED never reaches its own delete step. The panel then refuses the
 * duplicate (http 400) while the row it looks for is already on screen, so the
 * next run silently reuses the OLD definition -- which is how an "emptied
 * required field is refused" assertion ran against a field defined as
 * optional, and could not pass no matter what the app did.
 */
async function dropDefinitions(api, cube, names) {
  for (const row of await definitionRows(api, cube)) {
    if (names.includes(row.name)) await api.call(`/customfields/${row.id}`, { method: "DELETE" })
  }
}

/** The definitions qwbe itself holds for `cube` -- the only proof a UI delete landed. */
async function definitionRows(api, cube) {
  const r = await api.call(`/customfields?cube=${encodeURIComponent(cube)}&limit=200`)
  return Array.isArray(r.body?.rows) ? r.body.rows : Array.isArray(r.body) ? r.body : []
}

export async function scenarioCustomFieldTypes(api, seed) {
  const name = "bool, number and date custom fields set inline; an emptied required text field is refused"
  await dropDefinitions(api, "crm/contacts", [V_NAME, B_NAME, D_NAME, N_NAME])

  // Definitions are made in Settings (F2), on the contacts entity.
  await open("/settings")
  if (!(await waitForText("Fields defined at runtime", 15_000))) {
    shot("09-panel-RED", { full: true })
    return record(name, "RED", "the definitions panel is not on the settings page", "09-panel-RED.png")
  }
  if (!(await chooseEntity("Contacts"))) {
    shot("09-entity-RED", { full: true })
    return record(name, "RED", "the Entity selector did not switch to Contacts", "09-entity-RED.png")
  }
  let snap = snapshot()

  const failures = []
  for (const [n, l, t, o, req] of [
    [V_NAME, V_LABEL, "number", null, false],
    [B_NAME, B_LABEL, "bool", null, false],
    [D_NAME, D_LABEL, "date", null, false],
    // The note is the required one: the scenario empties it and asserts on
    // qwbe's own refusal, which an optional field would never produce.
    [N_NAME, N_LABEL, "text", null, true],
  ]) {
    if (!(await defineField(n, l, t, o, Boolean(req)))) failures.push(`define ${n} failed`)
  }
  if (failures.length > 0) {
    shot("09-define-RED", { full: true })
    return record(name, "RED", failures.join("; "), "09-define-RED.png")
  }
  const definedShown = await waitForText(N_LABEL, 15_000)
  if (!definedShown) {
    shot("09-define-RED", { full: true })
    return record(name, "RED", "the definitions did not appear in the panel", "09-define-RED.png")
  }
  shot("09-definitions-appear")

  // The values are set inline on the contacts list, like any other cell.
  await open("/contacts")
  await settle(CONTACT_LINKED)
  if (!(await waitForText(N_LABEL, 15_000))) {
    shot("09-column-RED", { full: true })
    return record(name, "RED", "the note column did not appear on the contacts list", "09-column-RED.png")
  }

  // Set the number field inline through the text editor.
  let ok = true
  ok = (await openCellEditor(V_LABEL)) &&
    (await (async () => {
      for (let i = 0; i < 10; i++) {
        const s = snapshot()
        const box = Object.entries(s.refs).find(([, v]) => v.role === "textbox" && v.name === V_LABEL)?.[0]
        if (box) {
          keypress("ctrl+a")
          type("7")
          keypress("Return")
          return true
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return false
    })())
  if (!ok) return record(name, "RED", `the ${V_LABEL} editor did not open`, "09-number-RED.png")
  await waitForText("7", 10_000)

  // The bool field through the checkbox editor: a single trusted click on
  // the checkbox toggles and saves.
  ok = (await openCellEditor(B_LABEL)) &&
    (await (async () => {
      for (let i = 0; i < 10; i++) {
        const s = snapshot()
        const box = Object.entries(s.refs).find(([, v]) => v.role === "checkbox" && v.name === B_LABEL)?.[0]
        if (box) {
          try {
            click(box, snapshot().refs[box]?.name)
            return true
          } catch (e) {
            if (!String(e.message).includes("browser_stale_ref")) throw e
          }
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return false
    })())
  if (!ok) return record(name, "RED", `the ${B_LABEL} checkbox did not open`, "09-bool-RED.png")
  await pause()
  snap = snapshot()
  if (!snap.text.includes("yes")) return record(name, "RED", "the bool cell does not show yes after the toggle", "09-bool-RED.png")

  // The date field: the metadata currently publishes it as text (the
  // kernel maps date to type string without a format), so it
  // edits as text and the pack validates the YYYY-MM-DD shape.
  ok = (await openCellEditor(D_LABEL)) &&
    (await (async () => {
      for (let i = 0; i < 10; i++) {
        const s = snapshot()
        const box = Object.entries(s.refs).find(([, v]) => v.role === "textbox" && v.name === D_LABEL)?.[0]
        if (box) {
          keypress("ctrl+a")
          type("2026-01-02")
          keypress("Return")
          return true
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return false
    })())
  if (!ok) return record(name, "RED", `the ${D_LABEL} editor did not open`, "09-date-RED.png")
  const dateShown = await waitForText("2026-01-02", 10_000)

  // The required text field: set a value first, then empty it. The refusal
  // must be qwbe's own message, shown in that cell, with the old value kept.
  const noteOpen1 = await openCellEditor(N_LABEL)
  let noteTyped1 = false
  for (let i = 0; i < 10 && !noteTyped1; i++) {
    const s = snapshot()
    const box = Object.entries(s.refs).find(([, v]) => v.role === "textbox" && v.name === N_LABEL)?.[0]
    if (box) {
      keypress("ctrl+a")
      type("hello")
      keypress("Return")
      noteTyped1 = true
    } else {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const helloShown = await waitForText("hello", 10_000)
  const noteOpen2 = noteTyped1 ? await openCellEditor(N_LABEL) : false
  let noteTyped2 = false
  for (let i = 0; i < 10 && !noteTyped2; i++) {
    const s = snapshot()
    const box = Object.entries(s.refs).find(([, v]) => v.role === "textbox" && v.name === N_LABEL)?.[0]
    if (box) {
      keypress("ctrl+a")
      type("")
      keypress("Return")
      noteTyped2 = true
    } else {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const refused = await waitForText("cannot be emptied", 15_000)
  snap = snapshot()
  shot("09-required-refused")
  const noteDetail = `note open=${noteOpen1}/${noteOpen2} typed=${noteTyped1}/${noteTyped2} hello=${helloShown} refused=${refused}`
  if (!noteTyped1 || !helloShown || !noteTyped2 || !refused) {
    return record(name, "RED", noteDetail, "09-required-refused.png")
  }

  // The values the backend actually holds (the row's own API, admin session).
  const row = (await api.call(`/contacts/${seed.contactLinked.id}`)).body
  const custom = row?.custom ?? {}
  const valueOk =
    custom[V_NAME] === 7 &&
    custom[B_NAME] === true &&
    custom[D_NAME] === "2026-01-02" &&
    custom[N_NAME] === "hello"

  // Clean up every definition in Settings (two-step confirm); navigation
  // reset the Entity selector, so address the contacts cube again.
  await open("/settings")
  if (!(await waitForText("Fields defined at runtime", 15_000))) {
    return record(name, "RED", "the definitions panel is not on the settings page for cleanup", "09-cleanup-RED.png")
  }
  if (!(await chooseEntity("Contacts"))) {
    return record(name, "RED", "the Entity selector did not switch back to Contacts for cleanup", "09-cleanup-RED.png")
  }
  const cleaned =
    (await deleteField(V_LABEL)) &&
    (await deleteField(B_LABEL)) &&
    (await deleteField(D_LABEL)) &&
    (await deleteField(N_LABEL))

  // The deletes are writes as well: rows disappearing from the panel is not
  // proof. None of the four may still be defined in qwbe.
  const leftOver = (await definitionRows(api, "crm/contacts"))
    .map((r) => r.name)
    .filter((n) => [V_NAME, B_NAME, D_NAME, N_NAME].includes(n))

  const pass = ok && helloShown && refused && valueOk && cleaned && dateShown && leftOver.length === 0
  return record(
    name,
    pass ? "PASS" : "RED",
    pass
      ? "number 7, bool yes, date 2026-01-02 in the cells and the backend; the emptied required field refused with qwbe's message; every definition gone from qwbe"
      : `${noteDetail} values=${JSON.stringify(custom).slice(0, 120)} cleaned=${cleaned} date=${dateShown} leftOver=${leftOver.join(",") || "none"}`,
    "09-required-refused.png",
  )
}

// --- 11. detail page pencil: Escape discards the draft, Save writes the field ---
// The shared detail renderer (cube-show.tsx) had no UI test at all. This one
// drives the real pencil affordance on the organization detail: open the
// Billing City editor, type, Escape (the value must NOT reach qwbe), open it
// again, type, Save (the value MUST reach qwbe, read back through the API).
export async function scenarioDetailEdit(api, seed) {
  const name = "detail page pencil: Escape discards the draft and Save patches the field"
  const before = (await api.call(`/organizations/${seed.orgA.id}`)).body ?? {}
  await open(`/organizations/${seed.orgA.id}`)
  await settle(ORG_A)
  const pencil = (v) => v.role === "button" && /^Edit .*City/i.test(v.name ?? "")
  const editor = (refs) =>
    Object.entries(refs).find(([, v]) => v.role === "textbox" && /city/i.test(v.name ?? ""))?.[0]
  if (!(await clickStable(pencil))) {
    shot("11-detail-RED", { full: true })
    return record(name, "RED", "no Edit Billing City pencil on the detail page", "11-detail-RED.png")
  }
  await pause(1500)
  if (!editor(snapshot().refs)) {
    shot("11-detail-RED", { full: true })
    return record(name, "RED", "the pencil did not open a Billing City editor", "11-detail-RED.png")
  }
  const discarded = `E2E City Discarded ${Date.now()}`
  keypress("ctrl+a")
  type(discarded)
  keypress("Escape")
  await pause(1000)
  const afterEscape = (await api.call(`/organizations/${seed.orgA.id}`)).body ?? {}
  const escapeOk = !editor(snapshot().refs) && afterEscape.billingCity === before.billingCity
  shot("11-after-escape")
  if (!escapeOk) {
    return record(name, "RED", `Escape kept the editor open or wrote ${discarded} (backend now ${afterEscape.billingCity})`, "11-after-escape.png")
  }
  if (!(await clickStable(pencil))) {
    shot("11-detail-RED", { full: true })
    return record(name, "RED", "the pencil did not come back after Cancel", "11-detail-RED.png")
  }
  await pause(1500)
  if (!editor(snapshot().refs)) {
    shot("11-detail-RED", { full: true })
    return record(name, "RED", "the second pencil click did not open the editor", "11-detail-RED.png")
  }
  const saved = `E2E City Detail ${Date.now()}`
  keypress("ctrl+a")
  type(saved)
  if (!(await clickStable((v) => v.role === "button" && v.name === "Save"))) {
    shot("11-detail-RED", { full: true })
    return record(name, "RED", "no Save button under the open editor", "11-detail-RED.png")
  }
  const shown = await waitForText(saved, 15_000)
  await pause(1000)
  const after = (await api.call(`/organizations/${seed.orgA.id}`)).body ?? {}
  shot("11-after-save")
  const pass = shown && !editor(snapshot().refs) && after.billingCity === saved
  return record(
    name,
    pass ? "PASS" : "RED",
    pass
      ? `Escape left billingCity at ${JSON.stringify(before.billingCity)}; Save read back ${saved} through the API`
      : `page=${shown} editorClosed=${!editor(snapshot().refs)} backend=${JSON.stringify(after.billingCity)}`,
    "11-after-save.png",
  )
}

// --- 12. sharing panel -------------------------------------------------------
// As admin (owner of the seeded rows) on organization A: share with @reader
// at the default TOTAL through the picker, the explicit Confirm share step,
// chip present; the grant read back through the permissions API carries the
// six actions; then revoke through the two-step chip button and read back
// total 0. Runs while the admin session is live (before logout).
export async function scenarioSharing(api, seed) {
  const name = "sharing panel: share with @reader (TOTAL, confirmed), stale revoke toasts its 404, revoke; read back through the API"
  const ref = `/permissions/entities/${encodeURIComponent("crm/organizations")}/Organization/${seed.orgA.id}`
  const grants = async () => (await api.call(`${ref}/grants?offset=0&limit=50`)).body ?? {}
  await open(`/organizations/${seed.orgA.id}`)
  await settle(ORG_A)
  if (!(await waitForText("Shared with", 15_000))) {
    shot("12-sharing-RED", { full: true })
    return record(name, "RED", "the sharing panel never rendered its grant list", "12-sharing-RED.png")
  }
  if (!(await clickStable((v) => v.role === "combobox" && v.name === "Username", "Username"))) {
    shot("12-sharing-RED", { full: true })
    return record(name, "RED", "no Username picker in the sharing panel", "12-sharing-RED.png")
  }
  type("reader")
  if (!(await clickStable((v) => v.role === "button" && v.name === "Share", "Share"))) {
    shot("12-sharing-RED", { full: true })
    return record(name, "RED", "no Share button", "12-sharing-RED.png")
  }
  const transferWarned = await waitForText("Includes transfer", 10_000)
  shot("12-confirm-share")
  if (!(await clickStable((v) => v.role === "button" && v.name === "Confirm share", "Confirm share"))) {
    shot("12-sharing-RED", { full: true })
    return record(name, "RED", "no Confirm share step after Share", "12-sharing-RED.png")
  }
  const chip = await findStable((v) => v.role === "button" && v.name === "Revoke access for @reader")
  await pause(1000)
  const shared = await grants()
  const row = (shared.rows ?? []).find((r) => r.subject?.kind === "user")
  const sharedOk = chip !== null && shared.total === 1 && Array.isArray(row?.actions) && row.actions.length === 6
  shot("12-shared")
  if (!sharedOk) {
    return record(name, "RED", `after Confirm share: chip=${chip !== null} transferWarned=${transferWarned} api total=${shared.total} actions=${JSON.stringify(row?.actions)}`, "12-shared.png")
  }
  // Failed revoke stays visible: the grant is revoked behind the panel's back
  // (another tab, here the API) between Revoke and Confirm revoke, so the
  // backend answers 404. The panel must toast that message, not swallow it,
  // and the refetch must then show the emptied list.
  if (!(await clickStable((v) => v.role === "button" && v.name === "Revoke access for @reader"))) {
    return record(name, "RED", "the @reader chip lost its Revoke button", "12-shared.png")
  }
  await pause(500)
  const disclaimer = snapshot().text.includes("may still give access")
  const gone = await api.call(`/permissions/grants/${encodeURIComponent(row.id)}`, { method: "DELETE" })
  if (gone.status < 200 || gone.status >= 300) {
    return record(name, "RED", `API revoke behind the panel answered ${gone.status}`, "12-shared.png")
  }
  if (!(await clickStable((v) => v.role === "button" && v.name === "Confirm revoke @reader"))) {
    shot("12-sharing-RED", { full: true })
    return record(name, "RED", "no Confirm revoke step after Revoke", "12-sharing-RED.png")
  }
  const staleToast = await waitForText("does not exist", 10_000)
  const noneAfterStale = await waitForText("Shared with: none", 15_000)
  shot("12-revoke-stale")
  if (!staleToast || !noneAfterStale) {
    return record(name, "RED", `stale revoke: toast=${staleToast} none=${noneAfterStale}`, "12-revoke-stale.png")
  }
  // Share again and revoke through the panel alone: the success toast.
  if (!(await clickStable((v) => v.role === "combobox" && v.name === "Username", "Username"))) {
    return record(name, "RED", "no Username picker after the stale revoke", "12-revoke-stale.png")
  }
  type("reader")
  if (!(await clickStable((v) => v.role === "button" && v.name === "Share", "Share"))) {
    return record(name, "RED", "no Share button after the stale revoke", "12-revoke-stale.png")
  }
  if (!(await clickStable((v) => v.role === "button" && v.name === "Confirm share", "Confirm share"))) {
    return record(name, "RED", "no Confirm share step on the second share", "12-revoke-stale.png")
  }
  if (!(await clickStable((v) => v.role === "button" && v.name === "Revoke access for @reader"))) {
    return record(name, "RED", "no @reader chip after the second share", "12-revoke-stale.png")
  }
  if (!(await clickStable((v) => v.role === "button" && v.name === "Confirm revoke @reader"))) {
    shot("12-sharing-RED", { full: true })
    return record(name, "RED", "no Confirm revoke step on the second revoke", "12-sharing-RED.png")
  }
  const revokedToast = await waitForText("Revoked access for @reader", 10_000)
  const none = await waitForText("Shared with: none", 15_000)
  await pause(1000)
  const after = await grants()
  shot("12-revoked")
  const pass = transferWarned && disclaimer && revokedToast && none && after.total === 0
  return record(
    name,
    pass ? "PASS" : "RED",
    pass
      ? "TOTAL confirmation named transfer; grant read back with 6 actions; stale revoke toasted its 404; revoke disclaimer and success toast shown; API total 0 after revoke"
      : `transferWarned=${transferWarned} disclaimer=${disclaimer} revokedToast=${revokedToast} none=${none} api total after=${after.total}`,
    "12-revoked.png",
  )
}

// --- 13. groups in Settings: create, rename, add @reader, remove, read back ---
// Needs the kernel members slice (GET /permissions/groups/:id/members); on an
// older kernel the panel shows its "could not load" message and this records
// RED with that detail, never a false "no members". Groups have no delete
// endpoint, so the group created here stays behind (name carries "e2e").
export async function scenarioGroups(api) {
  const name = "groups panel: create, rename, add @reader (read back), remove, members none"
  const groupName = `e2e group ${Date.now()}`
  await open("/settings")
  if (!(await waitForText("Permission groups", 15_000))) {
    shot("13-groups-RED", { full: true })
    return record(name, "RED", "the groups panel is not on the settings page", "13-groups-RED.png")
  }
  const nameBox = await clickStable((v) => v.role === "textbox" && v.name === "New group name", "New group name")
  if (!nameBox) return record(name, "RED", "no New group name input", "13-groups-RED.png")
  type(groupName)
  if (!(await clickStable((v) => v.role === "button" && v.name === "Create group", "Create group"))) {
    return record(name, "RED", "no Create group button", "13-groups-RED.png")
  }
  const created = await waitForText(`Created group ${groupName}`, 10_000)
  await pause(1000)
  const listed = (await api.call(`/permissions/groups?cube=${encodeURIComponent("crm/organizations")}`)).body ?? []
  const group = Array.isArray(listed) ? listed.find((g) => g.name === groupName) : null
  shot("13-created")
  if (!created || !group) {
    return record(name, "RED", `create: toast=${created} api has group=${Boolean(group)}`, "13-created.png")
  }
  // The new group is selected on creation: its section carries the members
  // list. Empty group = "Members: none" (rows [] AND total 0), never a guess.
  const none = await waitForText("Members: none", 15_000)
  if (!none) {
    shot("13-members-RED", { full: true })
    return record(name, "RED", "new group did not show 'Members: none' (members endpoint refused or missing?)", "13-members-RED.png")
  }
  // rename
  const renameBox = await clickStable((v) => v.role === "textbox" && v.name === "Group name", "Group name")
  if (!renameBox) return record(name, "RED", "no Group name input in the group section", "13-created.png")
  type(`${groupName} renamed`)
  if (!(await clickStable((v) => v.role === "button" && v.name === "Rename", "Rename"))) {
    return record(name, "RED", "no Rename button", "13-created.png")
  }
  const renamed = await waitForText("Renamed group to", 10_000)
  // add @reader
  if (!(await clickStable((v) => v.role === "combobox" && v.name === "Username", "Username"))) {
    return record(name, "RED", "no Username picker in the group section", "13-created.png")
  }
  type("reader")
  if (!(await clickStable((v) => v.role === "button" && v.name === "Add member", "Add member"))) {
    return record(name, "RED", "no Add member button", "13-created.png")
  }
  const addedToast = await waitForText("Added @reader", 10_000)
  const chip = await findStable((v) => v.role === "button" && v.name === "Remove @reader")
  await pause(1000)
  const members = (await api.call(`/permissions/groups/${encodeURIComponent(group.id)}/members?offset=0&limit=50`)).body ?? {}
  shot("13-added")
  if (!addedToast || !chip || members.total !== 1) {
    return record(name, "RED", `add: toast=${addedToast} chip=${chip !== null} api total=${members.total}`, "13-added.png")
  }
  // remove with the two-step confirmation
  if (!(await clickStable((v) => v.role === "button" && v.name === "Remove @reader"))) {
    return record(name, "RED", "the @reader row lost its Remove button", "13-added.png")
  }
  if (!(await clickStable((v) => v.role === "button" && v.name === "Confirm remove @reader"))) {
    shot("13-groups-RED", { full: true })
    return record(name, "RED", "no Confirm remove step after Remove", "13-groups-RED.png")
  }
  const removedToast = await waitForText("Removed @reader", 10_000)
  const noneAfter = await waitForText("Members: none", 15_000)
  await pause(1000)
  const after = (await api.call(`/permissions/groups/${encodeURIComponent(group.id)}/members?offset=0&limit=50`)).body ?? {}
  shot("13-removed")
  const pass = renamed && removedToast && noneAfter && after.total === 0
  return record(
    name,
    pass ? "PASS" : "RED",
    pass
      ? "group created and read back; renamed; @reader added (API total 1) and removed (API total 0); empty list says none"
      : `renamed=${renamed} removedToast=${removedToast} noneAfter=${noneAfter} api total after=${after.total}`,
    "13-removed.png",
  )
}

/** Only the login scenario — used when the seed cannot get a session at all. */
export async function scenarioLoginOnly() {
  await scenarioLogin()
}

export async function runAll(api, seed) {
  const verdicts = []
  verdicts.push(await scenarioLogin())
  if (!verdicts[0]) {
    // Without a session every later scenario would only test the login page.
    record("later scenarios (list, inline edit, non-editable, navigation, logout)", "SKIP", "login failed; without a session the UI cannot be exercised")
    return verdicts
  }
  verdicts.push(await scenarioList())
  verdicts.push(await scenarioListActions(seed))
  verdicts.push(await scenarioListUrl())
  verdicts.push(await scenarioInlineEdit(api))
  verdicts.push(await scenarioNonEditable(api))
  verdicts.push(await scenarioNavigation(seed))
  verdicts.push(await scenarioDetailEdit(api, seed))
  verdicts.push(await scenarioSharing(api, seed))
  verdicts.push(await scenarioGroups(api))
  verdicts.push(await scenarioCreateOrganization(api))
  verdicts.push(await scenarioCustomField(api))
  verdicts.push(await scenarioCustomFieldTypes(api, seed))
  verdicts.push(await scenarioLogout())
  verdicts.push(await scenarioReader(CONFIG.qwbePort))
  verdicts.push(await scenarioReaderEcho())
  return verdicts
}
