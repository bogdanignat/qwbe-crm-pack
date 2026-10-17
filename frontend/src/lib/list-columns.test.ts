// The list's columns: the caller's defaults, the reader's pick, the picker order.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { columnsFromFields } from "./cube.ts"
import {
  columnsNamed,
  defaultColumnNamesOf,
  pickerColumnsOf,
  readColumnChoice,
  toggledColumns,
  writeColumnChoice,
} from "./list-columns.ts"
import { testField as field } from "./test-fields.ts"

const all = columnsFromFields([
  field({ name: "id", label: "Id", editable: false }),
  field({ name: "name", label: "Organization Name", required: true }),
  field({ name: "phone", label: "Phone" }),
  field({ name: "cui", label: "CUI", mock: true }),
  field({ name: "partner", label: "Partner", custom: true }),
  field({ name: "website", label: "Website" }),
])

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size
    },
  }
}

describe("defaultColumnNamesOf", () => {
  it("takes the caller's defaults in order, dropping unknown and hidden names", () => {
    assert.deepEqual(defaultColumnNamesOf(all, ["cui", "name", "nope", "phone"], ["phone"]), ["cui", "name"])
  })

  it("falls back to the metadata default: the editable fields", () => {
    assert.deepEqual(defaultColumnNamesOf(all, undefined, []), ["name", "phone", "cui", "partner", "website"])
  })
})

describe("the picker", () => {
  it("lists the current columns first, then the rest by label, never the bookkeeping", () => {
    const names = pickerColumnsOf(all, ["phone", "name"]).map((c) => c.field.name)
    assert.deepEqual(names, ["phone", "name", "cui", "partner", "website"])
  })

  it("adds a column at the right end and never removes the title column", () => {
    assert.deepEqual(toggledColumns(["name"], "phone", true, "name"), ["name", "phone"])
    assert.deepEqual(toggledColumns(["name", "phone"], "phone", false, "name"), ["name"])
    assert.deepEqual(toggledColumns(["name"], "name", false, "name"), ["name"])
  })

  it("maps names to columns in the given order", () => {
    assert.deepEqual(columnsNamed(all, ["website", "name"]).map((c) => c.field.name), ["website", "name"])
  })
})

describe("the stored pick", () => {
  it("round-trips per cube and resets to null", () => {
    const storage = memoryStorage()
    writeColumnChoice("crm/organizations", ["name", "cui"], storage)
    assert.deepEqual(readColumnChoice("crm/organizations", storage), ["name", "cui"])
    assert.equal(readColumnChoice("crm/contacts", storage), null)
    writeColumnChoice("crm/organizations", null, storage)
    assert.equal(readColumnChoice("crm/organizations", storage), null)
  })

  it("ignores a stored value that is not a list of names", () => {
    const storage = memoryStorage()
    storage.setItem("crm.listColumns.x", "{bad")
    assert.equal(readColumnChoice("x", storage), null)
    storage.setItem("crm.listColumns.x", "[1,2]")
    assert.equal(readColumnChoice("x", storage), null)
  })
})
