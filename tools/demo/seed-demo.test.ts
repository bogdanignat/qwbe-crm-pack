// The pure half of tools/demo/seed-demo.ts (seed-demo-fields.ts, seed-demo-pure.ts), checked without a network or a database.
//
// What is actually load-bearing: the demo custom-field definitions satisfy the kernel's
// definition contract (tools/schema is not importable from here -- the NAME pattern and the
// select-options rule are mirrored, and a comment names the source), the generated rows
// satisfy the cubes' schemas (so a seed run never dies on a 400), every custom value passes
// the kernel's value policy, and the CONTRACT TITLES are deterministic and distinct -- the
// wipe deletes demo contracts by exactly those titles, so a drifting generator would leave
// rows behind that nothing can find.

import { describe, expect, it } from "@effect/vitest"

import { CONTACT_CUSTOM_FIELDS, COUNTS, ORGANIZATION_CUSTOM_FIELDS } from "./seed-demo-fields.ts"
import { contactRow, contractRow, demoContractTitles, organizationRow } from "./seed-demo-pure.ts"

// The kernel's customfields definition contract (qwbe core/src/cubes/customfields/schema.ts):
// NAME is /^[a-z][a-zA-Z0-9_]{0,31}$/ and a "select" needs at least one option. Repeated here
// as data, not imported: the kernel's cube internals are not a public subpath of qwbe-core.
const NAME = /^[a-z][a-zA-Z0-9_]{0,31}$/
const TYPES = ["text", "number", "date", "bool", "select"]
const MAX_CUSTOM_KEYS = 32
const MAX_CUSTOM_BYTES = 8192

const checkDefs = (defs: typeof ORGANIZATION_CUSTOM_FIELDS) => {
  for (const f of defs) {
    expect(f.name, `field name ${f.name}`).toMatch(NAME)
    expect(TYPES.includes(f.fieldType), `field type ${f.fieldType}`).toBeTruthy()
    if (f.fieldType === "select") expect(f.options.length > 0, `select ${f.name} needs options`).toBeTruthy()
    else expect(f.options, `non-select ${f.name} carries no options`).toEqual([])
  }
  const names = defs.map((f) => f.name)
  expect(new Set(names).size, "no duplicate field names").toBe(names.length)
}

describe("demo custom field definitions (structure mirrored from vtiger)", () => {
  it("both sets satisfy the kernel's definition contract", () => {
    checkDefs(ORGANIZATION_CUSTOM_FIELDS)
    checkDefs(CONTACT_CUSTOM_FIELDS)
  })

  it("carries the structure the owner saw in vtiger (counts, required flags)", () => {
    expect(ORGANIZATION_CUSTOM_FIELDS.length).toBe(14)
    expect(CONTACT_CUSTOM_FIELDS.length).toBe(13)
    const required = (defs: typeof ORGANIZATION_CUSTOM_FIELDS) => defs.filter((f) => f.required).map((f) => f.name).sort()
    expect(required(ORGANIZATION_CUSTOM_FIELDS)).toEqual(["cui", "form", "tva"])
    expect(required(CONTACT_CUSTOM_FIELDS)).toEqual([])
  })
})

describe("the generated demo rows", () => {
  it("50 organizations: distinct names, marked externalIds, schema-valid values", () => {
    const names = new Set()
    for (let i = 1; i <= COUNTS.organizations; i++) {
      const row = organizationRow(i)
      names.add(row.name)
      expect(row.externalId).toBe(`demo:organization:${i}`)
      expect(row.name.length > 0).toBeTruthy()
      expect(Number.isInteger(row.employees) && row.employees >= 0).toBeTruthy()
      expect(typeof row.emailOptOut).toBe("boolean")
      // Every custom key the definitions declare, exactly.
      expect(
        Object.keys(row).filter((k) => ORGANIZATION_CUSTOM_FIELDS.some((f) => f.name === k)).sort(),
      ).toEqual(ORGANIZATION_CUSTOM_FIELDS.map((f) => f.name).sort())
    }
    expect(names.size, "organization names are distinct").toBe(COUNTS.organizations)
  })

  it("50 contacts: marked externalIds, 1:1 organization links, valid custom values", () => {
    for (let i = 1; i <= COUNTS.contacts; i++) {
      const row = contactRow(i)
      expect(row.externalId).toBe(`demo:contact:${i}`)
      expect(row.organizationExternalId).toBe(`demo:organization:${i}`)
      expect(row.email.includes("@example.test")).toBeTruthy()
      expect(row.name.length > 0).toBeTruthy()
    }
  })

  it("5 contracts: deterministic distinct titles, integer minor units, ISO 8601 signedAt", () => {
    const titles = demoContractTitles()
    expect(titles.length).toBe(COUNTS.contracts)
    expect(new Set(titles).size, "the titles the wipe matches by are distinct").toBe(COUNTS.contracts)
    for (let j = 1; j <= COUNTS.contracts; j++) {
      const row = contractRow(j)
      expect(row.title).toBe(titles[j - 1]!)
      expect(Number.isInteger(row.amount)).toBeTruthy()
      expect(row.currency).toMatch(/^[A-Z]{3}$/)
      if (row.signedAt !== null) {
        expect(row.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      }
      expect(row.partyExternalId).toBe(`demo:organization:${j * 10}`)
    }
  })

  it("every custom value passes the kernel's value policy (type, options, caps)", () => {
    const valueOf = (defs: typeof ORGANIZATION_CUSTOM_FIELDS, name: string) => defs.find((f) => f.name === name)
    const checkValues = (defs: typeof ORGANIZATION_CUSTOM_FIELDS, values: Record<string, unknown>) => {
      expect(Object.keys(values).length <= MAX_CUSTOM_KEYS).toBeTruthy()
      expect(JSON.stringify(values).length <= MAX_CUSTOM_BYTES).toBeTruthy()
      for (const [name, value] of Object.entries(values)) {
        const def = valueOf(defs, name)! // the expect below still fails on a missing definition
        expect(def, `custom key ${name} has a definition`).toBeTruthy()
        if (value === "" || value === null || value === undefined) {
          expect(!def.required, `required ${name} is never emptied`).toBeTruthy()
          continue
        }
        switch (def.fieldType) {
          case "text":
            expect(typeof value, `${name} is text`).toBe("string")
            expect((value as string).length <= 1000).toBeTruthy()
            break
          case "number":
            expect(Number.isFinite(Number(value)), `${name} is numeric`).toBeTruthy()
            break
          case "bool":
            expect(typeof value, `${name} is boolean`).toBe("boolean")
            break
          case "select":
            expect(def.options.includes(value as string), `${name}=${value} is one of the options`).toBeTruthy()
            break
          case "date":
            expect(String(value)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            break
        }
      }
    }
    for (let i = 1; i <= COUNTS.organizations; i++) {
      const row = organizationRow(i) as Record<string, unknown>
      checkValues(
        ORGANIZATION_CUSTOM_FIELDS,
        Object.fromEntries(ORGANIZATION_CUSTOM_FIELDS.map((f) => [f.name, row[f.name]])),
      )
    }
    for (let i = 1; i <= COUNTS.contacts; i++) checkValues(CONTACT_CUSTOM_FIELDS, contactRow(i).custom)
  })

  it("required custom fields always carry a value (create mode refuses empties)", () => {
    for (let i = 1; i <= COUNTS.organizations; i++) {
      const row = organizationRow(i) as Record<string, unknown>
      for (const f of ORGANIZATION_CUSTOM_FIELDS.filter((d) => d.required)) {
        expect(row[f.name] !== "" && row[f.name] !== null && row[f.name] !== undefined, `${f.name} on org ${i}`).toBeTruthy()
      }
    }
  })
})
