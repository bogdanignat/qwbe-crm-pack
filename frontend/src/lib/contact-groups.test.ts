// Unit tests for the contact-groups adapter (T-1451).
//
// The properties under test are the contract's own promises, asserted without
// a DOM and without a backend:
//   - every path this feature can produce addresses /api/qwbe/contact-groups
//     and NOTHING else (no account directory, no permissions cube);
//   - a blank name never leaves the browser, and a duplicate name is WARNED
//     about but still submitted, because the server is the arbiter (409);
//   - add/remove post the contact id in the BODY, at the two shapes the cube
//     publishes;
//   - 400/403/404/409 each map to their own answer.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  addGroupMember,
  addMemberPath,
  contactGroupPath,
  contactGroupsPath,
  createContactGroup,
  duplicateNameWarning,
  fetchContactGroups,
  fetchGroupMembers,
  groupMembersPath,
  groupSegment,
  clampedPage,
  isBlankName,
  isGenuinelyEmpty,
  membershipRefusalMessage,
  normalizedGroupName,
  pageViewOf,
  removeGroupMember,
  removeMemberPath,
  renameContactGroup,
  writeRefusalMessage,
  type ContactGroup,
  type ContactGroupMember,
  type ContactGroupPage,
} from "./contact-groups.ts"

type Call = { url: string; method: string; body: unknown }

// A fetch stub that records every call. Anything this feature sends has to
// pass through here, so the suite can assert on the WHOLE traffic, not only
// on the response handling.
function stubFetch(
  reply: (call: Call) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const answer = await reply(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { fetch: fake, calls }
}

const group = (over: Partial<ContactGroup> = {}): ContactGroup => ({
  id: "cgrp-1",
  type: "ContactGroup",
  createdAt: "2026-09-01T10:00:00.000Z",
  deleted: false,
  name: "Key accounts",
  normalizedName: "key accounts",
  ...over,
})

const member = (over: Partial<ContactGroupMember> = {}): ContactGroupMember => ({
  id: "cgm-1",
  type: "ContactGroupMember",
  createdAt: "2026-09-01T10:00:00.000Z",
  deleted: false,
  groupId: "cgrp-1",
  contactId: "cont-1a2b3c",
  ...over,
})

const page = <T>(rows: T[], over: Partial<ContactGroupPage<T>> = {}): ContactGroupPage<T> => ({
  rows,
  total: rows.length,
  offset: 0,
  limit: 25,
  ...over,
})

describe("paths", () => {
  it("addresses only the contact-groups cube through the proxy", () => {
    const paths = [
      contactGroupsPath(),
      contactGroupsPath({ page: 2, pageSize: 25, q: "key", sort: "name" }),
      contactGroupPath("cgrp-1"),
      groupMembersPath("cgrp-1", 1, 25),
      addMemberPath("cgrp-1"),
      removeMemberPath("cgrp-1"),
    ]
    for (const path of paths) {
      assert.ok(path !== null)
      assert.ok(path.startsWith("/api/qwbe/contact-groups"), path)
      // The account directory and the kernel's permission groups are a
      // different feature entirely; this one must never reach for them.
      assert.ok(!path.includes("/account"), path)
      assert.ok(!path.includes("/permissions"), path)
    }
  })

  it("sends page, pageSize, a trimmed q and the sort the cube declares", () => {
    assert.equal(
      contactGroupsPath({ page: 3, pageSize: 25, q: "  key  ", sort: "name:desc" }),
      "/api/qwbe/contact-groups?page=3&pageSize=25&q=key&sort=name%3Adesc",
    )
  })

  it("omits an empty search instead of sending q=", () => {
    assert.equal(contactGroupsPath({ page: 1, q: "   " }), "/api/qwbe/contact-groups?page=1")
  })

  it("refuses an id that cannot name a group, and percent-encodes one that can", () => {
    assert.equal(groupSegment(""), null)
    assert.equal(groupSegment("  "), null)
    assert.equal(groupSegment("."), null)
    assert.equal(groupSegment(".."), null)
    assert.equal(groupSegment("a/b"), "a%2Fb")
    assert.equal(contactGroupPath(".."), null)
    assert.equal(addMemberPath(""), null)
  })

  it("refuses a page or page size that is not a whole positive number", () => {
    assert.equal(groupMembersPath("cgrp-1", 0, 25), null)
    assert.equal(groupMembersPath("cgrp-1", 1.5, 25), null)
    assert.equal(groupMembersPath("cgrp-1", 1, 0), null)
    assert.equal(groupMembersPath("cgrp-1", 2, 25), "/api/qwbe/contact-groups/cgrp-1/members?page=2&pageSize=25")
  })

  it("removes a member by POSTing to /members/remove, never DELETE with two path params", () => {
    assert.equal(removeMemberPath("cgrp-1"), "/api/qwbe/contact-groups/cgrp-1/members/remove")
  })
})

describe("names", () => {
  it("treats only blank and whitespace-only as blank", () => {
    assert.equal(isBlankName(""), true)
    assert.equal(isBlankName("   "), true)
    assert.equal(isBlankName("\t\n"), true)
    assert.equal(isBlankName(" A "), false)
  })

  it("normalizes the way the cube does: lower(btrim(name))", () => {
    assert.equal(normalizedGroupName("  Key Accounts  "), "key accounts")
    assert.equal(normalizedGroupName("KEY ACCOUNTS"), "key accounts")
  })

  it("warns about a name another group already holds, ignoring case and spacing", () => {
    const known = [group({ id: "cgrp-1", name: "Key accounts" })]
    assert.match(duplicateNameWarning("  KEY ACCOUNTS ", known) ?? "", /already uses this name/)
    assert.equal(duplicateNameWarning("Other", known), null)
    assert.equal(duplicateNameWarning("   ", known), null)
  })

  it("does not warn about re-spelling a group's OWN name (Ada -> ADA is a 200)", () => {
    const known = [group({ id: "cgrp-1", name: "Ada" })]
    assert.equal(duplicateNameWarning("ADA", known, "cgrp-1"), null)
    assert.equal(duplicateNameWarning(" Ada ", known, "cgrp-1"), null)
  })

  it("answers by STATUS, since the kernel's message text is not a contract", () => {
    assert.match(writeRefusalMessage(400, "whatever"), /name is required/i)
    assert.match(writeRefusalMessage(403, "whatever"), /permissions needed to change contact groups/i)
    assert.match(writeRefusalMessage(404, "whatever"), /no longer exists/i)
    assert.match(writeRefusalMessage(409, "whatever"), /already uses this name/i)
    assert.equal(writeRefusalMessage(500, "boom"), "boom")
  })
})

describe("create and rename", () => {
  it("posts the name EXACTLY as typed -- casing and spacing are the operator's", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: group({ name: "  Key Accounts  " }) }))
    const result = await createContactGroup("  Key Accounts  ", fetch)
    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, "POST")
    assert.equal(calls[0].url, "/api/qwbe/contact-groups")
    assert.deepEqual(calls[0].body, { name: "  Key Accounts  " })
  })

  it("never sends the derived normalizedName", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: group() }))
    await createContactGroup("Key accounts", fetch)
    assert.deepEqual(Object.keys(calls[0].body as object), ["name"])
  })

  it("reports a 409 on create as a refusal with its status, not as a success", async () => {
    const { fetch } = stubFetch(() => ({ status: 409, body: { message: "duplicate" } }))
    const result = await createContactGroup("Key accounts", fetch)
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.status, 409)
    assert.match(writeRefusalMessage(409, result.ok === false ? result.message : ""), /already uses this name/i)
  })

  it("renames with PATCH on the group's own path", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: group({ name: "Key accounts EMEA" }) }))
    const result = await renameContactGroup("cgrp-1", "Key accounts EMEA", fetch)
    assert.equal(result.ok, true)
    assert.equal(calls[0].method, "PATCH")
    assert.equal(calls[0].url, "/api/qwbe/contact-groups/cgrp-1")
    assert.deepEqual(calls[0].body, { name: "Key accounts EMEA" })
  })

  it("reports a 409 on rename", async () => {
    const { fetch } = stubFetch(() => ({ status: 409, body: { message: "duplicate" } }))
    const result = await renameContactGroup("cgrp-1", "Taken", fetch)
    assert.equal(result.ok === false && result.status, 409)
  })

  it("reports a 403 on rename as a refusal, distinct from a 409", async () => {
    const { fetch } = stubFetch(() => ({ status: 403, body: { message: "forbidden" } }))
    const result = await renameContactGroup("cgrp-1", "Anything", fetch)
    assert.equal(result.ok === false && result.status, 403)
    assert.match(writeRefusalMessage(403, ""), /permissions needed to change contact groups/i)
  })

  it("sends NO request for an id that cannot name a group, and answers 404", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: group() }))
    const result = await renameContactGroup("", "Anything", fetch)
    assert.equal(calls.length, 0)
    assert.equal(result.ok === false && result.status, 404)
  })
})

describe("membership", () => {
  it("adds by posting the contact id in the BODY", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: member() }))
    const result = await addGroupMember("cgrp-1", "cont-1a2b3c", fetch)
    assert.equal(result.ok, true)
    assert.equal(calls[0].method, "POST")
    assert.equal(calls[0].url, "/api/qwbe/contact-groups/cgrp-1/members")
    assert.deepEqual(calls[0].body, { contactId: "cont-1a2b3c" })
  })

  it("treats an idempotent add (the EXISTING row, 200) as success, never a 409", async () => {
    const existing = member({ id: "cgm-existing" })
    const { fetch } = stubFetch(() => ({ status: 200, body: existing }))
    const result = await addGroupMember("cgrp-1", "cont-1a2b3c", fetch)
    assert.equal(result.ok, true)
    assert.equal(result.ok === true && result.value.id, "cgm-existing")
  })

  it("reports a 404 add (unknown group) without inventing a membership", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { message: "not found" } }))
    const result = await addGroupMember("cgrp-gone", "cont-1a2b3c", fetch)
    assert.equal(result.ok === false && result.status, 404)
  })

  it("reports a 403 add (missing contact-groups:write or contacts:read)", async () => {
    const { fetch } = stubFetch(() => ({ status: 403, body: { message: "forbidden" } }))
    const result = await addGroupMember("cgrp-1", "cont-1a2b3c", fetch)
    assert.equal(result.ok === false && result.status, 403)
  })

  it("removes by posting the contact id to /members/remove", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: { removed: "cgm-1" } }))
    const result = await removeGroupMember("cgrp-1", "cont-1a2b3c", fetch)
    assert.equal(result.ok === true && result.value.removed, "cgm-1")
    assert.equal(calls[0].method, "POST")
    assert.equal(calls[0].url, "/api/qwbe/contact-groups/cgrp-1/members/remove")
    assert.deepEqual(calls[0].body, { contactId: "cont-1a2b3c" })
  })

  it("reports a 404 remove (not an active member of THIS group)", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { message: "not a member" } }))
    const result = await removeGroupMember("cgrp-1", "cont-unknown", fetch)
    assert.equal(result.ok === false && result.status, 404)
  })

  it("lists members with page and pageSize, one request per page", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200, body: page([member()]) }))
    const result = await fetchGroupMembers("cgrp-1", 2, 25, fetch)
    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "/api/qwbe/contact-groups/cgrp-1/members?page=2&pageSize=25")
  })

  it("reports a members 403 (contact read permission missing) separately from the group's 200", async () => {
    const { fetch } = stubFetch(() => ({ status: 403, body: { message: "forbidden" } }))
    const result = await fetchGroupMembers("cgrp-1", 1, 25, fetch)
    assert.equal(result.ok === false && result.status, 403)
  })
})

describe("list and paging", () => {
  it("reports a 403 list as denied, with no rows", async () => {
    const { fetch } = stubFetch(() => ({ status: 403, body: { message: "forbidden" } }))
    const result = await fetchContactGroups({ page: 1 }, fetch)
    assert.equal(result.ok === false && result.status, 403)
  })

  it("turns a rejected request into a failure, never an empty list", async () => {
    const fake = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch
    const result = await fetchContactGroups({ page: 1 }, fake)
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.status, 0)
  })

  it("derives the window from the response, and offers Next only when there may be one", () => {
    const withTotal = pageViewOf(page([group(), group({ id: "cgrp-2" })], { total: 30, offset: 0, limit: 25 }), 25)
    assert.deepEqual(
      { from: withTotal.from, to: withTotal.to, hasNext: withTotal.hasNext, lastPage: withTotal.lastPage },
      { from: 1, to: 2, hasNext: true, lastPage: 2 },
    )

    // No total: a FULL page is the only evidence more may exist.
    const short = pageViewOf({ rows: [group()], offset: 0, limit: 25 }, 25)
    assert.equal(short.hasNext, false)
    const full = pageViewOf({ rows: Array.from({ length: 25 }, () => group()), offset: 25, limit: 25 }, 25)
    assert.equal(full.hasNext, true)
    assert.equal(full.hasPrevious, true)
  })

  it("reports an empty group page as empty, not as the end of a list that has rows", () => {
    const empty = pageViewOf(page<ContactGroup>([], { total: 0 }), 25)
    assert.deepEqual({ from: empty.from, to: empty.to, hasNext: empty.hasNext }, { from: 0, to: 0, hasNext: false })
  })
})

// The correction the reviewer's counterexample asks for: a page that the
// server no longer has must never be painted.
describe("standing past the end of a list", () => {
  it("corrects page 2 to page 1 when the last member of page 2 was removed (26 -> 25)", () => {
    // 26 members, the operator is on page 2 with its single row, Remove ->
    // the server now holds 25 and answers page 2 with no rows at all.
    const afterRemove = page<ContactGroupMember>([], { total: 25, offset: 25, limit: 25 })
    assert.equal(clampedPage(2, afterRemove, 25), 1)
    // And page 1 of that same list is a place that exists: it is not corrected.
    const firstPage = page(
      Array.from({ length: 25 }, (_, i) => member({ id: `cgm-${i}` })),
      { total: 25, offset: 0, limit: 25 },
    )
    assert.equal(clampedPage(1, firstPage, 25), 1)
  })

  it("never claims an empty GROUP about an empty PAGE past the end", () => {
    const afterRemove = page<ContactGroupMember>([], { total: 25, offset: 25, limit: 25 })
    assert.equal(isGenuinelyEmpty(afterRemove, 2), false)
    // Only the server's own zero is an empty group.
    assert.equal(isGenuinelyEmpty(page<ContactGroupMember>([], { total: 0, offset: 0 }), 1), true)
  })

  it("corrects a page number that never existed, from a link or the history", () => {
    const answer = page(
      Array.from({ length: 25 }, (_, i) => member({ id: `cgm-${i}` })),
      { total: 60, offset: 0, limit: 25 },
    )
    assert.equal(clampedPage(9, answer, 25), 3)
    assert.equal(clampedPage(3, answer, 25), 3)
    // total 0: the only page there is, is the first one.
    assert.equal(clampedPage(4, page<ContactGroupMember>([], { total: 0 }), 25), 1)
    // Nonsense in, the first page out -- never a request for page 0 or -1.
    assert.equal(clampedPage(0, answer, 25), 1)
    assert.equal(clampedPage(1.5, answer, 25), 1)
  })

  it("walks back ONE page when the cube omits the total, instead of guessing an end", () => {
    const noTotal: ContactGroupPage<ContactGroupMember> = { rows: [], offset: 75, limit: 25 }
    assert.equal(clampedPage(4, noTotal, 25), 3)
    // Page 1 with no rows and no total is the honest empty list.
    assert.equal(clampedPage(1, { rows: [], offset: 0, limit: 25 }, 25), 1)
    assert.equal(isGenuinelyEmpty({ rows: [], offset: 0, limit: 25 }, 1), true)
    assert.equal(isGenuinelyEmpty({ rows: [], offset: 75, limit: 25 }, 4), false)
  })

  it("leaves a page that has rows alone: it is being looked at", () => {
    const partial = page([member()], { total: 26, offset: 25, limit: 25 })
    assert.equal(clampedPage(2, partial, 25), 2)
    assert.equal(isGenuinelyEmpty(partial, 2), false)
  })
})

describe("a refused membership write", () => {
  it("names the missing CAPABILITY, not a role, and not a cause it cannot know", () => {
    // 403 on add has two possible causes (the group's write permission, or
    // crm/contacts:read) and this UI cannot tell them apart.
    const add403 = membershipRefusalMessage("add", 403, "Forbidden")
    assert.match(add403, /permissions needed to add contacts to this group/i)
    assert.ok(!/role|admin|reader/i.test(add403))
    assert.match(
      membershipRefusalMessage("remove", 403, "Forbidden"),
      /permissions needed to remove contacts from this group/i,
    )
  })

  it("keeps the two 404s apart: the group is gone (add) vs not a member (remove)", () => {
    assert.match(membershipRefusalMessage("add", 404, ""), /group no longer exists/i)
    assert.match(membershipRefusalMessage("remove", 404, ""), /no longer a member/i)
  })

  it("passes an unexpected status through with the server's own words", () => {
    assert.equal(membershipRefusalMessage("add", 500, "boom"), "boom")
  })
})
