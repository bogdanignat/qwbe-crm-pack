// Decisions of the import verification, free of I/O: the argv, the organization a contact line
// points at, and the count line. Counts only, never a row value.
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export const USAGE =
  "usage: node tools/vtiger/vtiger-verify.ts <accounts.jsonl> [contacts.jsonl] [--set-accounts ID] [--set-contacts ID]"

const Args = Schema.Struct({
  accountsFile: Schema.NonEmptyString,
  contactsFile: Schema.optional(Schema.String),
  setAccounts: Schema.optional(Schema.String),
  setContacts: Schema.optional(Schema.String),
})

export type VerifyArgs = typeof Args.Type

const FLAGS = ["--set-accounts", "--set-contacts"] as const

/** Positional files plus the two set flags; a flag's value is never taken for a file. */
export const verifyArgs = (argv: ReadonlyArray<string>) => {
  const valueAt = FLAGS.map((flag) => argv.indexOf(flag)).filter((i) => i > -1).map((i) => i + 1)
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valueAt.includes(i))
  const flag = (name: (typeof FLAGS)[number]) => {
    const i = argv.indexOf(name)
    return i > -1 ? argv[i + 1] : undefined
  }
  return Schema.decodeUnknownOption(Args)({
    accountsFile: positional[0],
    contactsFile: positional[1],
    setAccounts: flag("--set-accounts"),
    setContacts: flag("--set-contacts"),
  })
}

const ContactLine = Schema.parseJson(Schema.Struct({ accountid: Schema.optional(Schema.Unknown) }))

/** The vtiger organization id a contact line points at; none for blank or broken lines and for
 *  the "no organization" markers (null, 0, empty). */
export const orgOf = (line: string): Option.Option<string> =>
  line.trim() === ""
    ? Option.none()
    : Option.flatMap(Schema.decodeUnknownOption(ContactLine)(line), ({ accountid }) => {
      const org = accountid === undefined || accountid === null ? "" : String(accountid)
      return org === "" || org === "0" ? Option.none() : Option.some(org)
    })

const shown = (n: Option.Option<number>) => Option.match(n, { onNone: () => "n/a", onSome: String })
const diff = (n: Option.Option<number>, exported: number) => shown(Option.map(n, (v) => v - exported))

export const countLine = (label: string, exported: number, staged: Option.Option<number>, inQwbe: Option.Option<number>) =>
  `${label}: exported=${exported} staging=${shown(staged)} (diff ${diff(staged, exported)}) ` +
  `qwbe=${shown(inQwbe)} (diff ${diff(inQwbe, exported)}; whole-cube total -- assume the cube held nothing before this import, otherwise the diff is off by that)`

export const orgToContactLine = (withOrg: number, imported: number, missing: number) =>
  `org-to-contact: contacts with an organization=${withOrg} organization imported=${imported} organization missing=${missing}`
