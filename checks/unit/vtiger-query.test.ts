// vtiger export query builders.
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Schema from "effect/Schema"
import { buildQuery, cfColumnQuery, ENTITIES, Entity } from "../../tools/vtiger/vtiger-export-query.ts"

it.effect("knows exactly the two entities", () =>
  Effect.sync(() => expect(ENTITIES).toEqual(["accounts", "contacts"])),
)

it.effect("joins crmentity, base table, cf companion and address block, active rows only", () =>
  Effect.sync(() => {
    const { sql, countSql } = buildQuery("accounts", ["accountid", "cf_638", "cf_658"])
    expect(sql).toMatch(/JOIN vtiger_account a ON a\.accountid = e\.crmid/)
    expect(sql).toMatch(/LEFT JOIN vtiger_accountscf c ON c\.accountid = e\.crmid/)
    expect(sql).toMatch(/LEFT JOIN vtiger_accountbillads b ON b\.accountaddressid = e\.crmid/)
    expect(sql).toMatch(/WHERE e\.deleted = 0/)
    expect(sql).toMatch(/c\.`cf_638`/)
    expect(sql).not.toMatch(/SELECT \*/)
    expect(countSql).toMatch(/SELECT COUNT\(\*\) AS n/)
    expect(countSql).toMatch(/WHERE e\.deleted = 0/)
  }),
)

it.effect("joins the contacts tables and leaves the cf key column out of the selects", () =>
  Effect.sync(() => {
    const { sql, columns } = buildQuery("contacts", ["contactid", "cf_640"])
    expect(sql).toMatch(/JOIN vtiger_contactdetails d ON d\.contactid = e\.crmid/)
    expect(sql).toMatch(/LEFT JOIN vtiger_contactaddress ad ON ad\.contactaddressid = e\.crmid/)
    expect(columns.some((c) => c.includes("cf_640"))).toBe(true)
    expect(columns.some((c) => c === "c.`contactid`")).toBe(false)
  }),
)

it.effect("refuses an unknown entity and exposes the cf column discovery query", () =>
  Effect.sync(() => {
    expect(Either.isLeft(Schema.decodeUnknownEither(Entity)("leads"))).toBe(true)
    expect(cfColumnQuery("accounts")).toMatch(/SHOW COLUMNS FROM `vtiger_accountscf`/)
    expect(cfColumnQuery("contacts")).toMatch(/SHOW COLUMNS FROM `vtiger_contactscf`/)
  }),
)