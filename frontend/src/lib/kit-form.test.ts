// Unit tests for the kit renderer logic (QWB-54): custom-field flattening,
// edit initial values and the update payload (field grouping is groupFields
// in cube.ts, tested in cube.test.ts). qwbe is stubbed at the function boundary -- pure derivation, no
// live backend and no DOM.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  CLIPBOARD_UNAVAILABLE,
  changedPayloadOf,
  copyText,
  displayRowOf,
  escapeCancels,
  fieldsInEditOf,
  initialValuesOf,
  updatePayloadOf,
} from "./kit-form.ts"
import { canEdit, groupFields, type FieldMetadata } from "./cube.ts"

const field = (over: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name: "name",
  label: "Name",
  type: "string",
  required: true,
  editable: true,
  sortable: true,
  searchable: false,
  nullable: false,
  enum: null,
  relation: null,
  custom: false,
  ...over,
})

describe("displayRowOf", () => {
  const meta = {
    fields: [
      field(),
      field({ name: "tva", label: "TVA", type: "boolean", custom: true, nullable: true }),
    ],
  }

  it("moves published custom values to the top level", () => {
    const flat = displayRowOf(meta, { id: "con_1", name: "Ada", custom: { tva: true } })
    assert.equal(flat.tva, true)
    assert.equal(flat.name, "Ada")
  })

  it("an orphan or future custom key never reaches the flattened row", () => {
    const flat = displayRowOf(meta, {
      id: "con_1",
      name: "Ada",
      custom: { deleted_def: "x", not_published_yet: 1 },
    })
    assert.equal("deleted_def" in flat, false)
    assert.equal("not_published_yet" in flat, false)
  })
})

describe("initialValuesOf", () => {
  it("strings for text and enum fields, empty string for missing values", () => {
    const fields = [
      field(),
      field({ name: "stage", label: "Stage", required: false, nullable: true, enum: ["lead", "won"] }),
      field({ name: "company", label: "Company", required: false, nullable: true }),
    ]
    assert.deepEqual(
      initialValuesOf(fields, { id: "con_1", name: "Ada", stage: "lead", company: null }),
      { name: "Ada", stage: "lead", company: "" },
    )
  })

  it("a real boolean for the checkbox kind", () => {
    const fields = [field({ name: "tva", label: "TVA", type: "boolean", custom: true, nullable: true })]
    assert.deepEqual(initialValuesOf(fields, { tva: true }), { tva: true })
    assert.deepEqual(initialValuesOf(fields, {}), { tva: false })
  })
})

describe("updatePayloadOf", () => {
  const fields = [
    field(),
    field({ name: "phone", label: "Phone", required: false, nullable: true }),
    field({ name: "company", label: "Company", required: false, nullable: false }),
    field({ name: "tva", label: "TVA", type: "boolean", custom: true, nullable: true }),
  ]

  it("coerces with the same rules as the inline editor", () => {
    const payload = updatePayloadOf(fields, {
      name: "Ada",
      phone: "",
      company: "Acme",
      tva: true,
    })
    assert.deepEqual(payload, { name: "Ada", company: "Acme", phone: null, tva: true })
  })

  it("a cleared nullable field becomes null", () => {
    const payload = updatePayloadOf(fields, { name: "Ada", phone: " ", company: "", tva: false })
    assert.equal(payload.phone, null)
  })

  it("a cleared non-nullable optional field is skipped, not sent as empty", () => {
    const payload = updatePayloadOf(fields, { name: "Ada", company: "", tva: false })
    assert.equal("company" in payload, false)
  })

  it("a cleared required field is never sent", () => {
    const payload = updatePayloadOf(fields, { name: "", phone: "555", company: "", tva: false })
    assert.deepEqual(payload, { phone: "555", tva: false })
  })

  it("an enum value travels as its string, an integer as a number", () => {
    const enumFields = [
      field({ name: "stage", label: "Stage", required: false, nullable: true, enum: ["lead", "won"] }),
      field({ name: "age", label: "Age", type: "integer", required: false, nullable: true }),
    ]
    const payload = updatePayloadOf(enumFields, { stage: "won", age: "42" })
    assert.deepEqual(payload, { stage: "won", age: 42 })
  })
})

describe("changedPayloadOf", () => {
  const fields = [
    field(),
    field({ name: "phone", label: "Phone", required: false, nullable: true }),
    field({ name: "company", label: "Company", required: false, nullable: false }),
    field({ name: "tva", label: "TVA", type: "boolean", custom: true, nullable: true }),
  ]
  const initial = initialValuesOf(fields, { name: "Ada", phone: "555", company: "Acme", tva: false })

  it("sends only the fields whose value changed, coerced by type", () => {
    const payload = changedPayloadOf(fields, initial, {
      ...initial,
      phone: "",
      tva: true,
    })
    assert.deepEqual(payload, { phone: null, tva: true })
  })

  it("sends nothing when nothing changed, including whitespace-only edits", () => {
    assert.deepEqual(changedPayloadOf(fields, initial, { ...initial, name: " Ada " }), {})
  })

  it("an untouched required field left empty by the row is not sent", () => {
    const emptyStart = initialValuesOf(fields, { name: "", phone: null, company: "", tva: false })
    assert.deepEqual(changedPayloadOf(fields, emptyStart, { ...emptyStart, phone: "1" }), { phone: "1" })
  })
})

// The merged renderer's contract (QWB-53 + QWB-54): every published field is
// displayed -- a non-editable one included -- but only the editable ones
// become inputs and only their changes travel, a runtime custom field among
// them, without a frontend change.
describe("read-only and runtime fields through the renderer's derivation", () => {
  const meta = {
    fields: [
      field({ name: "id", label: "Id", required: false, editable: false }),
      field({ name: "name" }),
      field({ name: "createdAt", label: "Created", required: false, editable: false }),
      field({ name: "cui", label: "CUI", required: false, custom: true, nullable: true }),
    ],
  }
  const groups = [{ legend: "Identity", fields: ["name"], important: true }]
  const row = { id: "org_1", name: "Acme", createdAt: "2026-01-01", custom: { cui: "RO1" } }

  it("shows every published field, editable or not, and marks the emphasized section", () => {
    const sections = groupFields(meta.fields, groups)
    assert.deepEqual(
      sections.map((s) => [s.legend, s.important ?? false, s.fields.map((f) => f.name)]),
      [
        ["Identity", true, ["name"]],
        ["Other", false, ["id", "createdAt"]],
        ["Custom fields", false, ["cui"]],
      ],
    )
  })

  it("only the editable fields get form values, the custom one flattened", () => {
    const editable = groupFields(meta.fields, groups).flatMap((s) => s.fields).filter(canEdit)
    assert.deepEqual(editable.map((f) => f.name), ["name", "cui"])
    const initial = initialValuesOf(editable, displayRowOf(meta, row))
    assert.deepEqual(initial, { name: "Acme", cui: "RO1" })
    // A read-only value is never a form value, so it can never be sent.
    assert.equal("createdAt" in initial, false)
  })

  it("a changed custom value travels flat and alone; a cleared one as null", () => {
    const editable = meta.fields.filter(canEdit)
    const initial = initialValuesOf(editable, displayRowOf(meta, row))
    assert.deepEqual(changedPayloadOf(editable, initial, { ...initial, cui: "RO2" }), { cui: "RO2" })
    assert.deepEqual(changedPayloadOf(editable, initial, { ...initial, cui: "" }), { cui: null })
  })
})

describe("fieldsInEditOf (pencil scope)", () => {
  const editable = [field(), field({ name: "cui", label: "CUI", nullable: true, required: false })]

  it("scopes the form to nothing, everything, or exactly the pencilled field", () => {
    assert.deepEqual(fieldsInEditOf(editable, null), [])
    assert.deepEqual(fieldsInEditOf(editable, "all"), editable)
    assert.deepEqual(fieldsInEditOf(editable, "cui").map((f) => f.name), ["cui"])
    assert.deepEqual(fieldsInEditOf(editable, "not-editable"), [])
  })

  it("a single-field draft persists only that field even if the form carries others", () => {
    const scoped = fieldsInEditOf(editable, "cui")
    const initial = initialValuesOf(scoped, { name: "Ada", cui: "RO1" })
    assert.deepEqual(changedPayloadOf(scoped, initial, { ...initial, cui: "RO2", name: "Changed" }), { cui: "RO2" })
  })
})

describe("escapeCancels (QWB-58)", () => {
  it("Escape closes the draft only while no save is pending", () => {
    assert.equal(escapeCancels("Escape", false), true)
    assert.equal(escapeCancels("Escape", true), false)
    assert.equal(escapeCancels("Enter", false), false)
  })
})

describe("copyText (QWB-58)", () => {
  it("reports a missing Clipboard API (insecure origin) in words, without throwing", async () => {
    assert.equal(await copyText("x", undefined), CLIPBOARD_UNAVAILABLE)
  })

  it("returns null on success and the message on a refused write", async () => {
    const written: string[] = []
    assert.equal(await copyText("x", { writeText: async (t) => void written.push(t) }), null)
    assert.deepEqual(written, ["x"])
    assert.equal(
      await copyText("x", { writeText: async () => Promise.reject(new Error("denied")) }),
      "denied",
    )
  })
})
