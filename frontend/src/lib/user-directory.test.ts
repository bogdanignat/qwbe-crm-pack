// Unit tests for the picker's directory search: debounce, latest-wins races,
// the four answers kept apart, and excluded accounts staying visible.
//
// No DOM and no backend: the search function is injected, timers are the test
// runner's mocks. The same boundary the sharing suite tests across.

import assert from "node:assert/strict"
import { describe, it, mock } from "node:test"

import {
  DIRECTORY_BOUNDED_CLAIM,
  DIRECTORY_BOUNDED_NOTE,
  DIRECTORY_LIMIT,
  DIRECTORY_REFUSED_NOTE,
  createDirectorySearch,
  directoryStatus,
  isSelectable,
  normalizeDirectoryQuery,
  suggestionsOf,
  type DirectoryState,
} from "./user-directory.ts"
import { normalizeUsername, type AccountPage, type AccountRef, type SharingResult } from "./sharing.ts"

const account = (username: string, displayName: string | null = null): AccountRef => ({
  id: `id-${username}`,
  username,
  displayName,
})

// Lets every already-queued microtask (the injected search's `.then`) run.
// setImmediate is untouched by the runner's setTimeout mocks.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Records every state the controller emitted, newest last.
function recorder() {
  const states: DirectoryState[] = []
  return { states, onState: (s: DirectoryState) => void states.push(s), last: () => states[states.length - 1] }
}

// `returned` defaults to the readable rows; pass it explicitly to model a page
// where the backend sent more rows than this adapter could parse.
const ok = (rows: AccountRef[], returned = rows.length): SharingResult<AccountPage> => ({
  ok: true,
  value: { rows, returned },
})

// The injected search's own signature. A bare `mock.fn(async () => ...)` is
// typed with zero parameters, so the recorded `arguments` collapse to the empty
// tuple and asserting on [query, limit] stops type-checking; pinning the mock to
// this type keeps those assertions typed as the real call shape.
type FetchAccounts = NonNullable<Parameters<typeof createDirectorySearch>[0]["fetchAccounts"]>

describe("suggestionsOf", () => {
  it("shows the display name first with the @username beside it", () => {
    const rows = suggestionsOf([account("mihai", "Mihai Ionescu"), account("ana")], [])
    assert.deepEqual(rows, [
      { id: "id-mihai", username: "mihai", primary: "Mihai Ionescu", secondary: "@mihai", excludedReason: null },
      { id: "id-ana", username: "ana", primary: "@ana", secondary: null, excludedReason: null },
    ])
  })

  it("keeps an excluded account visible and unselectable, with the caller's reason", () => {
    const rows = suggestionsOf(
      [account("mihai"), account("ana")],
      [{ username: "mihai", reason: "Already in group" }],
    )
    assert.equal(rows.length, 2, "an excluded account is never filtered away")
    assert.equal(rows[0].excludedReason, "Already in group")
    assert.equal(isSelectable(rows[0]), false)
    assert.equal(isSelectable(rows[1]), true)
  })

  it("compares usernames exactly, the way the submit path and the backend do", () => {
    // Both sides come from the same account lookup, so a real duplicate always
    // matches exactly. Case-folding here and nowhere else would let the picker
    // block an account the mutation would happily accept -- a refusal this
    // frontend has no authority to invent, and one the kernel's own username
    // case semantics would have to settle.
    const rows = suggestionsOf([account("mihai")], [{ username: "MIHAI", reason: "Already in group" }])
    assert.equal(rows[0].excludedReason, null)
    assert.equal(isSelectable(rows[0]), true)
  })

  it("carries the caller's own wording, so the shared picker never says 'group' elsewhere", () => {
    const shared = suggestionsOf([account("mihai")], [{ username: "mihai", reason: "Already shared" }])
    assert.equal(shared[0].excludedReason, "Already shared")
  })
})

describe("normalizeDirectoryQuery", () => {
  it("strips a leading @ -- the directory's own usernames never carry it", () => {
    assert.equal(normalizeDirectoryQuery("@maria"), "maria")
  })

  it("leaves a query with no leading @ untouched", () => {
    assert.equal(normalizeDirectoryQuery("maria"), "maria")
  })

  it("strips only the leading @, not one inside the text (an email search)", () => {
    assert.equal(normalizeDirectoryQuery("maria@example.com"), "maria@example.com")
  })

  it("leaves a bare @ as an empty query, not as a search for '@'", () => {
    assert.equal(normalizeDirectoryQuery("@"), "")
  })

  // The T-1450 half-fix: the search stripped the sigil and the submit did not,
  // so "@maria" listed Maria and then invited "@maria". One rule for both.
  it("is the SAME rule the submit path applies (normalizeUsername)", () => {
    for (const typed of ["@maria", "maria", " @maria ", "@ maria", "maria@example.com", "@"]) {
      assert.equal(normalizeDirectoryQuery(typed), normalizeUsername(typed), typed)
    }
  })
})

describe("createDirectorySearch", () => {
  it("sends the @-prefixed query to the backend with the sigil stripped, T-1450's '@maria' complaint", async (t) => {
    // The placeholder ("@username") and every rendered suggestion ("@mihai")
    // invite exactly this input, but the directory's own username values never
    // carry the "@" (suggestionsOf prepends it only for display) -- an
    // unstripped query can never substring-match the row it names.
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const fetchAccounts = mock.fn<FetchAccounts>(async () => ok([account("maria")]))
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts, pauseMs: 300 })

    search.search("@maria", { immediate: true })
    assert.equal(fetchAccounts.mock.callCount(), 1)
    assert.deepEqual(fetchAccounts.mock.calls[0].arguments, ["maria", DIRECTORY_LIMIT])

    // The typed text stays in the emitted state as-is: the heading and the live
    // region echo what the operator wrote, not the request sent behind it.
    await flush()
    assert.deepEqual(rec.last(), { kind: "ready", query: "@maria", rows: [account("maria")], truncated: false })
  })

  it("debounces typing: one request for the last query only", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const fetchAccounts = mock.fn<FetchAccounts>(async () => ok([account("marin")]))
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts, pauseMs: 300 })

    search.search("m")
    search.search("ma")
    search.search("mar")
    assert.equal(fetchAccounts.mock.callCount(), 0, "nothing is requested while the operator types")
    assert.deepEqual(rec.last(), { kind: "loading", query: "mar" })

    t.mock.timers.tick(300)
    assert.equal(fetchAccounts.mock.callCount(), 1)
    assert.deepEqual(fetchAccounts.mock.calls[0].arguments, ["mar", DIRECTORY_LIMIT])
  })

  it("opens with the empty query at once, without waiting for the debounce", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const fetchAccounts = mock.fn<FetchAccounts>(async () => ok([account("ana")]))
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts, pauseMs: 300 })

    search.search("", { immediate: true })
    assert.equal(fetchAccounts.mock.callCount(), 1)
    assert.deepEqual(fetchAccounts.mock.calls[0].arguments, ["", DIRECTORY_LIMIT])
  })

  it("drops a slow answer overtaken by a newer query (latest wins)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const slow = deferred<SharingResult<AccountPage>>()
    const fast = deferred<SharingResult<AccountPage>>()
    const answers = [slow.promise, fast.promise]
    const fetchAccounts = mock.fn(() => answers.shift() as Promise<SharingResult<AccountPage>>)
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts, pauseMs: 300 })

    search.search("ma")
    t.mock.timers.tick(300)
    search.search("marin")
    t.mock.timers.tick(300)
    assert.equal(fetchAccounts.mock.callCount(), 2)

    fast.resolve(ok([account("marin")]))
    await flush()
    slow.resolve(ok([account("maria"), account("marcel")]))
    await flush()

    const last = rec.last()
    assert.equal(last.kind, "ready")
    assert.deepEqual(
      last.kind === "ready" ? last.rows.map((r) => r.username) : null,
      ["marin"],
      "the stale answer for 'ma' must never replace the answer for 'marin'",
    )
  })

  it("reports an empty result as a real empty, not as a refusal", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const rec = recorder()
    const search = createDirectorySearch({
      onState: rec.onState,
      fetchAccounts: async () => ok([]),
      pauseMs: 300,
    })
    search.search("zzz")
    t.mock.timers.tick(300)
    await flush()
    assert.deepEqual(rec.last(), { kind: "ready", query: "zzz", rows: [], truncated: false })
  })

  it("marks a full page as truncated: a page is not the whole directory", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const rows = Array.from({ length: 3 }, (_, i) => account(`u${i}`))
    const rec = recorder()
    const search = createDirectorySearch({
      onState: rec.onState,
      fetchAccounts: async () => ok(rows),
      limit: 3,
      pauseMs: 300,
    })
    search.search("", { immediate: true })
    await flush()
    const last = rec.last()
    assert.equal(last.kind === "ready" && last.truncated, true)
  })

  it("still marks a full page as truncated when malformed rows were dropped", async () => {
    // The backend filled the page (3 of 3); one row was unreadable, so two
    // render. Judging truncation by the rendered rows would call this list
    // complete and quietly promise the operator there is nothing else.
    const rec = recorder()
    createDirectorySearch({
      onState: rec.onState,
      fetchAccounts: async () => ok([account("u0"), account("u1")], 3),
      limit: 3,
    }).search("", { immediate: true })
    await flush()
    const last = rec.last()
    assert.equal(last.kind, "ready")
    assert.equal(last.kind === "ready" && last.rows.length, 2)
    assert.equal(
      last.kind === "ready" && last.truncated,
      true,
      "a capped page stays capped even when this adapter could not read all of it",
    )
  })

  it("does not call a short page truncated", async () => {
    const rec = recorder()
    createDirectorySearch({
      onState: rec.onState,
      fetchAccounts: async () => ok([account("u0")], 1),
      limit: 3,
    }).search("", { immediate: true })
    await flush()
    const last = rec.last()
    assert.equal(last.kind, "ready")
    assert.equal(last.kind === "ready" && last.truncated, false)
  })

  it("keeps a 403 refusal apart from a transport failure", async () => {
    const refused = recorder()
    createDirectorySearch({
      onState: refused.onState,
      fetchAccounts: async () => ({ ok: false, status: 403, message: "forbidden" }),
    }).search("mi", { immediate: true })
    await flush()
    assert.deepEqual(refused.last(), { kind: "refused", query: "mi" })

    const failed = recorder()
    createDirectorySearch({
      onState: failed.onState,
      fetchAccounts: async () => ({ ok: false, status: 0, message: "network error" }),
    }).search("mi", { immediate: true })
    await flush()
    assert.deepEqual(failed.last(), { kind: "failed", query: "mi", message: "network error" })
  })

  it("treats a rejected search as a failure, never as an empty directory", async () => {
    const rec = recorder()
    createDirectorySearch({
      onState: rec.onState,
      fetchAccounts: () => Promise.reject(new Error("boom")),
    }).search("mi", { immediate: true })
    await flush()
    assert.equal(rec.last().kind, "failed")
  })

  it("retry re-runs the last query at once", async () => {
    const fetchAccounts = mock.fn<FetchAccounts>(async () => ok([account("ana")]))
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts })
    search.search("an", { immediate: true })
    search.retry()
    assert.equal(fetchAccounts.mock.callCount(), 2)
    assert.deepEqual(fetchAccounts.mock.calls[1].arguments[0], "an")
  })

  it("cancel drops the pending timer and any answer in flight", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const pending = deferred<SharingResult<AccountPage>>()
    const fetchAccounts = mock.fn(() => pending.promise)
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts, pauseMs: 300 })

    search.search("an")
    t.mock.timers.tick(300)
    search.cancel()
    assert.deepEqual(rec.last(), { kind: "idle" })

    pending.resolve(ok([account("ana")]))
    await flush()
    assert.deepEqual(rec.last(), { kind: "idle" }, "a late answer must not reopen a closed list")

    search.search("x")
    t.mock.timers.tick(300)
    assert.equal(fetchAccounts.mock.callCount(), 2, "the pending timer was dropped, not fired twice")
  })

  it("emits nothing after dispose (unmounted picker)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const pending = deferred<SharingResult<AccountPage>>()
    const rec = recorder()
    const search = createDirectorySearch({ onState: rec.onState, fetchAccounts: () => pending.promise, pauseMs: 300 })

    search.search("an")
    t.mock.timers.tick(300)
    const before = rec.states.length
    search.dispose()
    pending.resolve(ok([account("ana")]))
    await flush()
    assert.equal(rec.states.length, before, "no state is applied to an unmounted picker")
  })
})

describe("directoryStatus", () => {
  const ready = (rows: AccountRef[], excluded: Parameters<typeof suggestionsOf>[1], truncated = false) => {
    const state: DirectoryState = { kind: "ready", query: "m", rows, truncated }
    return directoryStatus({ open: true, state, suggestions: suggestionsOf(rows, excluded) })
  }

  it("says nothing while the list is closed", () => {
    assert.equal(
      directoryStatus({ open: false, state: { kind: "ready", query: "m", rows: [], truncated: true }, suggestions: [] }),
      "",
    )
  })

  it("counts the options so a non-visual operator knows the list is not empty", () => {
    assert.equal(ready([account("mihai")], []), "1 account listed.")
    assert.equal(ready([account("mihai"), account("maria")], []), "2 accounts listed.")
  })

  it("announces the accounts that are present but blocked, with the caller's reason", () => {
    // The arrow keys skip a disabled row, so without this the existing member
    // is simply absent from everything a keyboard operator can perceive -- the
    // exact confusion ("no such user") the disabled rows exist to prevent.
    const status = ready(
      [account("mihai"), account("maria")],
      [{ username: "mihai", reason: "Already in group" }],
    )
    assert.equal(status, "2 accounts listed. 1 account cannot be picked: Already in group.")
  })

  it("joins distinct reasons once each", () => {
    const status = ready(
      [account("mihai"), account("maria"), account("ana")],
      [
        { username: "mihai", reason: "Already shared" },
        { username: "maria", reason: "Already shared" },
        { username: "ana", reason: "You manage this record" },
      ],
    )
    assert.equal(
      status,
      "3 accounts listed. 3 accounts cannot be picked: Already shared; You manage this record.",
    )
  })

  it("says the page is bounded, and says it without inventing a total", () => {
    const status = ready([account("mihai")], [], true)
    assert.equal(status, `1 account listed. ${DIRECTORY_BOUNDED_CLAIM}`)
    assert.match(status, new RegExp(`Showing up to ${DIRECTORY_LIMIT} matches; there may be more\\.`))
    assert.doesNotMatch(status, /\bof \d+\b/, "the directory total is not in the response and is never guessed")
  })

  it("does not claim more accounts exist: a page filled to the limit is only a cap", () => {
    // A directory holding exactly DIRECTORY_LIMIT matches fills the page too,
    // so "there ARE more" would be a claim the response cannot support. The
    // wording states the cap as a fact and the surplus as a possibility.
    for (const text of [DIRECTORY_BOUNDED_CLAIM, DIRECTORY_BOUNDED_NOTE]) {
      assert.match(text, new RegExp(`^Showing up to ${DIRECTORY_LIMIT} matches; there may be more\\.`))
      assert.doesNotMatch(text, /More accounts match/)
      assert.doesNotMatch(text, /\bof \d+\b/)
    }
  })

  it("keeps the standing advice out of the announcement and in the note", () => {
    // The visible note carries the advice; the live region carries the fact
    // alone, so a settled result does not repeat "Keep typing" every query --
    // the field's permanent help text already says it.
    assert.match(DIRECTORY_BOUNDED_NOTE, /Keep typing to narrow the search\.$/)
    assert.doesNotMatch(DIRECTORY_BOUNDED_CLAIM, /Keep typing/)
    assert.doesNotMatch(ready([account("mihai")], [], true), /Keep typing/)
  })

  it("stays silent while a search runs: the live region announces settled states only", () => {
    // Every keystroke passes through `loading`. Announcing it interrupts the
    // operator's own typing with a sentence that carries no result; the visible
    // "Searching…" panel and the input's aria-busy cover the wait instead.
    assert.equal(
      directoryStatus({ open: true, state: { kind: "loading", query: "mi" }, suggestions: [] }),
      "",
    )
    assert.equal(
      directoryStatus({ open: true, state: { kind: "loading", query: "mih" }, suggestions: [] }),
      "",
      "and it is the same silence for the next keystroke: no text change, no announcement",
    )
  })

  it("keeps the four answers apart, and never calls a refusal or a failure 'no matches'", () => {
    assert.equal(
      directoryStatus({ open: true, state: { kind: "refused", query: "mi" }, suggestions: [] }),
      DIRECTORY_REFUSED_NOTE,
    )
    assert.equal(
      directoryStatus({ open: true, state: { kind: "failed", query: "mi", message: "network error" }, suggestions: [] }),
      "network error",
    )
    assert.equal(
      directoryStatus({ open: true, state: { kind: "ready", query: "zzz", rows: [], truncated: false }, suggestions: [] }),
      "no matches",
    )
    assert.equal(
      directoryStatus({ open: true, state: { kind: "ready", query: "", rows: [], truncated: false }, suggestions: [] }),
      "no accounts to show",
    )
  })
})
