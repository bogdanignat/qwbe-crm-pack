// Unit tests for the Organizations mockup layer (T-1811): the merge under the
// published metadata, the payload guards, the demo rows on the list and the
// demo record route. qwbe is stubbed at the HTTP boundary.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  canEdit,
  createPayloadOf,
  listWindowOf,
  saveCell,
  type CubeMetadata,
  type FieldMetadata,
} from "../../lib/cube.ts"
import { demoRowsMatching } from "../../lib/demo-search.ts"
import { changedPayloadOf } from "../../lib/kit-form.ts"
import { qwbeDataProvider } from "../../lib/qwbe-data-provider.ts"
import { DEMO_ORGANIZATIONS, MOCK_FIELDS, PICKLISTS, VTIGER_PLACEMENT, withMockFields } from "./index.ts"

const field = (over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name: "name",
  label: "Name",
  type: "string",
  required: true,
  editable: true,
  sortable: true,
  searchable: true,
  nullable: false,
  enum: null,
  relation: null,
  custom: false,
  ...over,
})

const meta = (fields: FieldMetadata[], cube = "crm/organizations"): CubeMetadata => ({
  cube,
  entity: "Organization",
  version: "1.1.0",
  schemaHash: "x",
  fields,
})

const byName = (m: CubeMetadata, name: string) => m.fields.filter((f) => f.name === name)

// A fetch that fails the test if anything calls it.
const noBackend: typeof fetch = async (input) => {
  throw new Error(`unexpected backend call: ${String(input)}`)
}

describe("mock data", () => {
  it("has the 15 kept missing fields of §5.2 and the Sector, in vtiger order, with their placement", () => {
    assert.equal(MOCK_FIELDS.length, 16)
    assert.equal(new Set(MOCK_FIELDS.map((f) => f.name)).size, 16)
    assert.equal(MOCK_FIELDS.at(-1)?.name, "billingSector")
    assert.deepEqual(VTIGER_PLACEMENT.legalForm, {
      field: "cf_658",
      block: "Organization Information",
      sequence: 9,
      maxLength: 255,
    })
    assert.deepEqual(byName(meta(MOCK_FIELDS), "legalForm")[0].enum, PICKLISTS.P1.values)
  })

  it("marks required the fields required on every save (backend.md §12), and no other", () => {
    const required = MOCK_FIELDS.filter((f) => f.required).map((f) => f.name)
    assert.deepEqual(required, ["legalForm", "vatPayer", "cui", "assignedTo", "billingState", "billingSector"])
  })

  it("has no repeated value in any picklist", () => {
    for (const [key, picklist] of Object.entries(PICKLISTS)) {
      assert.equal(new Set(picklist.values).size, picklist.values.length, key)
    }
  })

  it("has the picklists of the fields shown, with the sizes of §5.3", () => {
    const sizes = Object.fromEntries(Object.entries(PICKLISTS).map(([k, p]) => [k, p.values.length]))
    assert.deepEqual(sizes, { P1: 29, P2: 43, P3: 12, P4: 123, P5: 9, P7: 4 })
  })

  it("are all bound for the cube, none for a runtime custom field", () => {
    assert.equal(MOCK_FIELDS.some((f) => f.custom), false)
    assert.ok(DEMO_ORGANIZATIONS.every((o) => o.custom === undefined))
  })

  it("formats the extra phones as links", () => {
    const formats = MOCK_FIELDS.filter((f) => f.format).map((f) => [f.name, f.format])
    assert.deepEqual(formats, [
      ["otherPhone", "phone"],
      ["mobilePhone", "phone"],
      ["fax", "phone"],
    ])
  })

  it("has the three fictitious organizations of §6", () => {
    assert.deepEqual(
      DEMO_ORGANIZATIONS.map((o) => o.id),
      ["org_mock_001", "org_mock_002", "org_mock_003"],
    )
  })
})

describe("withMockFields", () => {
  it("lets the real field win and drops its mock", () => {
    const real = field({ name: "cui", label: "CUI (real)", required: false })
    const merged = withMockFields(meta([field(), real]))
    assert.deepEqual(byName(merged, "cui"), [real])
    assert.equal(merged.fields.length, 2 + 15)
  })

  it("appends every unpublished field marked mock, never sortable or searchable", () => {
    const merged = withMockFields(meta([field()]))
    const mocks = merged.fields.filter((f) => f.mock)
    assert.equal(mocks.length, 16)
    assert.equal(merged.fields[0].name, "name")
    assert.ok(mocks.every((f) => f.mock === true && !f.sortable && !f.searchable && !canEdit(f)))
  })

  it("leaves every other cube untouched", () => {
    const contacts = meta([field()], "crm/contacts")
    assert.equal(withMockFields(contacts), contacts)
  })
})

describe("mock fields never leave the browser", () => {
  const fields = withMockFields(meta([field()])).fields
  const cui = fields.find((f) => f.name === "cui")!
  const vat = fields.find((f) => f.name === "vatPayer")!
  // A picklist mock.
  const category = fields.find((f) => f.name === "customerCategory")!
  const demo = DEMO_ORGANIZATIONS[0]

  it("are dropped from the in-place PATCH body", () => {
    const payload = changedPayloadOf(
      [fields[0], cui, vat, category],
      { name: "A", cui: "", vatPayer: false, customerCategory: "Gold" },
      { name: "B", cui: "99000001", vatPayer: true, customerCategory: "Silver" },
    )
    assert.deepEqual(payload, { name: "B" })
  })

  it("are dropped from the create POST body, required or not", () => {
    const { payload, missing } = createPayloadOf([fields[0], cui, vat, category], {
      name: "A",
      cui: "",
      customerCategory: "Silver",
    })
    assert.deepEqual(payload, { name: "A" })
    assert.deepEqual(missing, [])
  })

  it("are refused by the inline editor before any request", async () => {
    for (const mock of [cui, category]) {
      const result = await saveCell({ rowPath: "/x", row: demo, field: mock, next: "1", doFetch: noBackend })
      assert.equal(result.status, "refused", mock.name)
    }
  })
})

describe("demo rows", () => {
  const page = { rows: [{ id: "a" }, { id: "b" }], offset: 0, limit: 25, total: 61347 }
  const noun = { one: "organization", other: "organizations" }

  it("ride on the first page, outside the server range and total", () => {
    const view = listWindowOf(page, DEMO_ORGANIZATIONS, noun)
    assert.equal(view.demo.length, 3)
    assert.equal(view.label, "1-2 of 61.347 organizations (+3 demo)")
  })

  it("are counted with the real rows when everything is in view", () => {
    const all = listWindowOf({ ...page, total: 2 }, DEMO_ORGANIZATIONS, noun)
    assert.equal(all.label, "5 organizations (2 + 3 demo)")
  })

  it("still show on a cube with no real rows, and never as 0 of 0", () => {
    const view = listWindowOf({ rows: [], offset: 0, limit: 25, total: 0 }, DEMO_ORGANIZATIONS, noun)
    assert.equal(view.demo.length, 3)
    assert.equal(view.label, "3 organizations (3 demo)")
  })

  it("are absent on later pages, and the label says nothing of them", () => {
    const later = listWindowOf({ ...page, offset: 25 }, DEMO_ORGANIZATIONS, noun)
    assert.equal(later.demo.length, 0)
    assert.equal(later.label, "26-27 of 61.347 organizations")
  })

  it("count only those matching the query", () => {
    const matching = demoRowsMatching(DEMO_ORGANIZATIONS, ["name"], { q: "demo", filters: {} })
    assert.equal(listWindowOf(page, matching, noun).label, "1-2 of 61.347 organizations (+1 demo)")
    assert.equal(listWindowOf({ ...page, rows: [{ id: "a" }], total: 1 }, [], noun).label, "1 organization")
  })
})

describe("demo route", () => {
  const provider = qwbeDataProvider(noBackend)

  it("opens a demo organization from the mock without calling the backend", async () => {
    const { data } = await provider.getOne("crm/organizations", { id: "org_mock_002" })
    assert.equal(data.name, "Demo Instal Nord SA")
  })

  it("refuses to update a demo organization without calling the backend", async () => {
    await assert.rejects(
      provider.update("crm/organizations", { id: "org_mock_001", data: { name: "X" }, previousData: { id: "org_mock_001" } }),
      /read-only/,
    )
  })
})
