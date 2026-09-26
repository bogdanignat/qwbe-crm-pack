// Unit tests for the sharing adapter.
//
// Pure derivation plus injected-fetch calls only: no DOM, no backend, no live
// server -- the same boundary the relation-batch suite tests across. The
// contract under test is the qwbe permissions cube as verified on 2026-09-06
// (core/src/cubes/permissions/api.ts, permissions-schemas.ts).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ENTITY_ACTIONS,
  actionsForLevel,
  chipsOf,
  createGroupGrant,
  createUserGrant,
  fetchGrantPage,
  grantRevokePath,
  groupsPath,
  grantActionsLabel,
  grantsPagePath,
  grantsPageView,
  grantsRefPath,
  groupGrantPayload,
  isTotalActions,
  lookupGroups,
  lookupAccounts,
  lookupUserNames,
  memberLabelOf,
  memberMarks,
  normalizeUsername,
  parseAccountPage,
  revokeGrant,
  searchAccounts,
  userGrantPayload,
  userNamesPath,
  userSearchPath,
  addGroupMember,
  createGroup,
  fetchGroupMembersPage,
  fetchGroups,
  groupCreatePath,
  groupMembersAddPath,
  groupMembersPath,
  groupMembersRemovePath,
  groupRenamePath,
  groupWriteRefusalMessage,
  memberWriteRefusalMessage,
  retainSelectedGroup,
  removeGroupMember,
  removeGroupMemberById,
  renameGroup,
  memberRowsOf,
  membersHasMore,
  parseMembersPage,
  type EntityGrantPage,
} from "./sharing.ts"

// A minimal injected fetch: answers `json` with `status` for the asserted
// path+method, and records every request it saw.
function fetchStub(
  responder: (url: string, init: RequestInit | undefined) => { status: number; body: unknown } | undefined,
): { doFetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const answer = responder(url, init)
    if (!answer) return new Response("nope", { status: 404 })
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { doFetch, calls }
}

const grantRow = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  cube: "crm/organizations",
  entityType: "Organization",
  entityId: "o1",
  subject: { kind: "user" as const, userId: "u1" },
  actions: [...ENTITY_ACTIONS],
  createdBy: "admin",
  createdAt: "2026-09-06T00:00:00Z",
  ...over,
})

describe("paths", () => {
  it("percent-encodes the cube slash as ONE segment, plus type and id", () => {
    assert.equal(
      grantsRefPath("crm/organizations", "Organization", "o/1"),
      "/api/qwbe/permissions/entities/crm%2Forganizations/Organization/o%2F1",
    )
  })

  it("keeps the page query explicit: offset and limit travel, nothing is sliced client-side", () => {
    const path = grantsPagePath("crm/organizations", "Organization", "o1", 60, 50)
    const [base, query] = path!.split("?")
    assert.equal(base, "/api/qwbe/permissions/entities/crm%2Forganizations/Organization/o1/grants")
    assert.deepEqual(new URLSearchParams(query), new URLSearchParams("offset=60&limit=50"))
  })

  it("refuses empty references and non-integer page windows", () => {
    assert.equal(grantsRefPath("crm/organizations", "Organization", ""), null)
    assert.equal(grantsRefPath("  ", "Organization", "o1"), null)
    assert.equal(grantsPagePath("crm/organizations", "Organization", "o1", -1, 50), null)
    assert.equal(grantsPagePath("crm/organizations", "Organization", "o1", 0, 0), null)
    assert.equal(grantsPagePath("crm/organizations", "Organization", "o1", 1.5, 50), null)
  })

  it("searches the directory by q with a small limit", () => {
    assert.equal(userSearchPath("  mih  ", 20), "/api/qwbe/account?q=mih&limit=20")
    assert.equal(userSearchPath("", 20), "/api/qwbe/account?limit=20")
  })

  it("batches name lookups by ids, deduplicated", () => {
    assert.equal(userNamesPath(["u1", "u1", "u2"]), "/api/qwbe/account?ids=u1%2Cu2")
    assert.equal(userNamesPath(["  ", ""]), null)
  })

  it("groups query carries the cube; revoke goes by grant id", () => {
    assert.equal(
      groupsPath("crm/organizations"),
      "/api/qwbe/permissions/groups?cube=crm%2Forganizations",
    )
    assert.equal(grantRevokePath("gr/1"), "/api/qwbe/permissions/grants/gr%2F1")
    assert.equal(grantRevokePath(""), null)
  })
})

// T-1450: the picker invites the sigil ("@username" placeholder, "@maria"
// rows) and the directory never carries it. Search and submit share ONE rule,
// so an account the list matched is the account the mutation names.
describe("normalizeUsername", () => {
  it("strips the leading sigil the picker itself invites", () => {
    assert.equal(normalizeUsername("@maria"), "maria")
  })

  it("leaves a bare username untouched", () => {
    assert.equal(normalizeUsername("maria"), "maria")
  })

  it("trims around the name and between the sigil and the name", () => {
    assert.equal(normalizeUsername("  @maria  "), "maria")
    assert.equal(normalizeUsername("@ maria"), "maria")
    assert.equal(normalizeUsername("  mihai "), "mihai")
  })

  it("strips only the LEADING @, never one inside the text (an email)", () => {
    assert.equal(normalizeUsername("maria@example.com"), "maria@example.com")
  })

  it("a bare @ names nobody, so it is empty -- not a user called '@'", () => {
    assert.equal(normalizeUsername("@"), "")
    assert.equal(normalizeUsername("  @  "), "")
  })

  it("does NOT case-fold: the mutation path compares exactly", () => {
    assert.equal(normalizeUsername("@Maria"), "Maria")
  })
})

describe("payloads", () => {
  it("TOTAL snapshot: the exact six actions travel explicitly", () => {
    assert.deepEqual(userGrantPayload("mihai", [...ENTITY_ACTIONS]), {
      payload: { username: "mihai", actions: [...ENTITY_ACTIONS] },
    })
  })

  it("custom snapshot: explicit nonempty set, order kept, duplicates dropped", () => {
    assert.deepEqual(userGrantPayload(" mihai ", ["edit", "read", "read"]), {
      payload: { username: "mihai", actions: ["edit", "read"] },
    })
    assert.deepEqual(groupGrantPayload(" grp_1 ", ["read"]), {
      payload: { groupId: "grp_1", actions: ["read"] },
    })
  })

  it("refuses empty subjects and empty or unknown actions", () => {
    assert.deepEqual(userGrantPayload("  ", ["read"]), { error: "subject" })
    assert.deepEqual(groupGrantPayload("", ["read"]), { error: "subject" })
    assert.deepEqual(userGrantPayload("mihai", []), { error: "actions" })
    assert.deepEqual(userGrantPayload("mihai", ["fly"]), { error: "actions" })
  })

  it("a grant typed as '@maria' names maria, the account the picker matched (T-1450)", () => {
    assert.deepEqual(userGrantPayload("@maria", ["read"]), {
      payload: { username: "maria", actions: ["read"] },
    })
    // A sigil with nothing after it is still no subject at all.
    assert.deepEqual(userGrantPayload("@", ["read"]), { error: "subject" })
  })

  it("a custom set never includes share; only the exact TOTAL set does", () => {
    assert.deepEqual(userGrantPayload("mihai", ["read", "share"]), { error: "actions" })
  })

  it("TOTAL is the exact set of six, not a length of six", () => {
    assert.ok(isTotalActions([...ENTITY_ACTIONS]))
    assert.ok(!isTotalActions(["read", "read", "read", "read", "read", "edit"]))
    assert.ok(!isTotalActions(["read", "edit"]))
  })

  it("chip label says TOTAL only for the exact set, else lists the actions", () => {
    assert.equal(grantActionsLabel([...ENTITY_ACTIONS]), "TOTAL")
    assert.equal(grantActionsLabel(["read", "edit"]), "read, edit")
  })

  it("actionsForLevel: TOTAL is the explicit six, read is [read], custom keeps published order and never share", () => {
    assert.deepEqual(actionsForLevel("total", []), [...ENTITY_ACTIONS])
    assert.deepEqual(actionsForLevel("read", ["edit"]), ["read"])
    assert.deepEqual(actionsForLevel("custom", ["transfer", "share", "read", "fly"]), ["read", "transfer"])
    assert.deepEqual(actionsForLevel("custom", []), [])
  })
})

describe("grant page view", () => {
  it("hasMore follows the explicit total, not a silent truncation", () => {
    const page: EntityGrantPage = {
      rows: [grantRow({ id: "g1" }), grantRow({ id: "g2" })],
      total: 3,
      offset: 0,
      limit: 50,
  }
    const view = grantsPageView(page)
    assert.equal(view.hasMore, true)
    assert.equal(view.total, 3)
    assert.equal(grantsPageView({ ...page, total: 2 }).hasMore, false)
  })

  it("a response without total degrades to probe-next, never to 'end of list'", () => {
    const view = grantsPageView({ rows: [grantRow()], offset: 0, limit: 50 })
    assert.equal(view.hasMore, null)
    assert.equal(view.total, undefined)
  })
})

describe("chips", () => {
  it("labels by resolved username and group name, falling back to the raw id", () => {
    const chips = chipsOf(
      [
        grantRow({ id: "g1", subject: { kind: "user", userId: "u1" } }),
        grantRow({ id: "g2", subject: { kind: "group", groupId: "grp1" }, actions: ["read"] }),
        grantRow({ id: "g3", subject: { kind: "user", userId: "u9" }, actions: ["read", "edit"] }),
      ],
      { u1: "mihai" },
      { grp1: "Sales" },
    )
    assert.deepEqual(chips, [
      { grantId: "g1", kind: "user", subjectId: "u1", label: "mihai", actions: "TOTAL", total: true },
      { grantId: "g2", kind: "group", subjectId: "grp1", label: "Sales", actions: "read", total: false },
      { grantId: "g3", kind: "user", subjectId: "u9", label: "u9", actions: "read, edit", total: false },
    ])
  })

  it("duplicate grant rows stay as separate, separately revokable chips", () => {
    const chips = chipsOf(
      [grantRow({ id: "g1", subject: { kind: "user", userId: "u1" } }),
       grantRow({ id: "g2", subject: { kind: "user", userId: "u1" }, actions: ["read"] })],
      { u1: "mihai" },
      {},
    )
    assert.equal(chips.length, 2)
    assert.deepEqual(chips.map((c) => c.grantId), ["g1", "g2"])
  })
})

describe("calls with injected fetch", () => {
  const cube = { cube: "crm/organizations", entityType: "Organization", entityId: "o1" }

  it("fetchGrantPage posts nothing and maps a 403 to qwbe's message", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 403, body: { message: "only owner, cube admin or superadmin may share this entity" } }))
    const result = await fetchGrantPage({ ...cube, offset: 0, limit: 50, doFetch })
    assert.deepEqual(result, { ok: false, status: 403, message: "only owner, cube admin or superadmin may share this entity" })
    assert.equal(calls[0]?.url, "/api/qwbe/permissions/entities/crm%2Forganizations/Organization/o1/grants?offset=0&limit=50")
  })

  it("createUserGrant sends the explicit payload to the user route", async () => {
    const { doFetch, calls } = fetchStub((url, init) => {
      assert.equal(url, "/api/qwbe/permissions/entities/crm%2Forganizations/Organization/o1/grants/user")
      assert.equal(init?.method, "POST")
      return { status: 200, body: { id: "g1", subject: { kind: "user", userId: "u1" }, actions: [...ENTITY_ACTIONS] } }
    })
    const result = await createUserGrant({ ...cube, username: "mihai", actions: [...ENTITY_ACTIONS], doFetch })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { username: "mihai", actions: [...ENTITY_ACTIONS] })
  })

  it("createUserGrant maps 404 unknown username to qwbe's message", async () => {
    const { doFetch } = fetchStub(() => ({ status: 404, body: { message: "username mihai does not exist" } }))
    const result = await createUserGrant({ ...cube, username: "mihai", actions: [...ENTITY_ACTIONS], doFetch })
    assert.deepEqual(result, { ok: false, status: 404, message: "username mihai does not exist" })
  })

  it("createGroupGrant refuses an empty action set before any request", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: {} }))
    const result = await createGroupGrant({ ...cube, groupId: "grp1", actions: [], doFetch })
    assert.equal(result.ok, false)
    assert.equal(calls.length, 0)
  })

  it("createGroupGrant maps 400 cross-cube group to qwbe's message", async () => {
    const { doFetch } = fetchStub(() => ({ status: 400, body: { message: "group belongs to another cube" } }))
    const result = await createGroupGrant({ ...cube, groupId: "grp1", actions: ["read"], doFetch })
    assert.deepEqual(result, { ok: false, status: 400, message: "group belongs to another cube" })
  })

  it("revokeGrant DELETEs by grant id and maps a 404", async () => {
    const { doFetch, calls } = fetchStub((url, init) => {
      assert.equal(url, "/api/qwbe/permissions/grants/g1")
      assert.equal(init?.method, "DELETE")
      return { status: 200, body: { revoked: "g1" } }
    })
    const ok = await revokeGrant("g1", doFetch)
    assert.deepEqual(ok, { ok: true, value: { revoked: "g1" } })
    const gone = await revokeGrant("g1", fetchStub(() => ({ status: 404, body: { message: "grant g1 not found" } })).doFetch)
    assert.deepEqual(gone, { ok: false, status: 404, message: "grant g1 not found" })
    assert.equal(calls.length, 1)
  })

  it("searchAccounts keeps id and username, drops unusable rows", async () => {
    const { doFetch } = fetchStub(() => ({
      status: 200,
      body: { rows: [{ id: "u1", username: "mihai", displayName: "Mihai", email: "m@x" }, { id: "u2" }] },
    }))
    const result = await searchAccounts({ q: "mih", limit: 20, doFetch })
    assert.deepEqual(result, {
      ok: true,
      value: { rows: [{ id: "u1", username: "mihai", displayName: "Mihai" }], returned: 2 },
    })
  })

  it("lookupUserNames maps resolved rows and falls back around missing ones", async () => {
    const { doFetch } = fetchStub(() => ({ status: 200, body: { rows: [{ id: "u1", username: "mihai" }] } }))
    const names = await lookupUserNames(["u1", "u2"], doFetch)
    assert.deepEqual(names, { u1: "mihai" })
    assert.deepEqual(await lookupUserNames([], doFetch), {})
  })

  it("lookupGroups returns null on 403 (hide the group form) and names on 200", async () => {
    const denied = await lookupGroups("crm/organizations", fetchStub(() => ({ status: 403, body: { message: "only an entity owner or cube admin may manage groups" } })).doFetch)
    assert.equal(denied, null)
    const ok = await lookupGroups("crm/organizations", fetchStub(() => ({
      status: 200,
      body: [{ id: "grp1", cube: "crm/organizations", name: "Sales", createdBy: "admin", createdAt: "x" }],
    })).doFetch)
    assert.deepEqual(ok, { grp1: "Sales" })
  })
})

// ---------------------------------------------------------------------------
// Groups admin adapter (kernel slice 2026-09: members endpoint included)
// ---------------------------------------------------------------------------

const groupRow = (over: Record<string, unknown> = {}) => ({
  id: "grp1",
  cube: "crm/organizations",
  name: "Sales",
  createdBy: "admin",
  createdAt: "2026-09-06T00:00:00Z",
  ...over,
})

const memberRow = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  groupId: "grp1",
  userId: "u1",
  createdBy: "admin",
  createdAt: "2026-09-06T00:00:00Z",
  ...over,
})

describe("groups admin paths", () => {
  it("members path encodes the group id as ONE segment, page window explicit", () => {
    const path = groupMembersPath("grp/1", 60, 50)
    const [base, query] = path!.split("?")
    assert.equal(base, "/api/qwbe/permissions/groups/grp%2F1/members")
    assert.deepEqual(new URLSearchParams(query), new URLSearchParams("offset=60&limit=50"))
  })

  it("refuses empty group ids and non-integer page windows", () => {
    assert.equal(groupMembersPath("", 0, 50), null)
    assert.equal(groupMembersPath("  ", 0, 50), null)
    assert.equal(groupMembersPath("grp1", -1, 50), null)
    assert.equal(groupMembersPath("grp1", 0, 0), null)
    assert.equal(groupMembersPath("grp1", 1.5, 50), null)
    assert.equal(groupRenamePath(""), null)
    assert.equal(groupMembersAddPath(""), null)
    assert.equal(groupMembersRemovePath(""), null)
  })

  it("create, rename, add and remove paths", () => {
    assert.equal(groupCreatePath(), "/api/qwbe/permissions/groups")
    assert.equal(groupRenamePath("gr/1"), "/api/qwbe/permissions/groups/gr%2F1")
    assert.equal(groupMembersAddPath("gr/1"), "/api/qwbe/permissions/groups/gr%2F1/members")
    assert.equal(
      groupMembersRemovePath("gr/1"),
      "/api/qwbe/permissions/groups/gr%2F1/members/remove",
    )
  })
})

describe("groups admin calls", () => {
  it("fetchGroups returns the rows, and 403 as a distinguishable refusal", async () => {
    const ok = await fetchGroups("crm/organizations", fetchStub(() => ({
      status: 200,
      body: [groupRow()],
    })).doFetch)
    assert.deepEqual(ok, { ok: true, value: [groupRow()] })
    const denied = await fetchGroups("crm/organizations", fetchStub(() => ({
      status: 403,
      body: { message: "only owners and admins" },
    })).doFetch)
    assert.deepEqual(denied, { ok: false, status: 403, message: "only owners and admins" })
  })

  it("fetchGroups reports network failure as status 0, never as an empty list", async () => {
    const networkFetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch
    const result = await fetchGroups("crm/organizations", networkFetch)
    assert.deepEqual(result, { ok: false, status: 0, message: "network error" })
  })

  it("fetchGroups refuses an empty cube at the boundary", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: [] }))
    const result = await fetchGroups("  ", doFetch)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)
    assert.equal(calls.length, 0)
  })

  it("createGroup trims the name and sends cube + name explicitly", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: groupRow({ name: "Sales" }) }))
    const result = await createGroup({ cube: "crm/organizations", name: "  Sales  ", doFetch })
    assert.deepEqual(result, { ok: true, value: groupRow({ name: "Sales" }) })
    assert.equal(calls[0].url, "/api/qwbe/permissions/groups")
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      cube: "crm/organizations",
      name: "Sales",
    })
  })

  it("createGroup refuses an empty name without a request", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: groupRow() }))
    const result = await createGroup({ cube: "crm/organizations", name: "   ", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)
    assert.equal(calls.length, 0)
  })

  it("renameGroup PATCHes by encoded id with the trimmed name", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: groupRow({ name: "New" }) }))
    const result = await renameGroup({ groupId: "gr/1", name: " New ", doFetch })
    assert.deepEqual(result, { ok: true, value: groupRow({ name: "New" }) })
    assert.equal(calls[0].url, "/api/qwbe/permissions/groups/gr%2F1")
    assert.equal(calls[0].init?.method, "PATCH")
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: "New" })
  })

  it("fetchGroupMembersPage keeps the page explicit and total available", async () => {
    const { doFetch, calls } = fetchStub(() => ({
      status: 200,
      body: { rows: [memberRow()], total: 3, offset: 0, limit: 50 },
    }))
    const result = await fetchGroupMembersPage({ groupId: "grp1", offset: 0, limit: 50, doFetch })
    assert.deepEqual(result, {
      ok: true,
      value: { rows: [memberRow()], total: 3, offset: 0, limit: 50 },
    })
    assert.match(calls[0].url, /offset=0&limit=50$/)
  })

  it("fetchGroupMembersPage distinguishes 403 refusal, 404 unknown group, network gap", async () => {
    const forbidden = await fetchGroupMembersPage({
      groupId: "grp1",
      offset: 0,
      limit: 50,
      doFetch: fetchStub(() => ({ status: 403, body: { message: "not allowed" } })).doFetch,
    })
    assert.deepEqual(forbidden, { ok: false, status: 403, message: "not allowed" })
    const missing = await fetchGroupMembersPage({
      groupId: "grp1",
      offset: 0,
      limit: 50,
      doFetch: fetchStub(() => ({ status: 404, body: { message: "group not found" } })).doFetch,
    })
    assert.deepEqual(missing, { ok: false, status: 404, message: "group not found" })
    const network = await fetchGroupMembersPage({
      groupId: "grp1",
      offset: 0,
      limit: 50,
      doFetch: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
    })
    assert.deepEqual(network, { ok: false, status: 0, message: "network error" })
  })

  it("addGroupMember POSTs the trimmed username to the encoded members path", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: memberRow() }))
    const result = await addGroupMember({ groupId: "gr/1", username: " mihai ", doFetch })
    assert.deepEqual(result, { ok: true, value: memberRow() })
    assert.equal(calls[0].url, "/api/qwbe/permissions/groups/gr%2F1/members")
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { username: "mihai" })
  })

  it("addGroupMember sends '@maria' as maria -- the row the search matched (T-1450)", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: memberRow() }))
    const result = await addGroupMember({ groupId: "grp1", username: "@maria", doFetch })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { username: "maria" })
  })

  it("addGroupMember refuses a bare @ without a request: it names nobody", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: memberRow() }))
    const result = await addGroupMember({ groupId: "grp1", username: "@", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)
    assert.equal(calls.length, 0)
  })

  it("addGroupMember refuses an empty username without a request", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 200, body: memberRow() }))
    const result = await addGroupMember({ groupId: "grp1", username: "  ", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)
    assert.equal(calls.length, 0)
  })

  it("removeGroupMember POSTs to /members/remove and keeps qwbe's 404 message", async () => {
    const ok = await removeGroupMember({
      groupId: "grp1",
      username: "mihai",
      doFetch: fetchStub((_url, init) => {
        assert.equal(init?.method, "POST")
        assert.deepEqual(JSON.parse(String(init?.body)), { username: "mihai" })
        return { status: 200, body: { removed: "u1" } }
      }).doFetch,
    })
    assert.deepEqual(ok, { ok: true, value: { removed: "u1" } })
    const gone = await removeGroupMember({
      groupId: "grp1",
      username: "mihai",
      doFetch: fetchStub(() => ({ status: 404, body: { message: "membership does not exist" } })).doFetch,
    })
    assert.deepEqual(gone, { ok: false, status: 404, message: "membership does not exist" })
  })

  // Regression for the review's B2: the target of a remove is the clicked row's
  // account id, resolved fresh; a stale or foreign username is never sent.
  it("removeGroupMemberById resolves the id first and sends that username", async () => {
    const { doFetch, calls } = fetchStub((url, init) => {
      if (url.startsWith("/api/qwbe/account?ids=")) return { status: 200, body: { rows: [{ id: "u2", username: "ana" }] } }
      assert.equal(url, "/api/qwbe/permissions/groups/grp1/members/remove")
      assert.deepEqual(JSON.parse(String(init?.body)), { username: "ana" })
      return { status: 200, body: { removed: "u2" } }
    })
    const ok = await removeGroupMemberById({ groupId: "grp1", userId: "u2", doFetch })
    assert.deepEqual(ok, { ok: true, value: { removed: "u2", username: "ana" } })
    assert.equal(calls.length, 2)
  })

  it("removeGroupMemberById refuses without any remove request when the id does not resolve", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 503, body: {} }))
    const result = await removeGroupMemberById({ groupId: "grp1", userId: "u2", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 0)
    assert.equal(calls.length, 1)
    assert.ok(calls[0]?.url.startsWith("/api/qwbe/account?ids="))
  })

  it("removeGroupMemberById reports a removed id that is not the clicked one as a failure", async () => {
    const { doFetch } = fetchStub((url) =>
      url.startsWith("/api/qwbe/account?ids=")
        ? { status: 200, body: { rows: [{ id: "u2", username: "ana" }] } }
        : { status: 200, body: { removed: "u9" } },
    )
    const result = await removeGroupMemberById({ groupId: "grp1", userId: "u2", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /u9 instead of u2/)
  })
})

// ---------------------------------------------------------------------------
// Groups UI helpers: required total, visible failure, username-only removal
// ---------------------------------------------------------------------------

describe("groups members page view", () => {
  it("fetchGroupMembersPage fails visibly on a 200 without total (never an empty page)", async () => {
    const { doFetch } = fetchStub(() => ({ status: 200, body: { rows: [], offset: 0, limit: 50 } }))
    const result = await fetchGroupMembersPage({ groupId: "grp1", offset: 0, limit: 50, doFetch })
    assert.deepEqual(result, { ok: false, status: 200, message: "invalid members page response" })
  })

  it("fetchGroupMembersPage fails visibly on a non-JSON 200 body", async () => {
    const doFetch = (async () => new Response("<html>", { status: 200 })) as typeof fetch
    const result = await fetchGroupMembersPage({ groupId: "grp1", offset: 0, limit: 50, doFetch })
    assert.deepEqual(result, { ok: false, status: 200, message: "invalid members page response" })
  })

  it("parseMembersPage accepts only the schema shape", () => {
    assert.equal(parseMembersPage(null), null)
    assert.equal(parseMembersPage({ rows: "x", total: 0, offset: 0, limit: 1 }), null)
    assert.equal(parseMembersPage({ rows: [], total: -1, offset: 0, limit: 1 }), null)
    assert.equal(parseMembersPage({ rows: [{ id: "m1" }], total: 1, offset: 0, limit: 1 }), null)
    assert.deepEqual(parseMembersPage({ rows: [memberRow()], total: 1, offset: 0, limit: 50 }), {
      rows: [memberRow()],
      total: 1,
      offset: 0,
      limit: 50,
    })
  })

  it("membersHasMore counts from the explicit total, empty + total 0 is the only 'none'", () => {
    assert.equal(membersHasMore({ rows: [], total: 0, offset: 0, limit: 50 }), false)
    assert.equal(membersHasMore({ rows: [memberRow()], total: 1, offset: 0, limit: 50 }), false)
    assert.equal(membersHasMore({ rows: [memberRow()], total: 2, offset: 0, limit: 1 }), true)
    assert.equal(membersHasMore({ rows: [memberRow()], total: 2, offset: 1, limit: 1 }), false)
  })

  it("memberRowsOf keeps the opaque id and marks an unresolved username as null", () => {
    const rows = memberRowsOf([memberRow(), memberRow({ id: "m2", userId: "u2" })], {
      u1: { id: "u1", username: "mihai", displayName: "Mihai Ionescu" },
    })
    assert.deepEqual(rows, [
      { membershipId: "m1", userId: "u1", username: "mihai", displayName: "Mihai Ionescu" },
      { membershipId: "m2", userId: "u2", username: null, displayName: null },
    ])
  })

  it("memberLabelOf leads with the display name and keeps an honest fallback", () => {
    assert.deepEqual(
      memberLabelOf({ membershipId: "m1", userId: "u1", username: "mihai", displayName: "Mihai Ionescu" }),
      { primary: "Mihai Ionescu", secondary: "@mihai", unresolved: false, control: "@mihai" },
    )
    // An account with no display name is resolved, just unnamed.
    assert.deepEqual(memberLabelOf({ membershipId: "m2", userId: "u2", username: "ana", displayName: null }), {
      primary: "@ana",
      secondary: null,
      unresolved: false,
      control: "@ana",
    })
    // The directory did not return this account: raw id, said out loud.
    assert.deepEqual(memberLabelOf({ membershipId: "m3", userId: "u3", username: null, displayName: null }), {
      primary: "u3",
      secondary: null,
      unresolved: true,
      control: "u3",
    })
  })

  it("memberLabelOf names controls by the handle, so a rename cannot move them", () => {
    const before = memberLabelOf({ membershipId: "m1", userId: "u1", username: "mihai", displayName: "Mihai Ionescu" })
    const afterRename = memberLabelOf({ membershipId: "m1", userId: "u1", username: "mihai", displayName: "M. Ionescu" })
    assert.equal(before.control, afterRename.control, "the aria-label of Remove must not follow the display name")
    assert.equal(before.control, "@mihai")
    // The visible text is still allowed to follow the directory.
    assert.notEqual(before.primary, afterRename.primary)
  })

  it("memberMarks excludes only the rows it could resolve, and counts THOSE", () => {
    const rows = memberRowsOf([memberRow(), memberRow({ id: "m2", userId: "u2" })], {
      u1: { id: "u1", username: "mihai", displayName: null },
    })
    const marks = memberMarks(rows, 2, "Already in group")
    assert.deepEqual(marks.excluded, [{ username: "mihai", reason: "Already in group" }])
    // Two rows, one mark: counting rows would claim the unresolved member is
    // marked, and would hide the gap notice on a single-page group entirely --
    // the operator would read that unmarked existing member as "not a member
    // yet" and try to add them again.
    assert.equal(marks.marked, 1)
    assert.equal(marks.incomplete, true)
  })

  it("memberMarks reports complete coverage only when every member of the group is marked", () => {
    const resolved = memberRowsOf([memberRow()], { u1: { id: "u1", username: "mihai", displayName: null } })
    assert.deepEqual(memberMarks(resolved, 1, "Already in group"), {
      excluded: [{ username: "mihai", reason: "Already in group" }],
      marked: 1,
      incomplete: false,
    })
    // A member on another page is a gap just the same.
    assert.equal(memberMarks(resolved, 60, "Already in group").incomplete, true)
    // No page loaded yet: nothing marked, nothing claimed.
    assert.deepEqual(memberMarks([], 0, "Already in group"), { excluded: [], marked: 0, incomplete: false })
  })

  it("memberMarks carries the caller's reason unchanged", () => {
    // The shared picker never invents context copy: the wording is the panel's.
    const rows = memberRowsOf([memberRow()], { u1: { id: "u1", username: "mihai", displayName: null } })
    assert.deepEqual(memberMarks(rows, 1, "Already shared").excluded, [
      { username: "mihai", reason: "Already shared" },
    ])
  })
})

describe("account directory adapter", () => {
  it("searchAccounts keeps a refusal, a transport failure and a real empty apart", async () => {
    const refused = await searchAccounts({
      q: "mih",
      limit: 20,
      doFetch: fetchStub(() => ({ status: 403, body: { message: "account:read denied" } })).doFetch,
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.ok === false && refused.status, 403)

    const empty = await searchAccounts({
      q: "zzz",
      limit: 20,
      doFetch: fetchStub(() => ({ status: 200, body: { rows: [] } })).doFetch,
    })
    assert.deepEqual(empty, { ok: true, value: { rows: [], returned: 0 } })

    // A 200 whose body this adapter cannot read is a failure, not an empty
    // directory.
    const unreadable = await searchAccounts({
      q: "mih",
      limit: 20,
      doFetch: fetchStub(() => ({ status: 200, body: { rows: "nope" } })).doFetch,
    })
    assert.equal(unreadable.ok, false)
  })

  it("parseAccountPage counts what the BACKEND returned, not what survived the parse", () => {
    const page = parseAccountPage({
      rows: [
        { id: "u1", username: "mihai" },
        { id: "u2" },
        { username: "ana" },
        null,
      ],
    })
    assert.deepEqual(page.rows, [{ id: "u1", username: "mihai", displayName: null }])
    assert.equal(
      page.returned,
      4,
      "three rows were unreadable, but the page the backend sent was still four rows long",
    )
    assert.deepEqual(parseAccountPage({ rows: "nope" }), { rows: [], returned: 0 })
    assert.deepEqual(parseAccountPage(null), { rows: [], returned: 0 })
  })

  it("lookupAccounts returns username and displayName per id, absent for unknown ids", async () => {
    const { doFetch } = fetchStub(() => ({
      status: 200,
      body: { rows: [{ id: "u1", username: "mihai", displayName: "Mihai", email: "m@x" }, { id: "u2" }] },
    }))
    assert.deepEqual(await lookupAccounts(["u1", "u2"], doFetch), {
      u1: { id: "u1", username: "mihai", displayName: "Mihai" },
    })
    assert.deepEqual(await lookupAccounts([], doFetch), {})
  })
})

// ---------------------------------------------------------------------------
// Group names are unique PER CUBE and the database decides (qwbe
// core/src/cubes/permissions/groups.ts `permission_groups_cube_name_key`,
// groups-unique.test.ts, verified 2026-09-26). 409 is a normal answer for both
// writes, and the wording must describe the normalization that actually runs.
// ---------------------------------------------------------------------------

describe("duplicate group names", () => {
  it("createGroup reports a 409 as a refusal with the conflict status, never as a success", async () => {
    const { doFetch, calls } = fetchStub(() => ({ status: 409, body: { message: "duplicate key value" } }))
    const result = await createGroup({ cube: "crm/organizations", name: "Sales", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
    assert.equal(calls.length, 1)
  })

  it("renameGroup reports a 409 the same way, and the group keeps its old name", async () => {
    const { doFetch } = fetchStub(() => ({ status: 409, body: { message: "duplicate key value" } }))
    const result = await renameGroup({ groupId: "grp1", name: "Sales", doFetch })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
  })

  it("names the conflict by its STATUS, saying how the name is actually compared", () => {
    const conflict = groupWriteRefusalMessage(409, "duplicate key value violates unique constraint")
    assert.match(conflict, /already uses this name/i)
    assert.match(conflict, /case/i)
    assert.doesNotMatch(conflict, /duplicate key/i)
  })

  it("names a refusal, an empty name and a vanished group without inventing a diagnosis", () => {
    assert.match(groupWriteRefusalMessage(403, "forbidden"), /may not administer/i)
    assert.match(groupWriteRefusalMessage(400, "invalid"), /name is required/i)
    assert.match(groupWriteRefusalMessage(404, "gone"), /no longer exists/i)
    // A status with no meaning of its own keeps the server's own words.
    assert.equal(groupWriteRefusalMessage(0, "network error"), "network error")
    assert.equal(groupWriteRefusalMessage(503, "upstream down"), "upstream down")
  })
})

describe("a refused MEMBERSHIP write", () => {
  it("keeps the answer's own words for 404: the username, the group and the membership share that status", () => {
    // qwbe resolves the username first (core/src/cubes/permissions/
    // handler-utils.ts resolveIdentity), so this 404 is about the ACCOUNT and
    // must never be reported as a missing group.
    assert.equal(
      memberWriteRefusalMessage(404, "username ghost does not exist"),
      "username ghost does not exist",
    )
    assert.equal(memberWriteRefusalMessage(404, "membership does not exist"), "membership does not exist")
    assert.equal(memberWriteRefusalMessage(404, "group grp_9 does not exist"), "group grp_9 does not exist")
    for (const message of ["username ghost does not exist", "membership does not exist"]) {
      assert.doesNotMatch(memberWriteRefusalMessage(404, message), /This group no longer exists/i)
    }
  })

  it("keeps the adapter's own words for 400 instead of asking for a group name", () => {
    // Both 400s are this client's, produced before any request: sharing.ts
    // addGroupMember ("choose a user") and the unusable group id.
    assert.equal(memberWriteRefusalMessage(400, "choose a user"), "choose a user")
    assert.equal(memberWriteRefusalMessage(400, "invalid group id"), "invalid group id")
    assert.doesNotMatch(memberWriteRefusalMessage(400, "choose a user"), /name is required/i)
  })

  it("words only the one status whose meaning is fixed on these routes", () => {
    assert.match(memberWriteRefusalMessage(403, "forbidden"), /may not administer/i)
    assert.equal(memberWriteRefusalMessage(0, "network error"), "network error")
    assert.equal(memberWriteRefusalMessage(500, "boom"), "boom")
    // 409 is not produced here at all (addGroupMember is idempotent), so it
    // carries whatever arrived rather than the group-name conflict sentence.
    assert.equal(memberWriteRefusalMessage(409, "conflict"), "conflict")
    assert.doesNotMatch(memberWriteRefusalMessage(409, "conflict"), /already uses this name/i)
  })
})

describe("the selection after a group list was re-read", () => {
  it("keeps a group the fresh list still carries", () => {
    assert.equal(retainSelectedGroup([groupRow({ id: "g1" }), groupRow({ id: "g2" })], "g2"), "g2")
  })

  it("drops a group the fresh list no longer carries, so no request targets a stale list", () => {
    assert.equal(retainSelectedGroup([groupRow({ id: "g1" })], "g2"), "")
    assert.equal(retainSelectedGroup([], "g1"), "")
  })

  it("keeps an empty selection empty", () => {
    assert.equal(retainSelectedGroup([groupRow({ id: "g1" })], ""), "")
  })
})
