// Pure builders for the vtiger structural export: the SQL and the column list
// for one entity, nothing else. Kept free of I/O so the tests can assert on the exact
// SQL without a database.
//
// The join shape is the vtiger 5.4 entity model: crmentity (registry, holds `deleted`)
// JOIN base table (inner: no crmentity row, no entity) LEFT JOIN the `*cf` companion
// LEFT JOIN the address block, on the entity id that equals crmentity.crmid. Only active
// rows (deleted = 0) ever leave.
// No row value is ever read here.

import * as Schema from "effect/Schema"

/** The two entities this export knows. */
export const ENTITIES = ["accounts", "contacts"] as const

/** An entity name decoded at the boundary (argv); anything else is refused there. */
export const Entity = Schema.Literal(...ENTITIES)
export type Entity = typeof Entity.Type

type Builder = {
  from: string[]
  columns: string[]
  cfTable: string
  cfKey: string
}

const ACCOUNT_COLUMNS = [
  'e.crmid AS "vtigerId"',
  "a.accountid",
  "a.account_no",
  "a.accountname",
  "a.account_type",
  "a.industry",
  "a.rating",
  "a.ownership",
  "a.employees",
  "a.emailoptout",
  "a.phone",
  "a.email1",
  "a.website",
  "b.bill_street",
  "b.bill_city",
  "b.bill_code",
  "b.bill_country",
  "e.description",
]

const CONTACT_COLUMNS = [
  'e.crmid AS "vtigerId"',
  "d.contactid",
  "d.contact_no",
  "d.salutation",
  "d.firstname",
  "d.lastname",
  "d.accountid",
  "d.email",
  "d.phone",
  "d.mobile",
  "d.title",
  "d.department",
  "ad.mailingstreet",
  "ad.mailingcity",
  "ad.mailingstate",
  "ad.mailingcountry",
  "ad.mailingzip",
  "e.description",
]

// The cf_* companions are pulled wholesale (aliased as-is): the per-field profile on the
// staging side is what decides which of them carry data, and that decision belongs to the
// owner, not to this query.
const BUILDERS: Record<Entity, Builder> = {
  accounts: {
    from: [
      "FROM vtiger_crmentity e",
      "JOIN vtiger_account a ON a.accountid = e.crmid",
      "LEFT JOIN vtiger_accountscf c ON c.accountid = e.crmid",
      "LEFT JOIN vtiger_accountbillads b ON b.accountaddressid = e.crmid",
    ],
    columns: ACCOUNT_COLUMNS,
    cfTable: "c",
    cfKey: "accountid",
  },
  contacts: {
    from: [
      "FROM vtiger_crmentity e",
      "JOIN vtiger_contactdetails d ON d.contactid = e.crmid",
      "LEFT JOIN vtiger_contactscf c ON c.contactid = e.crmid",
      "LEFT JOIN vtiger_contactaddress ad ON ad.contactaddressid = e.crmid",
    ],
    columns: CONTACT_COLUMNS,
    cfTable: "c",
    cfKey: "contactid",
  },
}

/** The SELECT for one entity: the exact SQL, its COUNT(*) variant, and the column list. */
export type BuiltQuery = { sql: string; countSql: string; columns: string[] }

/**
 * The SELECT for one entity. `cfColumns` are the cf_* column names (from SHOW COLUMNS on
 * the companion table, read at runtime by the exporter -- never hard-coded here, because
 * custom fields differ per install).
 */
export const buildQuery = (entity: Entity, cfColumns?: readonly string[] | null): BuiltQuery => {
  const b = BUILDERS[entity]
  // Base column names, unquoted (the base selects are already table-qualified).
  const baseNames = new Set(b.columns.map((c) => c.replace(/^[a-z]+\./, "").replace(/ AS .*$/, "")))
  // Every cf select is explicitly aliased. If a custom-field column ever shares a base
  // column's name, it is re-prefixed `cf_` so it cannot silently overwrite the base value.
  const cfSelects = (cfColumns ?? [])
    .filter((c) => c !== b.cfKey)
    .map((c) => `${b.cfTable}.\`${c}\` AS \`${baseNames.has(c) ? `cf_${c}` : c}\``)
  const columns = [...b.columns, ...cfSelects]
  const sql = ["SELECT", columns.map((c) => `  ${c}`).join(",\n"), ...b.from, "WHERE e.deleted = 0"].join("\n")
  const countSql = [...b.from, "WHERE e.deleted = 0"].join("\n").replace(/^FROM/, "SELECT COUNT(*) AS n\nFROM")
  return { sql, countSql, columns }
}

/** SHOW COLUMNS on the cf companion table, reduced to the cf_* names. */
export const cfColumnQuery = (entity: Entity): string => {
  const table = entity === "accounts" ? "vtiger_accountscf" : "vtiger_contactscf"
  return `SHOW COLUMNS FROM \`${table}\``
}
