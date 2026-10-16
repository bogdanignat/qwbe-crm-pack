// Unit tests for the views adapter (QWB-62 stage F1).
//
// Pure derivation plus injected-fetch calls only: no DOM, no backend, no live
// server -- the same boundary as the sharing and cube suites. The contract
// under test is the kernel views cube as read on 2026-09-06
// (core/src/cubes/views/index.ts and view-config.ts).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CubeMetadata, FieldMetadata, ListContractMetadata } from "./cube.ts"
import {
  PAGE_SIZES,
  VIEW_ACTIONS,
  VIEW_ENTITY_TYPE,
  VIEWS_CUBE,
  applyView,
  configFromState,
  fetchView,
  fetchViewAccess,
  viewAccessPath,
  viewRights,
  createView,
  deleteView,
  listViews,
  parseViewConfig,
  updateView,
  viewPath,
  viewsListPath,
  type SavedViewRow,
} from "./views.ts"

const field = (name: string, over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name,
  label: name,
  type: "string",
  required: false,
  editable: true,
  sortable: true,
  searchable: true,
  nullable: false,
  enum: null,
  relation: null,
  custom: false,
  ...over,
})

const list: ListContractMetadata = {
  params: ["offset", "limit", "sortBy", "descending", "q", "ids", "stage"],
  maxPageSize: 200,
  defaultPageSize: 50,
  search: ["name", "email"],
  filters: ["stage", "organizationId"],
  sort: ["name", "createdAt", "stage"],
}

const meta = (): CubeMetadata => ({
  cube: "crm/deals",
  entity: "Deal",
  version: "1.0.0",
  schemaHash: "h",
  list,
  fields: [
    field("name", { required: true }),
    field("stage", { enum: ["open", "won"] }),
    field("email"),
    field("organizationId", { relation: { target: "crm/organizations", entity: "Organization", summary: "name" } }),
    field("ghost", { editable: false }),
  ],
})

const controls = { search: true, filters: [field("stage"), field("organizationId")] }

const row = (over: Partial<SavedViewRow> = {}): SavedViewRow => ({
  id: "v1",
  targetCube: "crm/deals",
  name: "Open deals",
  config: "{}",
  createdAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:00:00Z",
  updatedBy: "u1",
  ...over,
})

// A fetch double that records its last call and answers 200 with `body`.
type FetchDouble = typeof fetch & {
  calledWith: null | { method: string; path: string; body: unknown }
}
const okFetch = (body: unknown): FetchDouble => {
  const fn: FetchDouble = async (_input: RequestInfo | URL, init?: RequestInit) => {
    fn.calledWith = {
      method: init?.method ?? "GET",
      path: String(_input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  fn.calledWith = null
  return fn
}

describe("paths", () => {
  it("lists views of one target cube through the proxy", () => {
    assert.equal(viewsListPath("crm/deals"), "/api/qwbe/views?targetCube=crm%2Fdeals&limit=200")
  })

  it("encodes a view id as one segment and refuses ids that cannot name one", () => {
    assert.equal(viewPath("v1"), "/api/qwbe/views/v1")
    assert.equal(viewPath("a/b"), "/api/qwbe/views/a%2Fb")
    assert.equal(viewPath(""), null)
    assert.equal(viewPath(".."), null)
  })
})

describe("parseViewConfig", () => {
  it("decodes a stored config document", () => {
    assert.deepEqual(
      parseViewConfig(
        row({ config: JSON.stringify({ columns: ["name"], filters: { stage: "open" }, q: "ab", sortBy: "name", descending: true, pageSize: 50 }) }),
      ),
      { columns: ["name"], filters: { stage: "open" }, q: "ab", sortBy: "name", descending: true, pageSize: 50 },
    )
  })

  it("returns null for corrupt JSON, non-object or wrong-typed entries", () => {
    assert.equal(parseViewConfig(row({ config: "not json" })), null)
    assert.equal(parseViewConfig(row({ config: "[1]" })), null)
    assert.equal(parseViewConfig(row({ config: JSON.stringify({ columns: [1] }) })), null)
    assert.equal(parseViewConfig(row({ config: JSON.stringify({ filters: { a: 3 } }) })), null)
    assert.equal(parseViewConfig(row({ config: JSON.stringify({ pageSize: "50" }) })), null)
  })
})

describe("CRUD calls", () => {
  it("createView POSTs targetCube, name and config under the proxy", async () => {
    const doFetch = okFetch(row())
    const result = await createView({ targetCube: "crm/deals", name: "Mine", config: { pageSize: 50 }, doFetch })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(doFetch.calledWith?.method, "POST")
    assert.equal(doFetch.calledWith?.path, "/api/qwbe/views")
    assert.deepEqual(doFetch.calledWith?.body, { targetCube: "crm/deals", name: "Mine", config: { pageSize: 50 } })
  })

  it("createView refuses an empty name or targetCube locally", async () => {
    const refused = await createView({ targetCube: "crm/deals", name: "  ", config: {}, doFetch: okFetch(row()) })
    assert.equal(refused.ok, false)
    if (refused.ok || refused.status !== 400) return
    assert.match(refused.message, /name/)
    const noCube = await createView({ targetCube: "  ", name: "x", config: {}, doFetch: okFetch(row()) })
    assert.equal(noCube.ok, false)
  })

  it("updateView PATCHes name/config only -- targetCube is never sent (immutable)", async () => {
    const doFetch = okFetch(row())
    const result = await updateView("v1", { name: "New", config: { q: "a" } }, doFetch)
    assert.ok(result.ok)
    assert.equal(doFetch.calledWith?.method, "PATCH")
    assert.equal(doFetch.calledWith?.path, "/api/qwbe/views/v1")
    assert.deepEqual(doFetch.calledWith?.body, { name: "New", config: { q: "a" } })
  })

  it("deleteView DELETEs the row path", async () => {
    const doFetch = okFetch(row())
    const result = await deleteView("v1", doFetch)
    assert.ok(result.ok)
    assert.equal(doFetch.calledWith?.method, "DELETE")
    assert.equal(doFetch.calledWith?.path, "/api/qwbe/views/v1")
  })

  it("listViews asks for one targetCube page", async () => {
    const doFetch = okFetch({ rows: [row()], total: 1, offset: 0, limit: 200 })
    const result = await listViews("crm/deals", doFetch)
    assert.ok(result.ok)
    assert.equal(doFetch.calledWith?.path, "/api/qwbe/views?targetCube=crm%2Fdeals&limit=200")
  })

  it("a failed call keeps qwbe's own message; status 0 = network", async () => {
    const failing: typeof fetch = async () => new Response(JSON.stringify({ message: "view refused" }), { status: 403 })
    const refused = await deleteView("v1", failing)
    assert.equal(refused.ok, false)
    if (refused.ok) return
    assert.equal(refused.status, 403)
    assert.equal(refused.message, "view refused")
    const net: typeof fetch = async () => {
      throw new Error("down")
    }
    const down = await listViews("crm/deals", net)
    assert.equal(down.ok, false)
    if (down.ok) return
    assert.equal(down.status, 0)
  })
})

describe("sharing constants", () => {
  it("exposes the views-cube constants the SharingPanel mount needs", () => {
    assert.equal(VIEWS_CUBE, "views")
    assert.equal(VIEW_ENTITY_TYPE, "SavedView")
    // The custom checkbox set: read and edit only, never delete/transfer, and
    // not `share` (inert on a grant).
    assert.deepEqual([...VIEW_ACTIONS], ["read", "edit"])
  })
})

describe("applyView", () => {
  it("keeps known columns in view order and warns on unknown ones", () => {
    const applied = applyView({ columns: ["stage", "deletedField", "stage", "email"] }, meta(), controls)
    assert.ok(applied.columns)
    // "name" is the title column: retained in front even though the view omitted it.
    assert.equal(applied.columns.join(","), "name,stage,email")
    assert.deepEqual(applied.warnings, ['column "deletedField" no longer exists in this list'])
    assert.equal(applied.params.q, undefined)
    assert.deepEqual(applied.params.filters, {})
  })

  it("always retains the title column so a row keeps its navigation", () => {
    const applied = applyView({ columns: ["stage"] }, meta(), controls)
    assert.equal(applied.columns?.[0], "name")
  })

  it("drops unknown filters with a warning, keeps known ones", () => {
    const applied = applyView({ filters: { stage: "open", nope: "x" } }, meta(), controls)
    assert.deepEqual(applied.params.filters, { stage: "open" })
    assert.deepEqual(applied.warnings, ['filter "nope" is not available in this list'])
  })

  it("PINNED FILTERS ALWAYS WIN: a view can neither override, nor unpin, nor hide a pinned filter", () => {
    const fixed = { organizationId: "org9" }
    const own = { search: true, filters: controls.filters.filter((f) => f.name !== "organizationId") }
    const applied = applyView(
      { filters: { organizationId: "other", stage: "open" } },
      meta(),
      own,
      fixed,
    )
    assert.deepEqual(applied.params.filters, { stage: "open", organizationId: "org9" })
    assert.equal(applied.warnings.includes('filter "organizationId" is not available in this list'), false)
    // Not even a column named like the pinned field is hidden: columns are a
    // display concern; the pinned VALUE travels regardless.
    const cols = applyView({ columns: ["organizationId"] }, meta(), own, fixed)
    assert.deepEqual(cols.params.filters, { organizationId: "org9" })
  })

  it("keeps q only when the cube publishes a search scan", () => {
    assert.equal(applyView({ q: "ab" }, meta(), controls).params.q, "ab")
    const noSearch = applyView({ q: "ab" }, meta(), { search: false, filters: controls.filters })
    assert.equal(noSearch.params.q, undefined)
    assert.deepEqual(noSearch.warnings, ['this list has no search, the view text "q" was dropped'])
    assert.equal(applyView({ q: "" }, meta(), controls).params.q, undefined)
  })

  it("keeps sortBy only inside the published sort list, descending with it", () => {
    const good = applyView({ sortBy: "stage", descending: true }, meta(), controls)
    assert.equal(good.params.sortBy, "stage")
    assert.equal(good.params.descending, true)
    const bad = applyView({ sortBy: "email", descending: true }, meta(), controls)
    assert.equal(bad.params.sortBy, undefined)
    assert.equal(bad.params.descending, undefined)
    assert.deepEqual(bad.warnings, ['sort by "email" is not available in this list'])
  })

  it("snaps pageSize to the nearest offered size and clamps to the published cap", () => {
    assert.equal(applyView({ pageSize: 30 }, meta(), controls).pageSize, 25)
    assert.equal(applyView({ pageSize: 90 }, meta(), controls).pageSize, 100)
    assert.equal(applyView({ pageSize: 200 }, { ...meta(), list: { ...list, maxPageSize: 100 } }, controls).pageSize, 100)
    // No stored pageSize -> the cube's default, never an undefined select.
    assert.equal(applyView({}, meta(), controls).pageSize, 50)
    assert.equal(applyView({ pageSize: 999 }, { ...meta(), list: null }, controls).pageSize, 100)
  })

  it("reports a page-size adjustment instead of being silent", () => {
    const applied = applyView({ pageSize: 30 }, meta(), controls)
    assert.deepEqual(applied.warnings, ["page size 30 was adjusted to 25"])
    const capped = applyView({ pageSize: 200 }, { ...meta(), list: { ...list, maxPageSize: 100 } }, controls)
    assert.equal(capped.warnings.includes("page size 200 was adjusted to 100"), true)
  })

  it("resets paging to the first page on apply", () => {
    assert.equal(applyView({}, meta(), controls).params.offset, 0)
  })

  it("with no column list, columns stay null (caller keeps its default set)", () => {
    assert.equal(applyView({}, meta(), controls).columns, null)
  })

  it("a target cube with no published list contract drops q and sort, caps pageSize safely", () => {
    const bare: CubeMetadata = { ...meta(), list: null }
    const noSearch = { search: false, filters: controls.filters }
    const applied = applyView({ q: "ab", sortBy: "name", pageSize: 999 }, bare, noSearch)
    assert.equal(applied.params.q, undefined)
    assert.equal(applied.params.sortBy, undefined)
    assert.equal(applied.warnings.length, 3)
    void PAGE_SIZES
  })

  it("does not mutate the config it was given", () => {
    const config = { filters: { stage: "open" }, columns: ["name"] }
    applyView(config, meta(), controls)
    assert.deepEqual(config, { filters: { stage: "open" }, columns: ["name"] })
  })
})

// ---------------------------------------------------------------------------
// UI stage (F2/F3): access, rights and the config a list state describes
// ---------------------------------------------------------------------------

describe("view access and rights", () => {
  it("asks the permissions cube for the caller's visibility of the views cube", () => {
    assert.equal(viewAccessPath(), "/api/qwbe/permissions/entities/views?limit=200&offset=0")
    assert.equal(viewAccessPath(200), "/api/qwbe/permissions/entities/views?limit=200&offset=200")
  })

  it("keys access by view id and walks every page", async () => {
    const pages = [
      { rows: [{ entityId: "v1", access: { source: "owner", actions: ["read", "edit", "delete"] } }], total: 2 },
      { rows: [{ entityId: "v2", access: { source: "user-grant", actions: ["read"] } }], total: 2 },
    ]
    const asked: string[] = []
    const doFetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return new Response(JSON.stringify(pages[asked.length - 1]), { status: 200 })
    }) as typeof fetch
    // The kernel reports 200 rows per page at most; a single-row page here
    // is walked by offset = rows seen so far.
    const result = await fetchViewAccess(doFetch)
    assert.ok(result.ok)
    assert.deepEqual(Object.keys(result.value), ["v1", "v2"])
    assert.equal(result.value.v2.source, "user-grant")
    assert.equal(asked.length, 2)
  })

  it("reports a refusal or failure as such, granting nothing", async () => {
    const refused = await fetchViewAccess(
      (async () => new Response(JSON.stringify({ message: "forbidden" }), { status: 403 })) as typeof fetch,
    )
    assert.ok(!refused.ok && refused.status === 403 && refused.message === "forbidden")
    const down = await fetchViewAccess((async () => {
      throw new Error("down")
    }) as typeof fetch)
    assert.ok(!down.ok && down.status === 0)
    // The picker maps a failed lookup to an empty access map: no right at all.
    assert.deepEqual(viewRights(undefined), { edit: false, delete: false, share: false })
  })

  it("derives edit/delete from the actions and share from the source only", () => {
    // A read grantee: apply only.
    assert.deepEqual(viewRights({ source: "user-grant", actions: ["read"] }), { edit: false, delete: false, share: false })
    // A co-editor: edit, but a grantee never re-shares, whatever the actions.
    assert.deepEqual(viewRights({ source: "group-grant", actions: ["read", "edit", "delete", "share"] }), {
      edit: true,
      delete: true,
      share: false,
    })
    for (const source of ["owner", "cube-admin", "superadmin", "creator"]) {
      assert.deepEqual(viewRights({ source, actions: ["read", "edit", "delete"] }), { edit: true, delete: true, share: true })
    }
    // No access record (route grant alone, or the lookup refused) = no right.
    assert.deepEqual(viewRights(undefined), { edit: false, delete: false, share: false })
  })

  it("fetchView reads the latest row and reports a refusal without throwing", async () => {
    const latest = row({ name: "renamed" })
    const ok = await fetchView("v1", okFetch(latest))
    assert.ok(ok.ok && ok.value.name === "renamed")
    const gone = await fetchView("v1", (async () => new Response(JSON.stringify({ message: "forbidden" }), { status: 403 })) as typeof fetch)
    assert.ok(!gone.ok && gone.status === 403)
  })
})

describe("configFromState", () => {
  it("stores columns, non-empty filters, q, sort and page size", () => {
    assert.deepEqual(
      configFromState({
        columns: ["name", "stage"],
        filters: { stage: "open", owner: "" },
        q: "ac",
        sortBy: "name",
        descending: true,
        pageSize: 50,
      }),
      { columns: ["name", "stage"], filters: { stage: "open" }, pageSize: 50, q: "ac", sortBy: "name", descending: true },
    )
  })

  it("never stores a pinned filter, an empty q or a missing sort", () => {
    assert.deepEqual(
      configFromState(
        { columns: ["name"], filters: { organizationId: "o1", stage: "open" }, q: "  ", descending: false, pageSize: 25 },
        { organizationId: "o1" },
      ),
      { columns: ["name"], filters: { stage: "open" }, pageSize: 25 },
    )
  })
})
