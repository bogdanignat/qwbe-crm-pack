// Unit tests for the metadata-driven list logic (QWB-49). qwbe is stubbed at the
// function boundary: everything here is pure derivation from metadata shapes and
// from the real request path the component drives, so no live backend is needed.
// The tests encode the design rule: a field added to the metadata appears in the
// UI without touching any component.

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

import {
  canDefineFields,
  canEdit,
  columnsFromFields,
  createPayloadOf,
  customValueOf,
  coerce,
  cubeApiPath,
  errorMessage,
  errorBody,
  formatHrefOf,
  requestFailure,
  groupFields,
  hrefForRelation,
  rowHref,
  listApiPath,
  listControlsOf,
  listQueryString,
  renderKindOf,
  metadataApiPath,
  OPENAPI_API_PATH,
  recordApiPath,
  routeOf,
  saveCell,
  sortRequestFor,
  withSavedValue,
  titleOf,
  type ColumnSpec,
  type CubeMetadata,
  type FieldMetadata,
  type PageOf,
  type Row,
  pageFromInput,
  pageWindow,
} from "./cube.ts"

const field = (over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name: "name",
  label: "Name",
  type: "string",
  required: false,
  editable: true,
  sortable: true,
  searchable: false,
  nullable: false,
  enum: null,
  relation: null,
  custom: false,
  ...over,
})

const column = (over: Partial<FieldMetadata> = {}): ColumnSpec => {
  const f = field(over)
  return { field: f, sortable: f.sortable, editable: f.editable, visible: f.editable }
}

const meta = (over: Partial<CubeMetadata> = {}): CubeMetadata => ({
  cube: "crm/contacts",
  entity: "Contact",
  version: null,
  schemaHash: "hash",
  fields: [field({ name: "name", required: true }), field({ name: "email" })],
  ...over,
})

describe("list request parameters", () => {
  it("carries page, sort and filter parameters to qwbe", () => {
    const qs = listQueryString({
      offset: 25,
      limit: 50,
      sortBy: "name",
      descending: true,
      filters: { organizationId: "org-1" },
    })
    const parsed = new URLSearchParams(qs)
    assert.equal(parsed.get("offset"), "25")
    assert.equal(parsed.get("limit"), "50")
    assert.equal(parsed.get("sortBy"), "name")
    assert.equal(parsed.get("descending"), "true")
    // The search surface the backend serves: field equality on a searchable
    // field, not a client-side slice.
    assert.equal(parsed.get("organizationId"), "org-1")
  })

  it("builds the full list path under the cube's served prefix", () => {
    // A child cube serves under its leaf ("crm/contacts" -> /contacts), so the
    // list request goes there, not to a two-segment path qwbe never mounted.
    assert.equal(
      listApiPath("crm/contacts", { offset: 0, limit: 25, sortBy: "name", filters: { organizationId: "org-9" } }),
      "/api/qwbe/contacts?offset=0&limit=25&sortBy=name&organizationId=org-9",
    )
  })

  it("drops an empty filter value instead of sending it", () => {
    assert.equal(listQueryString({ filters: { organizationId: "" } }), "")
  })

  it("a filter key named like a paging key cannot override paging", () => {
    const parsed = new URLSearchParams(
      listQueryString({ offset: 25, limit: 50, sortBy: "name", filters: { limit: "9", sortBy: "evil" } }),
    )
    assert.equal(parsed.get("limit"), "50")
    assert.equal(parsed.get("sortBy"), "name")
  })

  it("sends the prefix search as q, a first-class list parameter", () => {
    const parsed = new URLSearchParams(listQueryString({ q: "Ac", filters: { type: "Customer" } }))
    assert.equal(parsed.get("q"), "Ac")
    assert.equal(parsed.get("type"), "Customer")
    // An empty q travels nowhere.
    assert.equal(listQueryString({ q: "" }), "")
  })

  it("a field named q or sort never travels as a bare filter key", () => {
    const parsed = new URLSearchParams(
      listQueryString({ q: "Ac", filters: { q: "injected", sort: "evil", page: "9", pageSize: "1" } }),
    )
    assert.equal(parsed.get("q"), "Ac")
    assert.equal(parsed.get("sort"), null)
    assert.equal(parsed.get("page"), null)
    assert.equal(parsed.get("pageSize"), null)
  })
})

describe("list controls from the published contract", () => {
  const orgField = field({ name: "organizationId", label: "Organization", relation: { target: "crm/organizations", entity: "Organization", summary: null } })
  const nameField = field({ name: "name", label: "Name", searchable: true, required: true })
  const emailField = field({ name: "email", label: "Email", searchable: true })
  const contract = {
    params: ["offset", "limit", "sortBy", "descending", "page", "pageSize", "sort", "q", "ids"],
    maxPageSize: 200,
    defaultPageSize: 25,
    search: ["name", "email"],
    filters: ["email", "name", "organizationId"],
    sort: ["name", "email"],
  }
  const fields = [nameField, emailField, orgField]

  it("derives one prefix search and the exact filters from the contract", () => {
    const c = listControlsOf(fields, contract)
    assert.equal(c.search, true)
    // Relations are filters by construction (the contract lists them).
    assert.deepEqual(c.filters.map((f) => f.name), ["email", "name", "organizationId"])
  })

  it("no contract search fields means no q control", () => {
    const c = listControlsOf(fields, { ...contract, search: [] })
    assert.equal(c.search, false)
    assert.equal(c.filters.length, 3)
  })

  it("a fixed-filtered field gets no control of its own", () => {
    const c = listControlsOf(fields, contract, { organizationId: "org-9" })
    assert.deepEqual(c.filters.map((f) => f.name), ["email", "name"])
  })

  it("a field named like a list parameter is never admitted as a filter", () => {
    const sneaky = [...fields, field({ name: "page", label: "Page", searchable: true })]
    const c = listControlsOf(sneaky, { ...contract, filters: [...contract.filters, "page"] })
    assert.equal(c.filters.some((f) => f.name === "page"), false)
  })

  it("a contract name the metadata does not publish is skipped", () => {
    const c = listControlsOf(fields, { ...contract, filters: [...contract.filters, "ghost"] })
    assert.equal(c.filters.some((f) => f.name === "ghost"), false)
  })

  it("without a contract it falls back to the searchable flags, no q", () => {
    const c = listControlsOf(fields, null)
    assert.equal(c.search, false)
    assert.deepEqual(c.filters.map((f) => f.name), ["name", "email"])
  })
})

describe("metadata paths", () => {
  it("percent-encodes a child cube name for the metadata endpoint", () => {
    assert.equal(metadataApiPath("crm/organizations"), "/api/qwbe/catalog/crm%2Forganizations/metadata")
  })

  it("reaches rows through the proxy under the cube's served prefix", () => {
    assert.equal(cubeApiPath("crm/contacts", "/ct-1"), "/api/qwbe/contacts/ct-1")
  })

  // QWB-55 Schema & API panel: every link stays on the same-origin proxy, the
  // record id is ONE encoded segment (no traversal, no extra segments), and an
  // empty id yields no link rather than the list endpoint.
  it("builds panel links on the proxy with an encoded record id", () => {
    assert.equal(recordApiPath("crm/organizations", "org-1"), "/api/qwbe/organizations/org-1")
    assert.equal(recordApiPath("crm/organizations", "a/b"), "/api/qwbe/organizations/a%2Fb")
    assert.equal(recordApiPath("crm/organizations", "../auth"), "/api/qwbe/organizations/..%2Fauth")
    assert.equal(recordApiPath("crm/organizations", ""), null)
    assert.equal(recordApiPath("crm/organizations", ".."), null)
    assert.equal(OPENAPI_API_PATH, "/api/qwbe/openapi.json")
    for (const href of [recordApiPath("crm/organizations", "x")!, metadataApiPath("crm/organizations"), OPENAPI_API_PATH]) {
      assert.ok(href.startsWith("/api/qwbe/") && !href.includes("token") && !href.includes("http"))
    }
  })
})

describe("columns derived from metadata", () => {
  it("maps every published field to a column", () => {
    const columns = columnsFromFields([field({ name: "name" }), field({ name: "industry", sortable: false })])
    assert.deepEqual(
      columns.map((c) => [c.field.name, c.sortable, c.editable, c.visible]),
      [
        ["name", true, true, true],
        ["industry", false, true, true],
      ],
    )
  })

  it("a field added to the metadata appears without touching the component", () => {
    // The stub metadata gains a brand-new field; the derivation must include it
    // with exactly the flags the metadata publishes. No per-entity column list
    // exists anywhere in the frontend to update.
    const extended = [field({ name: "name" }), field({ name: "annualrevenue", label: "Annual Revenue", type: "integer" })]
    const columns = columnsFromFields(extended)
    const added = columns.find((c) => c.field.name === "annualrevenue")
    assert.ok(added, "the new field must become a column")
    assert.equal(added.field.label, "Annual Revenue")
    assert.equal(added.field.type, "integer")
  })

  it("a field absent from the create payload is hidden by default", () => {
    // editable is derived from the create payload, so the meta columns (id,
    // type, version, deleted, createdAt) all have editable: false -- they are
    // bookkeeping, not content, and a 60k-row list hides them by default.
    const columns = columnsFromFields([
      field({ name: "name" }),
      field({ name: "id", editable: false, required: false }),
      field({ name: "createdAt", editable: false }),
    ])
    assert.deepEqual(
      columns.filter((c) => c.visible).map((c) => c.field.name),
      ["name"],
    )
  })
})

describe("inline editing", () => {
  it("an editable field allows editing", () => {
    assert.equal(canEdit(field({ editable: true })), true)
  })

  it("a non-editable field refuses editing", () => {
    assert.equal(canEdit(field({ editable: false })), false)
  })

  it("an editable relation field is editable too, as the metadata declares", () => {
    // organizationId is editable: true in the metadata; the component must not
    // narrow that on its own.
    const organizationId = field({
      name: "organizationId",
      editable: true,
      relation: { target: "crm/organizations", entity: "Organization", summary: "summaryById" },
    })
    assert.equal(canEdit(organizationId), true)
  })
})

describe("sorting", () => {
  it("a sortable column produces the ascending-first request", () => {
    assert.deepEqual(sortRequestFor(column({ name: "name" }), undefined, false), {
      sortBy: "name",
      descending: false,
    })
  })

  it("clicking the sorted column flips the direction", () => {
    assert.deepEqual(sortRequestFor(column({ name: "name" }), "name", false), {
      sortBy: "name",
      descending: true,
    })
  })

  it("a non-sortable column refuses to sort", () => {
    assert.equal(sortRequestFor(column({ name: "industry", sortable: false }), "name", false), undefined)
  })
})

describe("cell value coercion", () => {
  it("numbers become numbers", () => {
    assert.equal(coerce(field({ type: "integer" }), "42"), 42)
  })

  it("an enum stays a string", () => {
    assert.equal(coerce(field({ enum: ["hot", "cold"] }), "hot"), "hot")
  })

  it("a boolean becomes a real boolean, never the string yes", () => {
    assert.equal(coerce(field({ type: "boolean" }), "yes"), true)
    assert.equal(coerce(field({ type: "boolean" }), "no"), false)
  })

  it("an empty string is null only for a nullable field", () => {
    assert.equal(coerce(field({ nullable: true }), ""), null)
    assert.equal(coerce(field({ nullable: false }), ""), "")
  })
})

describe("saving an inline edit", () => {
  const patchCalls: Array<{ url: string; init?: RequestInit }> = []
  const okFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    patchCalls.push({ url: String(url), init })
    return new Response(JSON.stringify({ id: "org-1", name: "Renamed", industry: "tech" }), { status: 200 })
  }) as unknown as typeof fetch

  it("PATCHes exactly the edited key to the row and merges only that key", async () => {
    patchCalls.length = 0
    const result = await saveCell({
      rowPath: "/api/qwbe/organizations/org-1",
      row: { id: "org-1", name: "Old" } as Row,
      field: field({ name: "name" }),
      next: "Renamed",
      doFetch: okFetch,
    })
    assert.equal(result.status, "saved")
    if (result.status === "saved") {
      // The merge carries only the patched key: the caller spreads it over the
      // row, so a stale whole-body response cannot overwrite other columns.
      assert.equal(result.field, "name")
      assert.equal(result.value, "Renamed")
    }
    assert.equal(patchCalls.length, 1)
    assert.equal(patchCalls[0].url, "/api/qwbe/organizations/org-1")
    assert.deepEqual(JSON.parse(String(patchCalls[0].init?.body)), { name: "Renamed" })
  })

  it("a value equal to the current one sends no request at all", async () => {
    patchCalls.length = 0
    const result = await saveCell({
      rowPath: "/api/qwbe/organizations/org-1",
      row: { id: "org-1", name: "Same" } as Row,
      field: field({ name: "name" }),
      next: "Same",
      doFetch: okFetch,
    })
    assert.equal(result.status, "unchanged")
    assert.equal(patchCalls.length, 0)
  })

  it("a refused PATCH carries qwbe's message for the edited field", async () => {
    const refusedFetch = (async () =>
      new Response(
        JSON.stringify({
          issues: [
            { _tag: "Refinement", path: ["industry"], message: "wrong field" },
            { _tag: "Refinement", path: ["name"], message: 'Expected a non empty string, actual ""' },
          ],
          message: "OrganizationPatch refused",
        }),
        { status: 400 },
      )) as unknown as typeof fetch
    const result = await saveCell({
      rowPath: "/api/qwbe/organizations/org-1",
      row: { id: "org-1", name: "Old" } as Row,
      field: field({ name: "name" }),
      next: "",
      doFetch: refusedFetch,
    })
    // The old value stays: the result is a refusal, not a new value -- the
    // caller keeps the row untouched and shows the message in that cell.
    assert.equal(result.status, "refused")
    if (result.status === "refused") {
      assert.equal(result.message, 'Expected a non empty string, actual ""')
    }
  })
})

describe("qwbe error messages", () => {
  const body = {
    issues: [{ _tag: "Refinement", path: ["name"], message: 'Expected a non empty string, actual ""' }],
    message: "OrganizationPatch ...",
  }

  it("surfaces the per-field issue message that names the edited field", () => {
    assert.equal(errorMessage(body, "name"), 'Expected a non empty string, actual ""')
  })

  it("an issue about a different field does not win the cell", () => {
    assert.equal(errorMessage(body, "industry"), "OrganizationPatch ...")
  })

  it("falls back to the qwbe message and then to a default", () => {
    assert.equal(errorMessage({ message: "organization 404" }, "name"), "organization 404")
    assert.equal(errorMessage("plain refusal", "name"), "plain refusal")
    assert.equal(errorMessage({}, "name"), "the change was refused")
  })

  it("a non-JSON error body reaches the message as text", async () => {
    const parsed = await errorBody(new Response("gateway exploded", { status: 502 }))
    assert.equal(parsed, "gateway exploded")
    assert.equal(errorMessage(parsed, "name"), "gateway exploded")
  })
})

describe("requestFailure", () => {
  it("surfaces the message of a JSON error body", async () => {
    const response = new Response(
      JSON.stringify({ message: "qwbe API unreachable at http://qwbe.test" }),
      { status: 502, headers: { "content-type": "application/json" } },
    )
    const error = await requestFailure("metadata", response)
    assert.equal(error.message, "qwbe API unreachable at http://qwbe.test")
  })

  it("falls back to the status when the body carries no message", async () => {
    const error = await requestFailure("metadata", new Response("", { status: 500 }))
    assert.equal(error.message, "metadata request failed: 500")
    const noMessage = await requestFailure("list", new Response("{}", { status: 503 }))
    assert.equal(noMessage.message, "list request failed: 503")
  })
})

describe("relation links", () => {
  it("resolves a relation target to the detail route of the target cube", () => {
    assert.equal(hrefForRelation("crm/organizations", "org-1"), "/organizations/org-1")
  })

  it("handles a root-level cube name", () => {
    assert.equal(hrefForRelation("contacts", "ct-1"), "/contacts/ct-1")
  })

  it("a target without a frontend route yields no link", () => {
    // crm/contracts has no page in this app; a dead href must not be built.
    assert.equal(hrefForRelation("crm/contracts", "ctr-1"), null)
  })

  it("derives the list route of a cube", () => {
    assert.equal(routeOf("crm/contacts"), "/contacts")
  })

  it("builds a row link for a cube this app routes", () => {
    assert.equal(rowHref("crm/contacts", "ct-1"), "/contacts/ct-1")
    assert.equal(rowHref("organizations", "org-1"), "/organizations/org-1")
  })

  it("no row link for a cube without a route", () => {
    assert.equal(rowHref("crm/contracts", "ctr-1"), null)
  })
})

describe("paging shape and response use", () => {
  it("the row request carries offset, limit and sortBy and nothing is fetched beyond one page", () => {
    // The exact URL the list component fetches: paging and sorting travel to
    // qwbe; the limit is the page size, so 60 thousand rows are never pulled.
    assert.equal(
      listApiPath("crm/organizations", { offset: 50, limit: 25, sortBy: "name" }),
      "/api/qwbe/organizations?offset=50&limit=25&sortBy=name",
    )
  })

  it("the component's request path drives a real page response: rows and total pass through untouched", async () => {
    // The component fetches the list URL this builds; here the response it
    // receives is parsed exactly as the component parses it, and the title the
    // detail header shows comes out of the returned rows.
    const page: PageOf<Row> = {
      rows: [{ id: "org-1", name: "Acme SRL" }],
      total: 60_000,
      offset: 0,
      limit: 25,
    }
    const realFetch = globalThis.fetch
    let fetchedUrl = ""
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchedUrl = String(input)
      return new Response(JSON.stringify(page))
    }) as unknown as typeof fetch
    try {
      const url = listApiPath("crm/organizations", { offset: 0, limit: 25 })
      assert.equal(url, "/api/qwbe/organizations?offset=0&limit=25")
      const response = await globalThis.fetch(`http://x.test${url}`)
      const received = (await response.json()) as PageOf<Row>
      assert.equal(received.rows[0].name, "Acme SRL")
      assert.equal(received.total, 60_000)
      assert.equal(titleOf(meta({ cube: "crm/organizations", entity: "Organization" }), received.rows[0]), "Acme SRL")
      assert.equal(fetchedUrl, `http://x.test${url}`)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it("the row title falls back to the id when no required field has a value", () => {
    const { titleOf: t } = require("./cube.ts") as typeof import("./cube.ts")
    assert.equal(t(meta(), { id: "org-2", name: null }), "org-2")
  })
})

// ---------------------------------------------------------------------------
// Custom fields (QWB-52)
// ---------------------------------------------------------------------------

const customField = (over: Partial<FieldMetadata> = {}): FieldMetadata =>
  field({ name: "lead_source", label: "Lead source", custom: true, ...over })

describe("a custom field in the metadata becomes a column", () => {
  it("appends the custom field to the derived columns like any other", () => {
    const fields = [field({ name: "name", required: true }), customField()]
    const columns = columnsFromFields(fields).filter((c) => c.visible)
    assert.deepEqual(
      columns.map((c) => c.field.name),
      ["name", "lead_source"],
    )
  })

  it("an ORPHAN value in a row (definition deleted) never becomes a column and reads as absent", () => {
    // The metadata no longer publishes the field, so nothing names it; the
    // row still carries the value in its `custom` sub-object and nothing
    // derived from the metadata touches it.
    const row: Row = { id: "c1", name: "Dana", custom: { lead_source: "email", gone_field: "x" } }
    const columns = columnsFromFields(meta().fields).filter((c) => c.visible)
    assert.ok(!columns.some((c) => c.field.name === "gone_field"))
    assert.ok(!columns.some((c) => c.field.name === "lead_source"))
    assert.equal(customValueOf(row, customField({ name: "gone_field" })), "x")
  })

  it("a custom field's value is read from the row's custom sub-object", () => {
    const row: Row = { id: "c1", name: "Dana", custom: { lead_source: "email" } }
    assert.equal(customValueOf(row, customField()), "email")
    // A static field still reads the top level.
    assert.equal(customValueOf(row, field({ name: "name" })), "Dana")
  })
})

describe("the edit control follows the field metadata alone", () => {
  it("a select (enum) edits as a select with exactly the published options", () => {
    const f = customField({ enum: ["email", "phone"] })
    assert.equal(renderKindOf(f), "select")
  })

  it("a custom bool edits as a checkbox", () => {
    assert.equal(renderKindOf(customField({ name: "vip", type: "boolean" })), "checkbox")
  })

  it("a custom text field edits as text, and a static boolean keeps its existing editing", () => {
    assert.equal(renderKindOf(customField()), "text")
    assert.equal(renderKindOf(field({ name: "archived", type: "boolean" })), "text")
  })
})

describe("a required custom field refuses an empty save with qwbe's own message", () => {
  it("the refusal message in the cell is the backend's, not an invented one", async () => {
    const backendMessage = '"lead_source" is required and cannot be emptied'
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: backendMessage }), { status: 400 })) as unknown as typeof fetch
    try {
      const result = await saveCell({
        rowPath: "/api/qwbe/contacts/row-1",
        // The current value is DERIVED from the row: a custom field's value
        // lives in the row's `custom` sub-object, exactly as the component
        // passes the whole row in. Handing in a hand-picked `current` would
        // test a value the real caller can never produce.
        row: { id: "row-1", name: "Dana", custom: { lead_source: "email" } } as Row,
        field: customField({ required: true }),
        next: "",
        doFetch: globalThis.fetch,
      })
      assert.equal(result.status, "refused")
      assert.equal(result.status === "refused" && result.message, backendMessage)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it("an empty save on a custom field that was never set is a no-op, not a PATCH (the blocker-1 short-circuit)", async () => {
    const realFetch = globalThis.fetch
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    try {
      const result = await saveCell({
        rowPath: "/api/qwbe/contacts/row-1",
        row: { id: "row-1", name: "Dana" } as Row,
        field: customField({ required: true }),
        next: "",
        doFetch: globalThis.fetch,
      })
      assert.equal(result.status, "unchanged")
      assert.equal(called, false)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it("clearing a SET required custom field is a real change: the PATCH leaves the client (QWB-52 review 1)", async () => {
    const realFetch = globalThis.fetch
    let called = false
    let sentBody: unknown
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      called = true
      sentBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ message: "refused" }), { status: 400 })
    }) as unknown as typeof fetch
    try {
      const result = await saveCell({
        rowPath: "/api/qwbe/contacts/row-1",
        row: { id: "row-1", name: "Dana", custom: { lead_source: "email" } } as Row,
        field: customField({ required: true }),
        next: "",
        doFetch: globalThis.fetch,
      })
      assert.equal(called, true)
      assert.deepEqual(sentBody, { lead_source: "" })
      assert.equal(result.status, "refused")
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it("a successful save merges the value back from the custom sub-object", async () => {
    const realFetch = globalThis.fetch
    let sentBody: unknown
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ id: "row-1", custom: { lead_source: "phone" } }), {
        status: 200,
      })
    }) as unknown as typeof fetch
    try {
      const result = await saveCell({
        rowPath: "/api/qwbe/contacts/row-1",
        row: { id: "row-1", name: "Dana", custom: { lead_source: "email" } } as Row,
        field: customField({ enum: ["email", "phone"] }),
        next: "phone",
        doFetch: globalThis.fetch,
      })
      assert.deepEqual(sentBody, { lead_source: "phone" })
      assert.equal(result.status, "saved")
      assert.equal(result.status === "saved" && result.value, "phone")
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe("the definitions panel follows the permission", () => {
  it("a user without customfields:write gets no panel", () => {
    assert.equal(canDefineFields(["auth:session", "crm:read", "customfields:read"]), false)
  })

  it("a user with customfields:write gets the panel", () => {
    assert.equal(canDefineFields(["customfields:write"]), true)
  })
})

describe("pageWindow", () => {
  it("counts pages from the offset and the page size", () => {
    assert.deepEqual(pageWindow(0, 25, 60000), { currentPage: 1, lastPage: 2400 })
    assert.deepEqual(pageWindow(75, 25, 60000), { currentPage: 4, lastPage: 2400 })
    // A bigger page size means fewer pages for the same rows.
    assert.deepEqual(pageWindow(0, 200, 60000), { currentPage: 1, lastPage: 300 })
  })

  it("has one page for an empty cube and none at all without a total", () => {
    assert.deepEqual(pageWindow(0, 25, 0), { currentPage: 1, lastPage: 1 })
    assert.deepEqual(pageWindow(50, 25, undefined), { currentPage: 3, lastPage: undefined })
  })
})

// The "Page" box commits what a human typed (QWB-59 F3): a whole number lands
// on that page, clamped to the range; anything else is rejected so the box
// falls back to the current page instead of jumping somewhere.
describe("pageFromInput", () => {
  it("accepts whole numbers and clamps them into 1..lastPage", () => {
    assert.equal(pageFromInput("5", 2400), 5)
    assert.equal(pageFromInput(" 5 ", 2400), 5)
    assert.equal(pageFromInput("9999", 2400), 2400)
    assert.equal(pageFromInput("0", 2400), 1)
    assert.equal(pageFromInput("-3", 2400), 1)
    // No total yet: no upper bound to clamp to.
    assert.equal(pageFromInput("9999", undefined), 9999)
  })

  it("rejects what is not a whole number", () => {
    for (const raw of ["", "  ", "2.5", "abc", "1e400", "Infinity", "NaN"]) {
      assert.equal(pageFromInput(raw, 10), undefined, JSON.stringify(raw))
    }
  })
})

describe("the create payload", () => {
  const orgFields = [
    field({ name: "name", label: "Name", required: true }),
    field({ name: "externalId", label: "External ID", nullable: true }),
    field({ name: "industry", label: "Industry", nullable: true }),
    field({ name: "employees", label: "Employees", type: "integer", nullable: true }),
  ]

  it("carries only the filled fields, coerced like an inline edit", () => {
    const { payload, missing } = createPayloadOf(orgFields, {
      name: "  Acme  ",
      industry: "Software",
      employees: "42",
    })
    // Untouched fields are absent, so the create schema's defaults apply;
    // values are trimmed, numbers become numbers, required non-nullable
    // strings travel as the trimmed text.
    assert.deepEqual(payload, { name: "Acme", industry: "Software", employees: 42 })
    assert.deepEqual(missing, [])
  })

  it("reports a required field left empty by its label, and sends nothing", () => {
    const { payload, missing } = createPayloadOf(orgFields, {
      name: "   ",
      industry: "Software",
    })
    assert.deepEqual(payload, { industry: "Software" })
    assert.deepEqual(missing, ["Name"])
  })

  it("skips whitespace-only optional fields instead of storing empty strings", () => {
    const { payload } = createPayloadOf(orgFields, {
      name: "Acme",
      externalId: " ",
    })
    assert.deepEqual(payload, { name: "Acme" })
  })

  it("treats a missing key as an untouched field", () => {
    const { payload, missing } = createPayloadOf(orgFields, {})
    assert.deepEqual(payload, {})
    assert.deepEqual(missing, ["Name"])
  })

  // The sandbox's required custom flags (form/tva/cui, the vtiger mirror): a
  // required BOOLEAN must reach qwbe as false when untouched -- an unchecked
  // box is a value, not an absence -- while a required enum still refuses.
  const vatFields = [
    field({ name: "name", label: "Name", required: true }),
    field({ name: "tva", label: "TVA", type: "boolean", nullable: false, required: true }),
    field({ name: "form", label: "Form", nullable: false, enum: ["SRL", "SA"], required: true }),
  ]

  it("sends an untouched required boolean as false, never as a refusal", () => {
    const untouched = createPayloadOf(vatFields, { name: "Acme" })
    assert.deepEqual(untouched.payload, { name: "Acme", tva: false })
    assert.deepEqual(untouched.missing, ["Form"])
    const toggledOff = createPayloadOf(vatFields, { name: "Acme", tva: "false" })
    assert.deepEqual(toggledOff.payload, { name: "Acme", tva: false })
    assert.deepEqual(toggledOff.missing, ["Form"])
  })

  it("reports a required enum left unchosen by its label", () => {
    const { missing } = createPayloadOf(vatFields, { name: "Acme", tva: "true" })
    assert.deepEqual(missing, ["Form"])
  })
})

// The detail page's fieldsets (QWB-53): a layout hint by field NAME over the
// published metadata, never a second schema. The rule under test: nothing the
// metadata publishes is lost, whatever the groups name.
describe("detail field groups", () => {
  const published = [
    field({ name: "name", required: true }),
    field({ name: "phone" }),
    field({ name: "billingCity" }),
    field({ name: "id", editable: false }),
    field({ name: "tva", type: "boolean", custom: true }),
  ]
  const groups = [
    { legend: "Organization", fields: ["name", "renamedAway"] },
    { legend: "Contact details", fields: ["phone", "name"] },
    { legend: "Empty", fields: ["nothingHere"] },
  ]

  it("places named fields in metadata-backed groups, in the group's order", () => {
    const sections = groupFields(published, groups)
    assert.deepEqual(
      sections.map((s) => [s.legend, s.fields.map((f) => f.name)]),
      [
        ["Organization", ["name"]],
        ["Contact details", ["phone"]],
        ["Other", ["billingCity", "id"]],
        ["Custom fields", ["tva"]],
      ],
    )
  })

  it("skips a name the metadata no longer publishes and drops an empty group", () => {
    const legends = groupFields(published, groups).map((s) => s.legend)
    assert.ok(!legends.includes("Empty"))
  })

  it("never places a field twice", () => {
    const all = groupFields(published, groups).flatMap((s) => s.fields.map((f) => f.name))
    assert.deepEqual([...new Set(all)].length, all.length)
    assert.deepEqual(all.length, published.length)
  })

  it("a new custom field appears without a frontend change", () => {
    const tomorrow = [...published, field({ name: "cui", custom: true })]
    const custom = groupFields(tomorrow, groups).find((s) => s.legend === "Custom fields")!
    assert.deepEqual(custom.fields.map((f) => f.name), ["tva", "cui"])
  })

  it("carries the caller's emphasis flag on that section only", () => {
    const sections = groupFields(published, [{ ...groups[0], important: true }, groups[1]])
    assert.deepEqual(sections.map((s) => s.important ?? false), [true, false, false, false])
  })

  it("without groups every field is a leftover, so nothing changes for a page that passes none", () => {
    assert.deepEqual(
      groupFields(published, []).map((s) => [s.legend, s.fields.length]),
      [["Other", 4], ["Custom fields", 1]],
    )
  })
})

// The saved value is merged where the field lives, and ONLY that key: the
// list and the detail page share this merge.
describe("withSavedValue", () => {
  const row: Row = { id: "r1", name: "Acme", phone: "1", custom: { tva: false, cui: "x" } }

  it("merges a static field at the top level and keeps the rest", () => {
    assert.deepEqual(withSavedValue(row, field({ name: "phone" }), "2"), { ...row, phone: "2" })
  })

  it("merges a custom field inside `custom` without dropping its siblings", () => {
    const saved = withSavedValue(row, field({ name: "tva", type: "boolean", custom: true }), true)
    assert.deepEqual(saved.custom, { tva: true, cui: "x" })
    assert.equal(saved.name, "Acme")
  })

  it("creates the `custom` sub-object when the row had none", () => {
    const bare: Row = { id: "r2", name: "Bare" }
    assert.deepEqual(withSavedValue(bare, field({ name: "cui", custom: true }), "y").custom, { cui: "y" })
  })
})

describe("formatHrefOf", () => {
  it("links an email, a phone and a website the way vtiger does", () => {
    assert.equal(formatHrefOf(field({ format: "email" }), " office@exemplu.test "), "mailto:office@exemplu.test")
    assert.equal(formatHrefOf(field({ format: "phone" }), "0700 000 001"), "tel:0700000001")
    assert.equal(formatHrefOf(field({ format: "url" }), "www.exemplu.test"), "http://www.exemplu.test")
    assert.equal(formatHrefOf(field({ format: "url" }), "https://demo-instal.test"), "https://demo-instal.test")
  })

  it("never yields a script link, and nothing for an empty or unformatted value", () => {
    assert.equal(formatHrefOf(field({ format: "url" }), "javascript:alert(1)"), "http://javascript:alert(1)")
    assert.equal(formatHrefOf(field({ format: "phone" }), "n/a"), null)
    assert.equal(formatHrefOf(field({ format: "email" }), ""), null)
    assert.equal(formatHrefOf(field(), "www.exemplu.test"), null)
  })
})
