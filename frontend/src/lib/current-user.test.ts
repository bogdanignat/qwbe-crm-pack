// Unit tests for the shared /auth/me read (T-1812): the body is guarded field by
// field, concurrent callers share one request, and nothing outlives it.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { currentUserOf, fetchCurrentUser } from "./current-user.ts"

describe("currentUserOf", () => {
  it("reads id, username, roles and permissions, and admin from roles", () => {
    assert.deepEqual(currentUserOf({ id: "a1", username: "admin", roles: ["admin"], permissions: ["customfields:write"] }), {
      id: "a1",
      username: "admin",
      roles: ["admin"],
      permissions: ["customfields:write"],
      admin: true,
    })
  })

  it("never throws on roles or permissions that are not arrays of strings", () => {
    const user = currentUserOf({ id: "u1", username: "ana", roles: "admin", permissions: [1, "a:read"] })
    assert.deepEqual(user && [user.roles, user.permissions, user.admin], [[], ["a:read"], false])
  })

  it("is null for a body that names nobody, and falls back to the id for a missing username", () => {
    for (const body of [null, "x", [], {}, { id: "" }, { id: 7 }]) assert.equal(currentUserOf(body), null)
    assert.equal(currentUserOf({ id: "u1" })?.username, "u1")
  })
})

describe("fetchCurrentUser", () => {
  const counting = (respond: () => Response | Promise<Response>) => {
    const calls: string[] = []
    const doFetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return respond()
    }) as typeof fetch
    return { doFetch, calls }
  }

  it("shares one in-flight request between concurrent callers, then asks again", async () => {
    const { doFetch, calls } = counting(() => Response.json({ id: "u1", username: "ana" }))
    const [a, b] = await Promise.all([fetchCurrentUser(doFetch), fetchCurrentUser(doFetch)])
    assert.equal(a, b)
    assert.deepEqual(calls, ["/api/qwbe/auth/me"])
    await fetchCurrentUser(doFetch)
    assert.equal(calls.length, 2)
  })

  it("resolves null, never rejects, on a refusal, a non-JSON body or a network error", async () => {
    assert.equal(await fetchCurrentUser(counting(() => new Response("no", { status: 500 })).doFetch), null)
    assert.equal(await fetchCurrentUser(counting(() => new Response("<html>")).doFetch), null)
    assert.equal(await fetchCurrentUser(counting(() => Promise.reject(new Error("down"))).doFetch), null)
  })
})
