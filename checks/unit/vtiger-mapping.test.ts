// vtiger row mapping.
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import { externalKey, Mapping, mapRow, rowKey } from "../../tools/vtiger/vtiger-map-lib.ts"

const here = new URL(".", import.meta.url)
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, here).pathname, "utf8"))

const accountsMapping = Schema.decodeUnknownSync(Mapping)(readJson("../../mappings/accounts.json"))
const contactsMapping = Schema.decodeUnknownSync(Mapping)(readJson("../../mappings/contacts.json"))
const accountsFixture = readJson("../_fixtures/vtiger/accounts.fixture.json") as ReadonlyArray<Record<string, unknown>>
const contactsFixture = readJson("../_fixtures/vtiger/contacts.fixture.json") as ReadonlyArray<Record<string, unknown>>

// These rows all map: a rejected row fails the test here.
const payloadOf = Either.getOrThrow

it.effect("maps an account fixture row to the cube payload", () =>
  Effect.sync(() => {
    const payload = payloadOf(mapRow(accountsFixture[0]!, accountsMapping))
    expect(payload.name).toBe("Alpha Trading SRL")
    expect(payload.organizationNo).toBe("FIX-ACC-1")
    expect(payload.organizationType).toBe("Customer")
    expect(payload.employees).toBe(12)
    expect(payload.emailOptOut).toBe(false)
    expect(payload.billingCity).toBe("OrasulExemplu")
    expect(payload.email).toBe("office@alpha-trading.example")
    // cf columns and dropped fields never reach the payload
    expect(payload.cf_638).toBeUndefined()
    expect(payload.annualrevenue).toBeUndefined()
    expect(payload.parentid).toBeUndefined()
  }),
)

it.effect("coerces the varchar(3) opt-out flag to a real boolean", () =>
  Effect.sync(() => {
    const payload = payloadOf(mapRow(accountsFixture[1]!, accountsMapping))
    expect(payload.emailOptOut).toBe(true)
    expect(payload.employees).toBe(null)
  }),
)

it.effect("joins the contact name from firstname + lastname and keeps email as a string", () =>
  Effect.sync(() => {
    const payload = payloadOf(mapRow(contactsFixture[0]!, contactsMapping))
    expect(payload.name).toBe("Andrei Exemplu")
    expect(payload.email).toBe("andrei@alpha-trading.example")
    expect(payload.organizationId).toBeUndefined() // resolved by the tool from the externalId lookup, not here
  }),
)

it.effect("rejects a non-integer in an integer column, naming the column only", () =>
  Effect.sync(() => {
    const result = mapRow({ ...accountsFixture[0]!, employees: "twelve" }, accountsMapping)
    expect(Either.isLeft(result) && result.left.message).toBe("employees is not an integer")
  }),
)

it.effect("keeps the row key stable", () =>
  Effect.sync(() => {
    expect(rowKey(accountsFixture[0]!, accountsMapping)).toBe("900001")
    expect(rowKey({}, accountsMapping)).toBe(null)
  }),
)

it.effect("builds the external identity a row is stored under (QWB-54, ticket 13)", () =>
  Effect.sync(() => {
    // "vtiger:<crmid>": one name for source system and source row, guarded by the unique
    // index in the database. A row without its key has no external identity at all.
    expect(externalKey(accountsFixture[0]!, accountsMapping)).toBe("vtiger:900001")
    expect(externalKey({ vtigerId: 12 }, accountsMapping)).toBe("vtiger:12")
    expect(externalKey({}, accountsMapping)).toBe(null)
  }),
)