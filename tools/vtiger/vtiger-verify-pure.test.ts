import { expect, it } from "@effect/vitest"
import * as Option from "effect/Option"
import { countLine, orgOf, verifyArgs } from "./vtiger-verify-pure.ts"

it("reads files and set flags, never a flag value as a file", () => {
  expect(verifyArgs(["a.jsonl", "--set-accounts", "S1"])).toEqual(
    Option.some({ accountsFile: "a.jsonl", contactsFile: undefined, setAccounts: "S1", setContacts: undefined }),
  )
  expect(verifyArgs(["a.jsonl", "c.jsonl", "--set-contacts", "S2"])).toEqual(
    Option.some({ accountsFile: "a.jsonl", contactsFile: "c.jsonl", setAccounts: undefined, setContacts: "S2" }),
  )
  expect(Option.isNone(verifyArgs([]))).toBe(true)
  expect(Option.isNone(verifyArgs(["--set-accounts", "S1"]))).toBe(true)
})

it("finds the organization of a contact line, skipping the no-organization markers", () => {
  expect(orgOf(`{"accountid":"42"}`)).toEqual(Option.some("42"))
  expect(orgOf(`{"accountid":7}`)).toEqual(Option.some("7"))
  for (const line of ["", "   ", "not json", "null", `{"accountid":null}`, `{"accountid":"0"}`, `{"accountid":""}`, "{}"]) {
    expect(orgOf(line)).toEqual(Option.none())
  }
})

it("prints n/a for a count it could not read", () => {
  expect(countLine("accounts", 3, Option.none(), Option.some(5))).toMatch(
    /^accounts: exported=3 staging=n\/a \(diff n\/a\) qwbe=5 \(diff 2; whole-cube total/,
  )
})
