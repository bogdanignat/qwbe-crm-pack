// The UI regressions of Settings > Access groups, in a real browser, against a
// mocked world. Run with: npm run test:ui
//
// Each test names a behaviour that only the rendered panel can prove, and that
// a pure test of lib/ or hooks/ cannot:
//
//   1. the panel does not exist before a scope is chosen, and a scope switch
//      leaves NOTHING of the previous scope behind (the `key=` remount);
//   2. a group that vanished between two reads is dropped, and an open remove
//      confirmation of it goes with it (stale list + dialog);
//   3. an account already in the group is offered DISABLED, with this panel's
//      own reason;
//   4. a refused membership write keeps the words the server actually sent --
//      `username ghost does not exist` is not "This group no longer exists.";
//   5. an answer that arrives after its panel was replaced says nothing, and
//      still releases the busy flag;
//   6. the 403 fallback scope list is not a dead end: a Retry reaches the
//      installed list, and the fallback is offered in the same order a live
//      answer would be;
//   7. a rename that lands after its section was replaced is still reflected in
//      the group LIST, even though it is not announced -- the unmount silences
//      the sentence, not the refresh;
//   8. the same for a refusal: a 404 about the group arriving after the switch
//      still takes the group off the list, and still says nothing.
//
// The fixture starts nothing of the live CRM: see e2e/ui/fixture.mjs.

import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"

import { openFixture, removeFixtureBuild, startFixtureServer } from "./fixture.mjs"
import { answerFor, makeWorld } from "./mock-world.mjs"

const SCOPE = "Access scope"
const PANEL_TEXT = "Permission groups of this entity."

/** @type {{ baseUrl: string, port: number, stop: () => void } | null} */
let server = null

describe("Settings > Access groups in a browser", () => {
  before(async () => {
    server = await startFixtureServer()
  })

  after(() => {
    server?.stop()
    removeFixtureBuild()
  })

  /**
   * One page on /settings, with this world behind every API call.
   * @param {Record<string, unknown>} [plan]
   */
  async function onSettings(plan) {
    if (server === null) throw new Error("the fixture server was not started")
    const world = makeWorld(plan)
    const fixture = await openFixture(server, answerFor(world))
    await fixture.page.goto("/settings", { waitUntil: "domcontentloaded" })
    await fixture.page.getByText("Access groups", { exact: true }).waitFor()
    return { world, ...fixture }
  }

  /** Choose one access scope by its label. */
  async function chooseScope(page, label) {
    await page.getByRole("combobox", { name: SCOPE }).click()
    await page.getByRole("option", { name: label, exact: true }).click()
  }

  /** Choose one group by name in the mounted groups panel. */
  async function chooseGroup(page, name) {
    await page.getByRole("combobox", { name: "Group", exact: true }).click()
    await page.getByRole("option", { name, exact: true }).click()
  }

  /**
   * A promise for ONE intercepted answer, by method and mocked path. Registered
   * BEFORE the click that asks for it, so a fast answer cannot be missed.
   *
   * This is what the two late-answer tests below wait on instead of sleeping: a
   * `waitForTimeout` longer than the scripted `delayMs` is a guess about how
   * loaded the machine is, and a guess that comes up short asserts silence on a
   * screen that has not been answered yet -- a pass for the wrong reason.
   *
   * @param {import("playwright").Page} page
   * @param {string} method
   * @param {string} path the path as the mock sees it, e.g. `/permissions/groups`
   */
  function answered(page, method, path) {
    return page.waitForResponse(
      (response) => response.request().method() === method && new URL(response.url()).pathname === `/api/qwbe${path}`,
    )
  }

  it("mounts no groups panel before a scope is chosen, and keeps nothing of the previous scope after a switch", async () => {
    const { page, close } = await onSettings()
    try {
      // Nothing is selected for the operator, so nothing is being administered.
      assert.equal(await page.getByText(PANEL_TEXT).count(), 0, "the groups panel was mounted with no scope chosen")

      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      // The section of that group: its name in the rename box, its one member.
      await page.getByRole("button", { name: "Remove @reader" }).waitFor()
      assert.equal(await page.getByRole("textbox", { name: "Group name", exact: true }).inputValue(), "Org admins")

      await chooseScope(page, "Contacts")
      // The panel remounted: a fresh list for the new scope and no selection.
      await page.getByRole("combobox", { name: "Group", exact: true }).waitFor()
      await page.waitForFunction(() => !document.body.innerText.includes("Org admins"))
      assert.equal(await page.getByRole("button", { name: "Remove @reader" }).count(), 0, "a member row survived")
      assert.equal(await page.getByRole("textbox", { name: "Group name", exact: true }).count(), 0, "the rename form survived")
      assert.match(
        await page.getByRole("combobox", { name: "Group", exact: true }).innerText(),
        /choose a group/i,
        "the new scope opened with a group already selected",
      )
      // The new scope's own group is what is offered now.
      await page.getByRole("combobox", { name: "Group", exact: true }).click()
      await page.getByRole("option", { name: "Contact editors", exact: true }).waitFor()
      assert.equal(await page.getByRole("option", { name: "Org admins", exact: true }).count(), 0)
    } finally {
      await close()
    }
  })

  it("drops a group the re-read list no longer carries, and the remove confirmation open over it", async () => {
    const { page, world, close } = await onSettings()
    try {
      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      // Open the two-step remove confirmation and leave it open.
      await page.getByRole("button", { name: "Remove @reader" }).click()
      await page.getByRole("button", { name: "Confirm remove @reader" }).waitFor()

      // Someone else deletes that group. The next list read is the only thing
      // that can say so, and creating a group is what asks for one.
      world.groups = world.groups.filter((g) => g.id !== "g-org-1")
      await page.getByLabel("New group name").fill("Org auditors")
      await page.getByRole("button", { name: "Create group" }).click()
      await page.getByText("Created group Org auditors").waitFor()

      // The vanished group is gone from the list, from the selection, and its
      // open confirmation is gone with the section that owned it.
      await page.waitForFunction(() => !document.body.innerText.includes("Org admins"))
      assert.equal(
        await page.getByRole("button", { name: "Confirm remove @reader" }).count(),
        0,
        "a confirmation of a group that no longer exists stayed open",
      )
      assert.equal(await page.getByRole("textbox", { name: "Group name", exact: true }).inputValue(), "Org auditors")
    } finally {
      await close()
    }
  })

  it("offers an account already in the group as a disabled suggestion with this panel's own reason", async () => {
    const { page, close } = await onSettings()
    try {
      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      await page.getByRole("button", { name: "Remove @reader" }).waitFor()

      await page.getByRole("combobox", { name: "Username" }).fill("re")
      const suggestion = page.getByRole("option").filter({ hasText: "reader" }).first()
      await suggestion.waitFor()
      await suggestion.getByText("Already in group").waitFor()
      assert.equal(
        await suggestion.getAttribute("aria-disabled"),
        "true",
        "an account already in the group was offered as pickable",
      )
    } finally {
      await close()
    }
  })

  it("reports a refused membership write in the words the server sent, never as a missing group", async () => {
    const { page, close } = await onSettings()
    try {
      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      await page.getByRole("button", { name: "Remove @reader" }).waitFor()

      // `ghost` is not an account: the kernel answers 404 about the USERNAME.
      await page.getByRole("combobox", { name: "Username" }).fill("ghost")
      await page.getByRole("button", { name: "Add member" }).click()
      await page.getByText("username ghost does not exist").waitFor()
      const body = await page.innerText("body")
      assert.ok(
        !body.includes("This group no longer exists."),
        "a 404 about the username was reported as a missing group",
      )
      assert.ok(
        !body.includes("A group name is required."),
        "a membership refusal was reported as a group-name problem",
      )
      // The group is still there and still administrable.
      assert.equal(await page.getByRole("textbox", { name: "Group name", exact: true }).inputValue(), "Org admins")
      assert.equal(await page.getByRole("button", { name: "Add member" }).isEnabled(), true, "the panel stayed busy")
    } finally {
      await close()
    }
  })

  it("says nothing when the answer arrives after its panel was replaced, and still releases the busy flag", async () => {
    const { page, close } = await onSettings({
      // The add succeeds normally -- 2.5s late.
      scripts: [{ match: "POST /permissions/groups/g-org-1/members", delayMs: 2500 }],
    })
    try {
      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      await page.getByRole("button", { name: "Remove @reader" }).waitFor()

      await page.getByRole("combobox", { name: "Username" }).fill("writer")
      await page.getByRole("button", { name: "Add member" }).click()
      // Leave before the answer comes back.
      await chooseScope(page, "Contacts")
      await page.waitForTimeout(4000)

      const body = await page.innerText("body")
      assert.ok(!body.includes("Added @writer"), "a success toast named a group the operator had already left")
      assert.ok(!body.includes("Org admins"), "the replaced scope was named after the switch")
      // The flag the write set is released even though the section that set it
      // is gone, so the panel that replaced it is usable.
      await page.getByLabel("New group name").fill("Contact auditors")
      assert.equal(
        await page.getByRole("button", { name: "Create group" }).isEnabled(),
        true,
        "the panel stayed disabled after a write whose section was unmounted",
      )
    } finally {
      await close()
    }
  })

  it("lets the operator leave the 403 fallback list, and offers it in the same order a live answer would", async () => {
    const { page, world, close } = await onSettings({ catalogueStatus: 403 })
    try {
      await page.getByText("this is the pack's built-in list of scopes", { exact: false }).waitFor()

      // Same order as a live answer: by cube name, not by the order the labels
      // happen to be written in.
      await page.getByRole("combobox", { name: SCOPE }).click()
      const offered = await page.getByRole("option").allInnerTexts()
      assert.deepEqual(offered, [
        "Contact groups (access to the group records)",
        "Contacts",
        "Contracts",
        "Organizations",
      ])
      await page.keyboard.press("Escape")

      // The 403 is fixed while the page stays open; the Retry must reach the
      // installed list instead of being held fresh behind a staleTime.
      world.catalogueStatus = 200
      await page.getByRole("button", { name: "Read the installed access scopes again" }).click()
      await page.waitForFunction(() => !document.body.innerText.includes("built-in list of scopes"))
      await page.getByRole("combobox", { name: SCOPE }).click()
      // `crm` itself is in the installed catalogue and in no fallback list.
      await page.getByRole("option", { name: "crm", exact: true }).waitFor()
    } finally {
      await close()
    }
  })

  it("keeps the group list right after a rename that lands once its section was replaced, without announcing it", async () => {
    const { page, close } = await onSettings({
      // The rename succeeds normally -- 2.5s late, long after the switch below.
      scripts: [{ match: "PATCH /permissions/groups/g-org-1", delayMs: 2500 }],
    })
    try {
      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      await page.getByRole("button", { name: "Remove @reader" }).waitFor()

      // Both waiters before the click: the rename's own answer, and the list
      // re-read that answer asks for (`onChanged` -> `usePermissionGroups.load`).
      // Nothing else on this page reads `/permissions/groups` between here and
      // there -- a group switch is local state and only reads that group's
      // members -- so the list answer awaited below is the rename's.
      const renameAnswered = answered(page, "PATCH", "/permissions/groups/g-org-1")
      const listReread = answered(page, "GET", "/permissions/groups")
      await page.getByRole("textbox", { name: "Group name", exact: true }).fill("Org owners")
      await page.getByRole("button", { name: "Rename", exact: true }).click()
      // Switch group before the answer comes back: the section that asked is
      // unmounted (the panel keys it by group id), the panel is not.
      await chooseGroup(page, "Org readers")
      await renameAnswered
      await listReread

      // The list re-read the rename asked for happened anyway, so the select
      // offers the new name and no longer the old one. This is the whole point:
      // the unmount silences the sentence, not the refresh. Asserted FIRST,
      // because reaching the refreshed list also proves the panel rendered after
      // the rename resolved -- which is what makes the silence below evidence.
      await page.getByRole("combobox", { name: "Group", exact: true }).click()
      await page.getByRole("option", { name: "Org owners", exact: true }).waitFor()
      await page.getByRole("option", { name: "Org admins", exact: true }).waitFor({ state: "detached" })
      assert.equal(
        await page.getByRole("option", { name: "Org admins", exact: true }).count(),
        0,
        "the group list kept the old name after a rename whose section was unmounted",
      )
      await page.keyboard.press("Escape")

      const body = await page.innerText("body")
      assert.ok(
        !body.includes("Renamed group to"),
        "a rename of a group the operator had already left was announced over the section that replaced it",
      )
      // The selection the operator made is the one still selected.
      assert.match(
        await page.getByRole("combobox", { name: "Group", exact: true }).innerText(),
        /Org readers/,
        "the switch the operator made was undone by the late rename",
      )
    } finally {
      await close()
    }
  })

  it("drops a group a late 404 says is gone, even when the section that asked is already replaced", async () => {
    const { page, world, close } = await onSettings({
      scripts: [
        {
          match: "POST /permissions/groups/g-org-1/members",
          status: 404,
          body: { message: "group g-org-1 does not exist" },
          delayMs: 2500,
        },
      ],
    })
    try {
      await chooseScope(page, "Organizations")
      await page.getByText(PANEL_TEXT).waitFor()
      await chooseGroup(page, "Org admins")
      await page.getByRole("button", { name: "Remove @reader" }).waitFor()

      // The refusal, and the list re-read `settle(404)` asks for: awaited instead
      // of slept on, so nothing below can be asserted while either is in flight.
      const refused = answered(page, "POST", "/permissions/groups/g-org-1/members")
      const listReread = answered(page, "GET", "/permissions/groups")
      await page.getByRole("combobox", { name: "Username" }).fill("writer")
      await page.getByRole("button", { name: "Add member" }).click()
      // Someone else really did delete it, which is what the scripted 404 means.
      world.groups = world.groups.filter((g) => g.id !== "g-org-1")
      await chooseGroup(page, "Org readers")
      await refused
      await listReread

      // The group the 404 reported as gone is off the select -- waited for, not
      // counted once: the count alone would pass before the re-read painted.
      await page.getByRole("combobox", { name: "Group", exact: true }).click()
      await page.getByRole("option", { name: "Org admins", exact: true }).waitFor({ state: "detached" })
      assert.equal(
        await page.getByRole("option", { name: "Org admins", exact: true }).count(),
        0,
        "a group a 404 reported as gone stayed on the list because its section had unmounted",
      )
      await page.keyboard.press("Escape")

      const body = await page.innerText("body")
      // A refusal naming a group the operator has left is as stale as a success.
      assert.ok(
        !body.includes("does not exist"),
        "a refusal about a group the operator had already left was shown over its replacement",
      )
      assert.ok(!body.includes("Org admins"), "the deleted group was still named after the 404 that reported it")
    } finally {
      await close()
    }
  })
})
