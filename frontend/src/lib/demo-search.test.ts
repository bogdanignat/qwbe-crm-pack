// The demo rows answer a list query as the backend answers it for real rows,
// and are found by CUI, email and phone too.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DEMO_EXTRA_SEARCH, demoRowsMatching, matchesPrefix } from "./demo-search.ts"
import { DEMO_ORGANIZATIONS } from "../mock/organizations/index.ts"

const names = (rows: { name?: unknown }[]) => rows.map((r) => r.name)

describe("matchesPrefix", () => {
  const row = { name: "Exemplu Construct SRL", phone: "0700 000 001", email: "office@exemplu.test" }

  it("matches a case-insensitive prefix of any field, never the middle", () => {
    assert.equal(matchesPrefix(row, ["name"], "exem"), true)
    assert.equal(matchesPrefix(row, ["name"], "construct"), false)
    assert.equal(matchesPrefix(row, ["name"], "  "), false)
  })

  it("matches any of the fields, trims the query, and skips an unsearched field or a null", () => {
    const org = { name: "Exemplu Construct SRL", industry: "IT", externalId: null }
    assert.equal(matchesPrefix(org, ["name", "industry"], "exem"), true)
    assert.equal(matchesPrefix(org, ["name", "industry"], " it "), true)
    assert.equal(matchesPrefix(org, ["name"], "it"), false)
    assert.equal(matchesPrefix(org, ["externalId"], "n"), false)
  })

  it("matches a phone by its digits", () => {
    assert.equal(matchesPrefix(row, ["phone"], "0700000"), true)
    assert.equal(matchesPrefix(row, ["phone"], "0700 000 0"), true)
    assert.equal(matchesPrefix(row, ["phone"], "0711"), false)
  })
})

describe("demoRowsMatching", () => {
  const fields = ["name", "industry", "externalId"]

  it("keeps every demo row without a query", () => {
    assert.equal(demoRowsMatching(DEMO_ORGANIZATIONS, fields, { q: "", filters: {} }).length, 3)
  })

  it("keeps to the list's search fields", () => {
    assert.deepEqual(names(demoRowsMatching(DEMO_ORGANIZATIONS, fields, { q: "demo", filters: {} })), ["Demo Instal Nord SA"])
    assert.equal(demoRowsMatching(DEMO_ORGANIZATIONS, fields, { q: "99000003", filters: {} }).length, 0)
  })

  it("finds the demo rows by name, CUI, email and phone with the extra fields", () => {
    const all = [...fields, ...DEMO_EXTRA_SEARCH]
    const find = (q: string) => names(demoRowsMatching(DEMO_ORGANIZATIONS, all, { q, filters: {} }))
    assert.deepEqual(find("demo"), ["Demo Instal Nord SA"])
    assert.deepEqual(find("99000003"), ["Proba Agro Vest II"])
    assert.deepEqual(find("office@"), ["Exemplu Construct SRL"])
    assert.deepEqual(find("0700 000 002"), ["Demo Instal Nord SA"])
    assert.deepEqual(find("nothing-like-it"), [])
  })

  it("applies an exact filter as the backend does", () => {
    const exact = demoRowsMatching(DEMO_ORGANIZATIONS, fields, { q: "", filters: { name: "Proba Agro Vest II" } })
    assert.deepEqual(names(exact), ["Proba Agro Vest II"])
    assert.equal(demoRowsMatching(DEMO_ORGANIZATIONS, fields, { q: "", filters: { name: "Proba" } }).length, 0)
  })
})
