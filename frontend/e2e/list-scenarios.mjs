// @ts-check
// The Organizations list of T-1813, driven through the Orca browser: the column
// picker, the selection with its disabled mass actions, the row menu, the
// query kept in the URL, previous / next on the detail, and the /echo guard
// for a reader. DOM facts the accessibility snapshot does not carry
// (aria-disabled, aria-checked="mixed", the URL) are read with one eval each.

import { orca, pageArgs, record, shot, snapshot, type, waitForText, waitForUrl } from "./lib.mjs"
import { ORG_A, ORG_B } from "./seed.mjs"
import { clickStable, open, pause, settle } from "./scenarios.mjs"

const MASS_ACTIONS = ["Delete", "Mass Edit", "Send Mail", "Mailer Export", "Send SMS"]

/** One expression evaluated in the suite's tab; its result as a string. */
const evalText = (expression) => String(orca("eval", "--expression", expression, ...pageArgs())?.result ?? "")
const headers = () => evalText(`[...document.querySelectorAll("thead th")].map((th) => th.innerText.trim()).join("|")`)
const press = (key) => evalText(`document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "${key}", bubbles: true })) ?? false`)

// --- 14. column picker, selection, mass actions, row menu ---------------------
export async function scenarioListActions(seed) {
  const name = "organization list: column picker, selection with disabled mass actions, row menu"
  await open("/organizations?sort=name")
  await settle(ORG_A)
  const fails = []

  // Columns: Industry added on the right, then Reset returns to the default.
  await clickStable((v) => v.role === "button" && v.name === "Columns", "Columns")
  await clickStable((v) => v.role === "menuitemcheckbox" && v.name === "Industry", "Industry")
  press("Escape")
  await pause()
  if (!headers().includes("Industry")) fails.push("Industry column not added")
  await clickStable((v) => v.role === "button" && v.name === "Columns", "Columns")
  await clickStable((v) => v.role === "menuitem" && v.name === "Reset columns", "Reset columns")
  await pause()
  if (headers().includes("Industry")) fails.push("Reset columns kept Industry")

  // Selection: a named checkbox per row, the header goes mixed, every mass action
  // is announced disabled with its reason, a demo row cannot be ticked.
  await clickStable((v) => v.role === "checkbox" && v.name === `Select ${ORG_A}`, `Select ${ORG_A}`)
  await pause()
  const selected = await waitForText("1 selected", 5_000)
  const mixed = evalText(`document.querySelector('[aria-label="Select all rows on this page"]')?.getAttribute("aria-checked")`)
  const disabled = evalText(
    `JSON.stringify(${JSON.stringify(MASS_ACTIONS)}.map((t) => [...document.querySelectorAll('[role=region][aria-label=Selection] button')].find((b) => b.innerText.trim() === t)?.getAttribute("aria-disabled")))`,
  )
  const demoBox = evalText(`(() => { const b = document.querySelector('[data-demo-row] button[role=checkbox]'); return b ? b.getAttribute("aria-disabled") + ":" + b.getAttribute("aria-description") : "none" })()`)
  shot("14-selection")
  if (!selected) fails.push("no '1 selected' bar")
  if (mixed !== "mixed") fails.push(`header checkbox ${mixed}, not mixed`)
  if (disabled !== JSON.stringify(MASS_ACTIONS.map(() => "true"))) fails.push(`mass actions not all disabled: ${disabled}`)
  if (demoBox !== "true:Demo row, read-only") fails.push(`demo checkbox: ${demoBox}`)

  // Row menu: Delete unavailable, Edit opens the detail in edit mode and leaves the URL clean.
  await clickStable((v) => v.role === "button" && v.name === `Actions for ${ORG_A}`, `Actions for ${ORG_A}`)
  await pause()
  const deleteState = evalText(`[...document.querySelectorAll("[role=menuitem]")].find((m) => m.innerText.includes("Delete"))?.getAttribute("aria-disabled")`)
  if (deleteState !== "true") fails.push(`row Delete aria-disabled=${deleteState}`)
  await clickStable((v) => v.role === "menuitem" && (v.name ?? "").startsWith("Edit"), "Edit")
  const onDetail = await waitForUrl(`/organizations/${seed.orgA.id}$`, 20_000)
  const editing = await waitForText("Save", 10_000)
  shot("14-row-edit")
  if (!onDetail || !editing) fails.push(`row Edit: detail=${onDetail} editing=${editing}`)

  return record(name, fails.length === 0 ? "PASS" : "RED", fails.join("; ") || "picker, selection, 5 disabled mass actions, demo row read-only, row menu", "14-selection.png")
}

// --- 15. the query in the URL, Back, and previous / next on the detail ---------
export async function scenarioListUrl() {
  const name = "organization list keeps its query in the URL; the detail walks the list page"
  await open("/organizations")
  await settle(ORG_A)
  const fails = []

  await clickStable((v) => (v.role === "searchbox" || v.role === "textbox") && v.name === "Search (prefix match)", "Search (prefix match)")
  type("E2E")
  const inUrl = await waitForUrl("[?&]q=E2E", 10_000)
  await clickStable((v) => v.role === "button" && (v.name ?? "").startsWith("Organization Name"))
  const sorted = await waitForUrl("sort=name", 10_000)
  if (!inUrl || !sorted) fails.push(`URL q=${inUrl} sort=${sorted}`)

  // A reload (a fresh tab on the same URL) shows the same query.
  const url = snapshot().origin
  await open(new URL(url).pathname + new URL(url).search)
  await settle(ORG_A)
  const box = evalText(`document.querySelector('[aria-label="Search (prefix match)"]')?.value`)
  if (box !== "E2E") fails.push(`search box after reload: ${box}`)

  // Previous / next follow the page in view: Alpha, then Beta (sorted by name).
  await clickStable((v) => v.role === "link" && v.name === ORG_A, ORG_A)
  await waitForUrl("/organizations/(?!new)[^?]+$", 20_000)
  await settle(ORG_A)
  await clickStable((v) => v.role === "link" && v.name === "Next organization", "Next organization")
  const onBeta = await waitForText(ORG_B, 15_000)
  shot("15-next")
  if (!onBeta) fails.push("Next organization did not open Beta")

  // Back lands on the list with its query.
  evalText("history.go(-2)")
  const back = await waitForUrl("/organizations\\?.*q=E2E", 15_000)
  if (!back) fails.push(`Back landed on ${snapshot().origin}`)

  return record(name, fails.length === 0 ? "PASS" : "RED", fails.join("; ") || "q and sort in the URL, kept on reload and Back; next walks the page", "15-next.png")
}

// --- 16. a reader sees no Administration and /echo refuses ---------------------
// Runs in the reader's session (after scenarioReader).
export async function scenarioReaderEcho() {
  const name = "a reader gets no Administration menu and /echo shows its guard"
  await open("/echo")
  const guarded = await waitForText("Echo is a developer page for administrators.", 15_000)
  const nav = evalText(`[...document.querySelectorAll("nav a")].map((a) => a.innerText.trim()).filter((t) => t === "Settings" || t === "Echo").join(",")`)
  shot("16-reader-echo")
  const pass = guarded && nav === ""
  return record(name, pass ? "PASS" : "RED", pass ? "guard text shown, no Settings or Echo link" : `guard=${guarded} links=${nav}`, "16-reader-echo.png")
}
