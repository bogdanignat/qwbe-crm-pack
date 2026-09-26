// Unit tests for the sharing panel's identity/groups load: the boundary parse
// of /auth/me, and the two independent lifetimes that replaced one shared
// effect -- the regression that lost the operator's identity whenever the
// groups answered first.
//
// No DOM and no backend: both reads are injected as deferreds, so the test
// chooses the completion order.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createIdentityLoad, fetchSessionAccount, sessionAccountOf, type SessionAccount } from "./sharing-identity.ts"

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// A stubbed fetch, cast the way the sharing suite casts its own stubs (fewer
// parameters than the DOM `fetch` overloads).
const stub = (status: number, body: unknown): typeof fetch =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as typeof fetch

// One load with both reads pending, and a record of everything it published.
function harness() {
  const groups = deferred<Record<string, string> | null>()
  const me = deferred<SessionAccount | null>()
  const seen: { groups: Array<Record<string, string> | null>; me: SessionAccount[] } = { groups: [], me: [] }
  const load = createIdentityLoad({
    loadGroups: () => groups.promise,
    loadMe: () => me.promise,
    onGroups: (g) => void seen.groups.push(g),
    onMe: (m) => void seen.me.push(m),
  })
  return { load, groups, me, seen }
}

describe("sessionAccountOf", () => {
  it("accepts an identity with both an id and a username", () => {
    assert.deepEqual(sessionAccountOf({ id: "u-1", username: "mihai", email: "x@y.z" }), {
      id: "u-1",
      username: "mihai",
    })
  })

  it("refuses a half or unreadable identity instead of guessing one", () => {
    // A missing username would make the picker mark the wrong account, or none,
    // and the panel's "you already manage this record" guard would compare
    // against nothing. No identity is the honest answer.
    for (const raw of [null, undefined, "mihai", 7, {}, { id: "u-1" }, { username: "mihai" }, { id: "", username: "mihai" }, { id: "u-1", username: 3 }]) {
      assert.equal(sessionAccountOf(raw), null, `refused: ${JSON.stringify(raw)}`)
    }
  })
})

describe("fetchSessionAccount", () => {
  it("reads the signed-in account", async () => {
    const me = await fetchSessionAccount(stub(200, { id: "u-1", username: "mihai" }))
    assert.deepEqual(me, { id: "u-1", username: "mihai" })
  })

  it("degrades a refusal, a failure and an unreadable body to 'identity unknown'", async () => {
    assert.equal(await fetchSessionAccount(stub(403, null)), null)
    assert.equal(await fetchSessionAccount(stub(200, { id: "u-1" })), null)
    assert.equal(
      await fetchSessionAccount((async () => {
        throw new Error("network down")
      }) as typeof fetch),
      null,
    )
  })
})

describe("createIdentityLoad", () => {
  it("keeps the identity when the groups answer FIRST (the reported race)", async () => {
    // The panel's single effect used to list the groups state in its
    // dependencies: setGroups re-ran it, the cleanup cancelled the /auth/me
    // answer still in flight, and the re-run refused to start it again. The
    // owner's own account then lost its "You manage this record" mark and the
    // form offered a share with the operator themselves.
    const { load, groups, me, seen } = harness()
    load.start()
    groups.resolve({ "g-1": "Sales" })
    await flush()
    assert.deepEqual(seen.groups, [{ "g-1": "Sales" }])
    me.resolve({ id: "u-1", username: "mihai" })
    await flush()
    assert.deepEqual(seen.me, [{ id: "u-1", username: "mihai" }], "the late identity is still applied")
  })

  it("keeps the groups when the identity answers FIRST", async () => {
    const { load, groups, me, seen } = harness()
    load.start()
    me.resolve({ id: "u-1", username: "mihai" })
    await flush()
    assert.deepEqual(seen.me, [{ id: "u-1", username: "mihai" }])
    groups.resolve(null)
    await flush()
    assert.deepEqual(seen.groups, [null], "a refusal is still published, so the group form stays hidden")
  })

  it("publishes nothing after dispose, in either order", async () => {
    const first = harness()
    first.load.start()
    first.load.dispose()
    first.groups.resolve({ "g-1": "Sales" })
    first.me.resolve({ id: "u-1", username: "mihai" })
    await flush()
    assert.deepEqual(first.seen, { groups: [], me: [] })

    // Disposed AFTER the groups landed: the identity in flight is dropped too,
    // because the lifetime belongs to the load and not to either result.
    const second = harness()
    second.load.start()
    second.groups.resolve(null)
    await flush()
    second.load.dispose()
    second.me.resolve({ id: "u-1", username: "mihai" })
    await flush()
    assert.deepEqual(second.seen.groups, [null])
    assert.deepEqual(second.seen.me, [])
  })

  it("starts each read once, however often start is called", async () => {
    let groupCalls = 0
    let meCalls = 0
    const load = createIdentityLoad({
      loadGroups: async () => {
        groupCalls += 1
        return null
      },
      loadMe: async () => {
        meCalls += 1
        return null
      },
      onGroups: () => undefined,
      onMe: () => undefined,
    })
    load.start()
    load.start()
    load.start()
    await flush()
    assert.equal(groupCalls, 1)
    assert.equal(meCalls, 1)
  })

  it("does not start anything after dispose", async () => {
    let calls = 0
    const load = createIdentityLoad({
      loadGroups: async () => {
        calls += 1
        return null
      },
      loadMe: async () => {
        calls += 1
        return null
      },
      onGroups: () => undefined,
      onMe: () => undefined,
    })
    load.dispose()
    load.start()
    await flush()
    assert.equal(calls, 0)
  })

  it("reads a rejected groups request as 'refused', and never publishes a null identity", async () => {
    const groups = deferred<Record<string, string> | null>()
    const me = deferred<SessionAccount | null>()
    const seen: { groups: Array<Record<string, string> | null>; me: SessionAccount[] } = { groups: [], me: [] }
    const load = createIdentityLoad({
      loadGroups: () => groups.promise,
      loadMe: () => me.promise,
      onGroups: (g) => void seen.groups.push(g),
      onMe: (m) => void seen.me.push(m),
    })
    load.start()
    groups.reject(new Error("boom"))
    me.resolve(null)
    await flush()
    assert.deepEqual(seen.groups, [null], "the group form stays hidden; the user form keeps working")
    assert.deepEqual(seen.me, [], "an unknown identity leaves `me` as it was")
  })
})
