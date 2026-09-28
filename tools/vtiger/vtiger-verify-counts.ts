// Every count the import verification prints, read from the export files or the kernel. A kernel
// reply that is non-2xx or of an unexpected shape is "n/a", not a failure: the count line says so.
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { call, type CallOptions, type Session } from "../shared/api-client.ts"
import { fileLines } from "./export-files.ts"
import { orgOf } from "./vtiger-verify-pure.ts"

const RowCount = Schema.Struct({ rowCount: Schema.Number })
const Output = Schema.Struct({ output: Schema.Union(Schema.Number, Schema.NumberFromString) })
const Total = Schema.Struct({ total: Schema.Number })

const maybe = <A, I>(s: Session, schema: Schema.Schema<A, I>, route: string, options: CallOptions = {}) =>
  Effect.map(call(s.base, route, { ...options, token: s.token }), ({ status, body }) =>
    status < 300 ? Schema.decodeUnknownOption(schema)(body) : Option.none())

/** The non-blank lines of an export file. */
export const exportedRows = (file: string) => Stream.runCount(Stream.filter(fileLines(file), (l) => l.trim() !== ""))

/** The contacts that point at an organization, and the distinct organizations they point at. */
export const contactOrganizations = (file: string) =>
  Stream.runFold(
    Stream.filterMap(fileLines(file), orgOf),
    { withOrg: 0, keys: HashSet.empty<string>() },
    (acc, org) => ({ withOrg: acc.withOrg + 1, keys: HashSet.add(acc.keys, org) }),
  )

export const stagedRows = (s: Session, setId: string | undefined) =>
  setId === undefined
    ? Effect.succeed(Option.none<number>())
    : Effect.map(maybe(s, RowCount, `/staging/sets/${setId}`), Option.map((set) => set.rowCount))

export const organizationsInQwbe = (s: Session) =>
  Effect.map(
    maybe(s, Output, "/cli/exec", { method: "POST", body: { line: "crm/organizations:count" } }),
    Option.map((r) => r.output),
  )

export const contactsInQwbe = (s: Session) => Effect.map(maybe(s, Total, "/contacts?limit=1"), Option.map((r) => r.total))

export const organizationImported = (s: Session, org: string) =>
  Effect.map(
    maybe(s, Total, `/organizations?externalId=${encodeURIComponent(`vtiger:${org}`)}&limit=1`),
    Option.exists((r) => r.total > 0),
  )
