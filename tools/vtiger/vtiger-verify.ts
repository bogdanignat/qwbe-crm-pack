#!/usr/bin/env node
// Verification of the import: COUNTS only, never a row value.
//
// Per entity it prints: rows exported (non-blank lines of the JSONL), rows in the staging set
// (optional), rows living in qwbe (the organizations count command; the contacts page total),
// and the differences. For the organization-to-contact relation it counts, from the contacts
// export and one externalId lookup per distinct organization, how many contacts point at an
// organization that never made it into qwbe.
//
// Environment: QWBE_URL, QWBE_USER, QWBE_PASSWORD (both credentials required; the tool exits 2
// without them, and fails fast on a rejected login instead of printing n/a counts).
//
// Usage: node tools/vtiger/vtiger-verify.ts <accounts.jsonl> [contacts.jsonl] [--set-accounts ID] [--set-contacts ID]

import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { ApiFailed, call, type Session } from "../shared/api-client.ts"
import { Refused, runTool } from "../shared/run-tool.ts"
import { type QwbeEnv, qwbeEnv } from "./qwbe-env.ts"
import {
  contactOrganizations, contactsInQwbe, exportedRows, organizationImported, organizationsInQwbe, stagedRows,
} from "./vtiger-verify-counts.ts"
import { countLine, orgToContactLine, USAGE, verifyArgs } from "./vtiger-verify-pure.ts"

const Token = Schema.Struct({ token: Schema.NonEmptyString })

/** The session token; a refused login is Refused (exit 1) rather than a page of n/a counts. */
const verifyLogin = (env: QwbeEnv) =>
  Effect.gen(function* () {
    const login = yield* call(env.base, "/auth/login", {
      method: "POST",
      body: { username: env.user, password: Redacted.value(env.password) },
    })
    if (login.status >= 300) {
      return yield* new Refused({ message: `login failed: HTTP ${login.status} -- refusing to print misleading n/a counts`, code: 1 })
    }
    const { token } = yield* Effect.mapError(
      Schema.decodeUnknown(Token)(login.body),
      () => new ApiFailed({ message: "POST /auth/login: reply does not have the expected shape" }),
    )
    return token
  })

// The kernel total is read first, then the file and the staging set, as the count line lists them.
const printCount = <E, R>(label: string, file: string, staged: Effect.Effect<Option.Option<number>, E, R>, inQwbe: typeof staged) =>
  Effect.gen(function* () {
    const kernel = yield* inQwbe
    yield* Console.log(countLine(label, yield* exportedRows(file), yield* staged, kernel))
  })

// One externalId lookup per DISTINCT organization: thousands of contacts share one.
const printOrgToContact = (s: Session, file: string) =>
  Effect.gen(function* () {
    const { withOrg, keys } = yield* contactOrganizations(file)
    const found = yield* Effect.forEach(keys, (org) => organizationImported(s, org))
    const imported = found.filter(Boolean).length
    yield* Console.log(orgToContactLine(withOrg, imported, found.length - imported))
  })

const main = Effect.gen(function* () {
  const args = yield* Effect.orElseFail(verifyArgs(process.argv.slice(2)), () => new Refused({ message: USAGE, code: 2 }))
  const env = yield* qwbeEnv
  const s: Session = { base: env.base, token: yield* verifyLogin(env) }
  yield* printCount("accounts", args.accountsFile, stagedRows(s, args.setAccounts), organizationsInQwbe(s))
  if (args.contactsFile !== undefined) {
    yield* printCount("contacts", args.contactsFile, stagedRows(s, args.setContacts), contactsInQwbe(s))
    yield* printOrgToContact(s, args.contactsFile)
  }
  yield* Console.log("verification: counts only, no row value printed")
  return 0
}).pipe(Effect.provide(FetchHttpClient.layer))

runTool(main, "vtiger-verify failed: ")
