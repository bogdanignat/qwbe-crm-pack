// Unit tests for the palette's global search (T-1812): one `q` list request per
// module, the hits grouped per module with their detail links, and the demo
// organizations matched the way the list contract matches `q`.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { searchAll, searchModule, SEARCH_LIMIT, SEARCH_MODULES } from "./global-search.ts"
import type { CubeMetadata, Row } from "./cube.ts"

const metaOf = (cube: string, search: string[] = ["name"]): CubeMetadata => ({
  cube,
  entity: null,
  version: null,
  schemaHash: "h",
  list: { params: [], maxPageSize: 200, defaultPageSize: 25, search, filters: [], sort: [] },
  fields: [
    { name: "name", label: "Name", type: "string", required: true, editable: true, sortable: true, searchable: true, nullable: false, enum: null, relation: null, custom: false },
  ],
})

// A qwbe stub: metadata per cube, a page of rows per list prefix, every URL recorded.
function stub(metas: CubeMetadata[], rows: Record<string, Row[]>, status = 200, rawBody?: string) {
  const urls: string[] = []
  const signals: (AbortSignal | null | undefined)[] = []
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    const meta = metas.find((m) => url === `/api/qwbe/catalog/${encodeURIComponent(m.cube)}/metadata`)
    if (meta) return Response.json(meta)
    if (url.includes("/catalog/")) return new Response("unknown cube", { status: 404 })
    signals.push(init?.signal)
    if (status !== 200) return new Response("no", { status })
    if (rawBody !== undefined) return new Response(rawBody, { headers: { "content-type": "text/html" } })
    const prefix = url.split("?")[0].split("/").pop()!
    return Response.json({ rows: rows[prefix] ?? [], total: (rows[prefix] ?? []).length, offset: 0, limit: SEARCH_LIMIT })
  }) as typeof fetch
  return { doFetch, urls, signals }
}

describe("searchModule", () => {
  it("sends one q request capped at the palette limit and links every hit to its detail", async () => {
    const cube = "t1/organizations"
    const { doFetch, urls } = stub([metaOf(cube)], { organizations: [{ id: "o 1", name: "Acme SRL" }] })
    const group = await searchModule({ cube, label: "Organizations" }, " acme ", { doFetch })
    assert.equal(urls[1], `/api/qwbe/organizations?limit=${SEARCH_LIMIT}&q=acme`)
    assert.deepEqual(group, {
      label: "Organizations",
      hits: [{ id: "o 1", title: "Acme SRL", href: "/organizations/o 1", demo: false }],
      error: null,
    })
  })

  it("puts the matching demo rows first, marked demo, and leaves the others out", async () => {
    const cube = "t2/organizations"
    const demoRows = [
      { id: "org_mock_1", name: "Acme Demo" },
      { id: "org_mock_2", name: "Other Demo" },
    ]
    const { doFetch } = stub([metaOf(cube)], { organizations: [{ id: "o1", name: "Acme SRL" }] })
    const group = await searchModule({ cube, label: "Organizations", demoRows }, "acme", { doFetch })
    assert.deepEqual(
      group.hits.map((h) => [h.id, h.demo]),
      [["org_mock_1", true], ["o1", false]],
    )
  })

  it("finds the demo rows by CUI, email and phone too, which `q` does not scan", async () => {
    const cube = "t9/organizations"
    const demoRows = [{ id: "org_mock_1", name: "Acme Demo", cui: "99000001", email: "office@acme.test", phone: "0700 000 001" }]
    const { doFetch } = stub([metaOf(cube)], {})
    for (const q of ["9900", "office@", "0700000"]) {
      const group = await searchModule({ cube, label: "Organizations", demoRows }, q, { doFetch })
      assert.deepEqual(group.hits.map((h) => h.id), ["org_mock_1"], q)
    }
  })

  it("never lists rows when the module publishes no search fields", async () => {
    const cube = "t3/organizations"
    const { doFetch, urls } = stub([metaOf(cube, [])], { organizations: [{ id: "o1", name: "Acme" }] })
    const group = await searchModule({ cube, label: "Organizations" }, "a", { doFetch })
    assert.deepEqual(group, { label: "Organizations", hits: [], error: "This module is not searchable." })
    assert.equal(urls.length, 1)
  })

  it("says so when the metadata or the list request fails", async () => {
    const missing = await searchModule({ cube: "t4/organizations", label: "Organizations" }, "a", { doFetch: stub([], {}).doFetch })
    assert.equal(missing.error, "Search unavailable.")
    const cube = "t5/organizations"
    const refused = await searchModule({ cube, label: "Organizations" }, "a", { doFetch: stub([metaOf(cube)], {}, 500).doFetch })
    assert.deepEqual(refused, { label: "Organizations", hits: [], error: "Search failed." })
  })
  it("answers Search failed, never rejects, on a list body that is not JSON", async () => {
    const cube = "t6/organizations"
    const group = await searchModule({ cube, label: "Organizations" }, "a", { doFetch: stub([metaOf(cube)], {}, 200, "<html>proxy error</html>").doFetch })
    assert.deepEqual(group, { label: "Organizations", hits: [], error: "Search failed." })
  })

  it("hands the caller's signal to the list request, and an aborted request is a failed group", async () => {
    const cube = "t7/organizations"
    const { doFetch, signals } = stub([metaOf(cube)], { organizations: [] })
    const controller = new AbortController()
    await searchModule({ cube, label: "Organizations" }, "a", { doFetch, signal: controller.signal })
    assert.equal(signals[0], controller.signal)
    controller.abort()
    // fetch's own behaviour on an aborted signal: it rejects with an AbortError.
    const aborting = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
      return Response.json(metaOf(cube))
    }) as typeof fetch
    const group = await searchModule({ cube, label: "Organizations" }, "a", { doFetch: aborting, signal: controller.signal })
    assert.equal(group.error, "Search failed.")
  })
})

describe("searchAll", () => {
  it("answers one group per menu module, in menu order", async () => {
    const metas = SEARCH_MODULES.map((m) => metaOf(m.cube))
    const { doFetch } = stub(metas, { contacts: [{ id: "c1", name: "Dan Popescu" }] })
    const groups = await searchAll("dan", { doFetch })
    assert.deepEqual(
      groups.map((g) => [g.label, g.hits.map((h) => h.href)]),
      [["Organizations", []], ["Contacts", ["/contacts/c1"]]],
    )
  })
})
