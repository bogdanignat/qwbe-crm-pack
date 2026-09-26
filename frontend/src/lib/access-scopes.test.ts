// Unit tests for the access-scope catalogue (Settings > Access groups).
//
// Pure derivation plus an injected fetch: no DOM, no backend, no live server --
// the same boundary the sharing suite tests across. The catalogue contract is
// qwbe's settings cube as verified on 2026-09-26 (core/src/cubes/settings/
// index.ts `GET /settings/cubes`, core/src/http-contracts.ts CubeInfo).

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ACCESS_SCOPE_PREFIX,
  FALLBACK_ACCESS_SCOPES,
  FALLBACK_NOTICE,
  accessScopeLabel,
  accessScopesOf,
  fetchAccessScopes,
  isAccessScope,
  parseCubeCatalogue,
  type CatalogueCube,
} from "./access-scopes.ts"
import { CUBES_PATH } from "./echo.ts"

const row = (over: Partial<CatalogueCube> & { name: string }): CatalogueCube => ({
  enabled: true,
  entity: null,
  ...over,
})

// A catalogue row as the kernel sends it: the full CubeInfo, so the parser is
// exercised against the real shape and not a convenient subset.
const cubeInfo = (over: Record<string, unknown> & { name: string }) => ({
  parent: null,
  prefix: null,
  enabled: true,
  required: false,
  system: false,
  plugin: "crm-pack",
  onDisk: true,
  entity: null,
  screen: true,
  agent: false,
  entityPermissions: true,
  publishes: [],
  links: [],
  ...over,
})

function fetchStub(answer: { status: number; body: unknown }): {
  doFetch: typeof fetch
  calls: string[]
} {
  const calls: string[] = []
  const doFetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { doFetch, calls }
}

describe("which cube names are access scopes of this pack", () => {
  it("accepts the pack root and everything under it, and nothing that merely starts with the letters", () => {
    assert.equal(ACCESS_SCOPE_PREFIX, "crm")
    assert.equal(isAccessScope("crm"), true)
    assert.equal(isAccessScope("crm/contacts"), true)
    assert.equal(isAccessScope("crm/contact-groups"), true)
    assert.equal(isAccessScope("crm-legacy/contacts"), false)
    assert.equal(isAccessScope("permissions"), false)
    assert.equal(isAccessScope("echo"), false)
    assert.equal(isAccessScope(""), false)
  })
})

describe("the scope list of a catalogue answer", () => {
  it("keeps EXACTLY this pack's enabled cubes, in cube-name order, with the API's own names", () => {
    const scopes = accessScopesOf([
      row({ name: "permissions" }),
      row({ name: "crm/organizations", entity: "Organization" }),
      row({ name: "echo" }),
      row({ name: "crm/contact-groups", entity: "ContactGroup" }),
      row({ name: "crm/contacts", entity: "Contact" }),
      row({ name: "crm/contracts", entity: "Contract" }),
    ])
    assert.deepEqual(
      scopes.map((s) => s.cube),
      ["crm/contact-groups", "crm/contacts", "crm/contracts", "crm/organizations"],
    )
  })

  it("drops a disabled cube: a cube that serves no routes has no groups to administer", () => {
    const scopes = accessScopesOf([
      row({ name: "crm/contacts", entity: "Contact" }),
      row({ name: "crm/contracts", enabled: false, entity: "Contract" }),
    ])
    assert.deepEqual(
      scopes.map((s) => s.cube),
      ["crm/contacts"],
    )
  })

  it("labels contact-groups as ACCESS to the group records, never as contact membership", () => {
    const label = accessScopeLabel("crm/contact-groups", "ContactGroup")
    assert.equal(label, "Contact groups (access to the group records)")
    assert.match(label, /access/i)
    assert.doesNotMatch(label, /member/i)
  })

  it("labels a scope this frontend has never heard of by its entity, else by its leaf name", () => {
    assert.equal(accessScopeLabel("crm/tickets", "Ticket"), "Ticket")
    assert.equal(accessScopeLabel("crm/tickets", null), "tickets")
    assert.equal(accessScopeLabel("crm/tickets", ""), "tickets")
    assert.equal(accessScopeLabel("crm", null), "crm")
  })
})

describe("the catalogue boundary", () => {
  it("accepts the kernel's own CubeInfo rows", () => {
    const parsed = parseCubeCatalogue([cubeInfo({ name: "crm/contacts", entity: "Contact" })])
    assert.deepEqual(parsed, [{ name: "crm/contacts", enabled: true, entity: "Contact" }])
  })

  it("refuses the WHOLE answer when one row is not understood: a hidden scope looks like a missing one", () => {
    assert.equal(parseCubeCatalogue(null), null)
    assert.equal(parseCubeCatalogue({ cubes: [] }), null)
    assert.equal(parseCubeCatalogue([cubeInfo({ name: "crm/contacts" }), { name: "crm/contracts" }]), null)
    assert.equal(parseCubeCatalogue([{ name: 7, enabled: true, entity: null }]), null)
    assert.equal(parseCubeCatalogue([{ name: "crm/contacts", enabled: "yes", entity: null }]), null)
    assert.equal(parseCubeCatalogue([{ name: "crm/contacts", enabled: true, entity: 3 }]), null)
    assert.deepEqual(parseCubeCatalogue([]), [])
  })
})

describe("fetchAccessScopes", () => {
  it("reads the live catalogue at the same path the /echo filter uses", async () => {
    const stub = fetchStub({
      status: 200,
      body: [cubeInfo({ name: "crm/contacts", entity: "Contact" }), cubeInfo({ name: "echo", entity: null })],
    })
    const catalogue = await fetchAccessScopes(stub.doFetch)
    assert.deepEqual(stub.calls, [CUBES_PATH])
    assert.equal(CUBES_PATH, "/api/qwbe/settings/cubes")
    assert.equal(catalogue.source, "live")
    assert.equal(catalogue.notice, null)
    assert.deepEqual(
      catalogue.scopes.map((s) => s.cube),
      ["crm/contacts"],
    )
  })

  it("falls back to the built-in scopes ONLY on 403, and says the list is a fallback", async () => {
    const stub = fetchStub({ status: 403, body: { message: "settings:read required" } })
    const catalogue = await fetchAccessScopes(stub.doFetch)
    assert.equal(catalogue.source, "fallback")
    assert.equal(catalogue.notice, FALLBACK_NOTICE)
    assert.deepEqual(catalogue.scopes, FALLBACK_ACCESS_SCOPES)
    // The SAME order a live answer carries (by cube name), so the selector does
    // not reorder itself when the catalogue starts or stops answering.
    assert.deepEqual(
      catalogue.scopes.map((s) => s.cube),
      ["crm/contact-groups", "crm/contacts", "crm/contracts", "crm/organizations"],
    )
    assert.deepEqual(
      catalogue.scopes.map((s) => s.cube),
      [...catalogue.scopes].map((s) => s.cube).sort((a, b) => a.localeCompare(b)),
    )
  })

  it("never turns another failure into the fallback list: it fails visibly", async () => {
    await assert.rejects(
      () => fetchAccessScopes(fetchStub({ status: 500, body: { message: "catalogue exploded" } }).doFetch),
      /catalogue exploded/,
    )
    await assert.rejects(
      () => fetchAccessScopes(fetchStub({ status: 200, body: { cubes: [] } }).doFetch),
      /invalid cube catalogue/,
    )
  })

  it("answers an empty scope list when the installation has none of this pack's cubes enabled", async () => {
    const stub = fetchStub({ status: 200, body: [cubeInfo({ name: "crm/contacts", enabled: false })] })
    const catalogue = await fetchAccessScopes(stub.doFetch)
    assert.equal(catalogue.source, "live")
    assert.deepEqual(catalogue.scopes, [])
  })
})
