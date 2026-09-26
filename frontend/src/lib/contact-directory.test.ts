// Unit tests for the contact search and the member-list resolution (T-1451).
//
// The properties under test:
//   - the picker searches with q= and a limit of 20, so it never downloads the
//     contacts cube;
//   - a whole member page costs ONE ids= request, never one per row;
//   - every URL this feature produces is a contacts URL -- the account
//     directory is not reachable from here;
//   - the four answers stay apart (ready / empty / refused 403 / failed), a
//     newer keystroke wins over an older answer, and a membership row whose
//     contact is missing says so instead of showing a raw id.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  contactBatchPath,
  contactRefOf,
  contactSearchPath,
  contactSearchStatus,
  contactSuggestionsOf,
  createContactSearch,
  isSelectableContact,
  memberAddedMessage,
  memberLabelOf,
  memberRemoveLabel,
  memberRemovedMessage,
  memberRowsOf,
  resolveContacts,
  searchContacts,
  CONTACT_SEARCH_LIMIT,
  MISSING_CONTACT_LABEL,
  type ContactRef,
  type ContactSearchState,
} from "./contact-directory.ts"
import type { Row } from "./cube.ts"

type Call = { url: string; method: string }

function stubFetch(
  reply: (url: string) => { status: number; body?: unknown },
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? "GET" })
    const answer = reply(url)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { fetch: fake, calls }
}

const contactRow = (id: string, name: string, company: string | null = null): Row => ({
  id,
  name,
  email: `${id}@example.test`,
  company,
  organizationId: null,
})

const ada: ContactRef = { id: "cont-1", name: "Ada Popescu", company: "Acme" }
const bogdan: ContactRef = { id: "cont-2", name: "Bogdan Ionescu", company: null }

describe("paths", () => {
  it("searches with q and the bounded limit, against the contacts cube only", () => {
    const path = contactSearchPath("ada")
    assert.equal(path, "/api/qwbe/contacts?q=ada&limit=20")
    assert.equal(CONTACT_SEARCH_LIMIT, 20)
    assert.ok(!path.includes("/account"))
    assert.ok(!path.includes("/permissions"))
    assert.ok(!path.includes("contact-groups"))
  })

  it("sends no q for empty text: the first page, not a search for nothing", () => {
    assert.equal(contactSearchPath("   "), "/api/qwbe/contacts?limit=20")
  })

  it("batches ids into ONE request and deduplicates them", () => {
    assert.equal(
      contactBatchPath(["cont-1", "cont-2", "cont-1"]),
      "/api/qwbe/contacts?ids=cont-1%2Ccont-2",
    )
  })
})

describe("row narrowing", () => {
  it("keeps id, name and company, and drops email and everything else", () => {
    assert.deepEqual(contactRefOf(contactRow("cont-1", "Ada Popescu", "Acme")), ada)
  })

  it("treats an empty company as absent", () => {
    assert.equal(contactRefOf(contactRow("cont-2", "Bogdan Ionescu", ""))?.company, null)
  })

  it("drops a row that cannot be posted or shown", () => {
    assert.equal(contactRefOf({ name: "No id" }), null)
    assert.equal(contactRefOf({ id: "", name: "Blank id" }), null)
    assert.equal(contactRefOf({ id: "cont-3" }), null)
    assert.equal(contactRefOf({ id: "cont-3", name: "   " }), null)
  })
})

describe("resolving a member page", () => {
  it("resolves a whole page with ONE request, whatever its size", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `cont-${i}`)
    const { fetch, calls } = stubFetch(() => ({
      status: 200,
      body: { rows: ids.map((id) => contactRow(id, `Contact ${id}`)), offset: 0, limit: 25 },
    }))
    const result = await resolveContacts(ids, fetch)
    assert.equal(result.ok, true)
    assert.equal(calls.length, 1, "one ids= batch, never one request per member")
    assert.equal(calls[0].method, "GET")
    assert.equal(Object.keys(result.ok === true ? result.value : {}).length, 25)
  })

  it("sends nothing at all for an empty page", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: { rows: [] } }))
    const result = await resolveContacts([], fetch)
    assert.equal(calls.length, 0)
    assert.deepEqual(result.ok === true ? result.value : null, {})
  })

  it("reports a refused batch instead of silently showing rows with no names", async () => {
    const { fetch } = stubFetch(() => ({ status: 403, body: { message: "forbidden" } }))
    const result = await resolveContacts(["cont-1"], fetch)
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.status, 403)
  })

  it("names a membership row whose contact the batch did not return", () => {
    const rows = memberRowsOf(
      [
        { id: "cgm-1", contactId: "cont-1" },
        { id: "cgm-2", contactId: "cont-gone" },
      ],
      { "cont-1": ada },
    )
    assert.deepEqual(memberLabelOf(rows[0]), { primary: "Ada Popescu", secondary: "Acme" })
    assert.deepEqual(memberLabelOf(rows[1]), { primary: MISSING_CONTACT_LABEL, secondary: null })
    // Deleted, hidden by the permission filter, or never a contact at all --
    // the three are indistinguishable from here, so the word is UNAVAILABLE.
    assert.match(MISSING_CONTACT_LABEL, /unavailable/i)
    assert.ok(!/not found|deleted|removed/i.test(MISSING_CONTACT_LABEL))
    // The row is still a real membership, so it keeps its ids and can be removed.
    assert.equal(rows[1].membershipId, "cgm-2")
    assert.equal(rows[1].contactId, "cont-gone")
  })
})

describe("suggestions", () => {
  it("keeps an excluded contact visible, disabled, with the caller's reason", () => {
    const suggestions = contactSuggestionsOf([ada, bogdan], [{ id: ada.id, reason: "Already in this group" }])
    assert.equal(suggestions[0].excludedReason, "Already in this group")
    assert.equal(isSelectableContact(suggestions[0]), false)
    assert.equal(isSelectableContact(suggestions[1]), true)
    assert.equal(suggestions.length, 2, "a blocked contact is shown, never filtered into 'no matches'")
  })

  it("carries the count, the blocked rows and the bound in one sentence", () => {
    const suggestions = contactSuggestionsOf([ada, bogdan], [{ id: ada.id, reason: "Already in this group" }])
    const status = contactSearchStatus({
      open: true,
      state: { kind: "ready", query: "a", rows: [ada, bogdan], truncated: true },
      suggestions,
    })
    assert.match(status, /2 contacts listed\./)
    assert.match(status, /1 contact cannot be picked: Already in this group\./)
    assert.match(status, /there may be more/)
  })

  it("says nothing while loading, and tells a refusal apart from an empty result", () => {
    const quiet: ContactSearchState = { kind: "loading", query: "ad" }
    assert.equal(contactSearchStatus({ open: true, state: quiet, suggestions: [] }), "")
    assert.equal(contactSearchStatus({ open: false, state: { kind: "idle" }, suggestions: [] }), "")
    assert.match(
      contactSearchStatus({ open: true, state: { kind: "refused", query: "ad" }, suggestions: [] }),
      /may not search contacts/,
    )
    assert.equal(
      contactSearchStatus({ open: true, state: { kind: "ready", query: "zz", rows: [], truncated: false }, suggestions: [] }),
      "no matches",
    )
    assert.equal(
      contactSearchStatus({ open: true, state: { kind: "ready", query: "", rows: [], truncated: false }, suggestions: [] }),
      "no contacts to show",
    )
  })
})

describe("the search controller", () => {
  it("maps a 403 to refused, so the picker never says 'no matches' about a refusal", async () => {
    const { fetch } = stubFetch(() => ({ status: 403, body: { message: "forbidden" } }))
    const result = await searchContacts("ada", 20, fetch)
    assert.equal(result.ok === false && result.status, 403)
  })

  it("calls a page truncated on what the BACKEND returned, not on what survived narrowing", async () => {
    const states: ContactSearchState[] = []
    const rows = Array.from({ length: 20 }, (_, i) => contactRow(`cont-${i}`, `Contact ${i}`))
    rows[0] = { id: "cont-0" } // unusable: dropped from the options, still a returned row
    const { fetch } = stubFetch(() => ({ status: 200, body: { rows, offset: 0, limit: 20 } }))
    const search = createContactSearch({
      onState: (s) => states.push(s),
      fetchContacts: (q, limit) => searchContacts(q, limit, fetch),
      pauseMs: 1,
    })
    search.search("c", { immediate: true })
    await new Promise((r) => setTimeout(r, 30))
    const ready = states.find((s) => s.kind === "ready")
    assert.ok(ready !== undefined && ready.kind === "ready")
    assert.equal(ready.rows.length, 19)
    assert.equal(ready.truncated, true)
    search.dispose()
  })

  it("lets the newest query win: a slow answer for 'ad' cannot land after 'adriana'", async () => {
    const states: ContactSearchState[] = []
    const search = createContactSearch({
      onState: (s) => states.push(s),
      fetchContacts: (q) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, value: { rows: [{ id: `cont-${q}`, name: q, company: null }], returned: 1 } }),
            q === "ad" ? 40 : 1,
          ),
        ),
      pauseMs: 1,
    })
    search.search("ad")
    await new Promise((r) => setTimeout(r, 5))
    search.search("adriana")
    await new Promise((r) => setTimeout(r, 80))
    const ready = states.filter((s) => s.kind === "ready")
    assert.equal(ready.length, 1)
    assert.equal(ready[0].kind === "ready" && ready[0].query, "adriana")
    search.dispose()
  })

  it("debounces: keystrokes inside the pause cost ONE request", async () => {
    let requests = 0
    const search = createContactSearch({
      onState: () => {},
      fetchContacts: async (q) => {
        requests++
        return { ok: true, value: { rows: [{ id: "cont-1", name: q, company: null }], returned: 1 } }
      },
      pauseMs: 20,
    })
    search.search("a")
    search.search("ad")
    search.search("ada")
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(requests, 1)
    search.dispose()
  })

  it("emits a failure for a rejected request, never an empty contacts cube", async () => {
    const states: ContactSearchState[] = []
    const search = createContactSearch({
      onState: (s) => states.push(s),
      fetchContacts: () => Promise.reject(new Error("offline")),
      pauseMs: 1,
    })
    search.search("ada", { immediate: true })
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(states.at(-1)?.kind, "failed")
    search.dispose()
  })

  it("emits nothing after dispose: a late answer cannot repaint an unmounted picker", async () => {
    const states: ContactSearchState[] = []
    const search = createContactSearch({
      onState: (s) => states.push(s),
      fetchContacts: () =>
        new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: { rows: [], returned: 0 } }), 30)),
      pauseMs: 1,
    })
    search.search("ada", { immediate: true })
    search.dispose()
    const after = states.length
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(states.length, after)
  })
})

describe("what is said about a membership", () => {
  const resolved = memberRowsOf([{ id: "cgm-1", contactId: ada.id }], { [ada.id]: ada })[0]
  const unresolved = memberRowsOf([{ id: "cgm-2", contactId: "cont-gone" }], {})[0]

  it("gives an unresolved row its own remove label, instead of naming nobody", () => {
    assert.equal(memberRemoveLabel(resolved), "Remove Ada Popescu from this group")
    const label = memberRemoveLabel(unresolved)
    assert.match(label, /unavailable contact/i)
    // Never "Remove Contact unavailable from this group", which reads as a name.
    assert.ok(!label.includes(MISSING_CONTACT_LABEL))
    assert.ok(!label.includes("cont-gone"))
  })

  it("says the membership went, without naming a contact it cannot name", () => {
    assert.equal(memberRemovedMessage(resolved), "Ada Popescu was removed from this group.")
    const message = memberRemovedMessage(unresolved)
    assert.match(message, /membership was removed/i)
    assert.ok(!message.includes(MISSING_CONTACT_LABEL))
    assert.ok(!message.includes("cont-gone"))
  })

  it("states the RESULT of an add, never an addition it cannot prove", () => {
    // Adding is idempotent and the 200 carries no "created" flag: the same
    // sentence has to be true both for a new row and for an existing one.
    const message = memberAddedMessage("Ada Popescu")
    assert.equal(message, "Ada Popescu is in this group.")
    assert.ok(!/was added|added to|created|new member/i.test(message))
  })
})
