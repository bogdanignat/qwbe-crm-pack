// CRM cubes against a real server (create/list/get)
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin, asReader } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"

// The pack's cubes over one server, in the probe's order: later checks find the rows earlier ones
// created (by the searchable `name` filter), so the totals below count this file's rows only.
// Rows are private to their owner since the kernel's row visibility (permissions cube): the reader
// keeps its list route (200) but sees no admin row without a grant, so rows are read as the owner.

const SERVER = { timeout: 60_000, excludeTestServices: true } as const
const ADA = "/contacts?name=Ada%20Ionescu"
const ORG = "/organizations?name=Ada%20Industries%20SRL"

const Page = Schema.Struct({ rows: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })) })
const Output = Schema.Struct({ output: Schema.String })
const Cubes = Schema.Array(Schema.Struct({ name: Schema.String }))

const firstId = (path: string) =>
  asAdmin.pipe(
    Effect.flatMap((admin) => admin.get(path)),
    Effect.flatMap((reply) => Effect.orDie(Schema.decodeUnknown(Page)(reply.body))),
    Effect.map(({ rows }) => rows[0].id),
  )

const post = (path: string, body: unknown) => Effect.flatMap(asAdmin, (admin) => admin.send("POST", path, body))
const patch = (path: string, body: unknown) => Effect.flatMap(asAdmin, (admin) => admin.send("PATCH", path, body))
const read = (path: string) => Effect.flatMap(asAdmin, (admin) => admin.get(path))
const readerStatus = (path: string) => Effect.flatMap(asReader, (reader) => reader.status(path))

layer(testServer("crm-crud", {}, plantCrmPack), SERVER)((it) => {
  it.effect("the crm cubes are mounted", () =>
    Effect.gen(function* () {
      const { body } = yield* (yield* asAdmin).get("/settings/cubes")
      const names = (yield* Effect.orDie(Schema.decodeUnknown(Cubes)(body))).map(({ name }) => name)
      expect(names).toEqual(expect.arrayContaining(["crm", "crm/organizations", "crm/contacts", "crm/contracts"]))
    }))

  it.effect("admin creates a contact", () =>
    Effect.gen(function* () {
      const reply = yield* post("/contacts", { name: "Ada Ionescu", email: "ada@example.com", company: "Ada SRL" })
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ type: "Contact" })
      expect(reply.body).toHaveProperty("id", expect.any(String))
    }))

  it.effect("reader lists contacts", () =>
    Effect.gen(function* () {
      expect(yield* readerStatus("/contacts")).toBe(200)
      expect((yield* read("/contacts")).body).toMatchObject({ total: 1, rows: [{ name: "Ada Ionescu" }] })
    }))

  it.effect("company stays free text on the contact (no organization entity folded in)", () =>
    Effect.gen(function* () {
      const reply = yield* read(`/contacts/${yield* firstId(ADA)}`)
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ company: "Ada SRL" })
    }))

  it.effect("fractional minor units are refused at the schema edge (400)", () =>
    Effect.map(post("/contracts", { title: "Bad money", amount: 12.5, currency: "RON" }), ({ status }) =>
      expect(status).toBe(400)))

  it.effect("admin creates contracts in minor units", () =>
    Effect.gen(function* () {
      const partyId = yield* firstId(ADA)
      const c1 = yield* post("/contracts", { title: "Maintenance 2026", amount: 15050, currency: "RON", partyId })
      const c2 = yield* post("/contracts", { title: "Hosting", amount: 9900, currency: "EUR" })
      expect([c1.status, c2.status]).toEqual([200, 200])
      expect([c1.body, c2.body]).toMatchObject([{ amount: 15050 }, { amount: 9900 }])
    }))

  it.effect("the minimal relation: partyId stored opaque and nullable", () =>
    Effect.gen(function* () {
      const partyId = yield* firstId(ADA)
      const { body } = yield* read("/contracts")
      expect(body).toHaveProperty("rows", expect.arrayContaining([
        expect.objectContaining({ title: "Maintenance 2026", partyId }),
        expect.objectContaining({ title: "Hosting", partyId: null }),
      ]))
    }))

  it.effect("reader lists contracts", () =>
    Effect.gen(function* () {
      expect(yield* readerStatus("/contracts")).toBe(200)
      expect((yield* read("/contracts")).body).toMatchObject({ total: 2 })
    }))

  it.effect("contracts:value renders per currency, never a cross-currency sum", () =>
    Effect.gen(function* () {
      const reply = yield* post("/cli/exec", { line: "crm/contracts:value" })
      expect(reply.status).toBe(200)
      const { output } = yield* Effect.orDie(Schema.decodeUnknown(Output)(reply.body))
      expect(output).toContain("150.50 RON")
      expect(output).toContain("99.00 EUR")
      expect(output).not.toContain("249.50")
    }))

  it.effect("admin creates an organization", () =>
    Effect.gen(function* () {
      const reply = yield* post("/organizations", {
        name: "Ada Industries SRL", industry: "manufacturing", website: "https://ada.example.com",
        billingCity: "Iasi", employees: 42,
      })
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ type: "Organization", employees: 42 })
      expect(reply.body).toHaveProperty("id", expect.any(String))
    }))

  it.effect("admin updates an organization (patch keeps the rest)", () =>
    Effect.gen(function* () {
      const reply = yield* patch(`/organizations/${yield* firstId(ORG)}`, { billingCity: "Cluj", rating: "active" })
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ billingCity: "Cluj", name: "Ada Industries SRL" })
    }))

  it.effect("organizations list pages and sorts", () =>
    Effect.map(read("/organizations?limit=1&sortBy=name"), ({ status, body }) => {
      expect(status).toBe(200)
      expect(body).toMatchObject({ rows: [{}], total: 1, sortedBy: "name" })
    }))

  it.effect("filtering organizations by name returns exactly the matching one", () =>
    Effect.gen(function* () {
      const second = yield* post("/organizations", { name: "Beta Constructions SRL", industry: "construction" })
      const { status, body } = yield* read(ORG)
      expect([second.status, status]).toEqual([200, 200])
      expect(body).toMatchObject({ total: 1, rows: [{ name: "Ada Industries SRL" }] })
    }))

  it.effect("contact created with organizationId pointing at an existing organization", () =>
    Effect.gen(function* () {
      const organizationId = yield* firstId(ORG)
      const reply = yield* post("/contacts", { name: "Dan Pop", email: "dan@example.com", organizationId })
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ organizationId })
    }))

  it.effect("contact created without organizationId comes back null", () =>
    Effect.map(post("/contacts", { name: "Maria Radu", email: "maria@example.com" }), ({ status, body }) => {
      expect(status).toBe(200)
      expect(body).toMatchObject({ organizationId: null })
    }))

  it.effect("an organization's contacts are derived by filtering on organizationId", () =>
    Effect.gen(function* () {
      const organizationId = yield* firstId(ORG)
      const { status, body } = yield* read(`/contacts?organizationId=${organizationId}`)
      expect(status).toBe(200)
      expect(body).toMatchObject({ total: 1, rows: [{ name: "Dan Pop", organizationId }] })
    }))

  it.effect("a blank organizationId is refused at the schema edge (400)", () =>
    Effect.map(post("/contacts", { name: "Bad Link", email: "bad@example.com", organizationId: "   " }), ({ status }) =>
      expect(status).toBe(400)))

  // The kernel offers cubes no cross-cube read yet, so this pins today's behaviour: FLIP to 400
  // once the kernel-enforced relation lands.
  it.effect("a nonexistent organizationId is still accepted (kernel relation pending)", () =>
    Effect.map(
      post("/contacts", { name: "Ghost Link", email: "ghost@example.com", organizationId: "org-doesnotexist" }),
      ({ status, body }) => {
        expect(status).toBe(200)
        expect(body).toMatchObject({ organizationId: "org-doesnotexist" })
      },
    ))

  it.effect("PATCH /contacts/:id moves a contact to another organization", () =>
    Effect.gen(function* () {
      const organizationId = yield* firstId(ORG)
      const reply = yield* patch(`/contacts/${yield* firstId(ADA)}`, { organizationId })
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ organizationId })
    }))

  it.effect("PATCH /contacts/:id unlinks a contact (organizationId null)", () =>
    Effect.gen(function* () {
      const reply = yield* patch(`/contacts/${yield* firstId(ADA)}`, { organizationId: null })
      expect(reply.status).toBe(200)
      expect(reply.body).toMatchObject({ organizationId: null })
    }))
})
