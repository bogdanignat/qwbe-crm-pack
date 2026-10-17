// The Organizations detail header (T-1814).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { headerBadgesOf, mailtoOf, organizationTitleOf, updatedLineOf } from "./organization-summary.ts"
import { DEMO_ORGANIZATIONS } from "../mock/organizations/index.ts"

const demo = DEMO_ORGANIZATIONS[0]
const real = { id: "org-1", name: "Acme SRL", organizationNo: null, createdAt: "2026-09-23T17:42:14.860Z", email: null }

describe("organization header", () => {
  it("titles a record [ACC No] Name, or just the name without a number", () => {
    assert.deepEqual(organizationTitleOf(demo), { number: "ACC90001", name: "Exemplu Construct SRL" })
    assert.deepEqual(organizationTitleOf(real), { number: null, name: "Acme SRL" })
  })

  it("says when and by whom it was updated, else when it was created", () => {
    assert.equal(updatedLineOf(demo), "Updated 02.11.2025, 17:40 by Agent Vanzari 1")
    assert.equal(updatedLineOf(real), "Created 23.09.2026, 20:42")
    assert.equal(updatedLineOf({ id: "x" }), null)
  })

  it("shows the company status and the form when they are set", () => {
    assert.deepEqual(headerBadgesOf(demo), [
      { label: "Company status", value: "Activ", tone: "ok" },
      { label: "Form", value: "SRL" },
    ])
    assert.deepEqual(headerBadgesOf(real), [])
  })

  it("mails the organization's email, or nothing without one", () => {
    assert.equal(mailtoOf(demo), "mailto:office@exemplu.test")
    assert.equal(mailtoOf(real), null)
    assert.equal(mailtoOf({ email: "  " }), null)
  })
})
