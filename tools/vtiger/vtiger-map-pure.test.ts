import { expect, it } from "@effect/vitest"
import * as Option from "effect/Option"
import { bump, describeFailure, emptyTally, failed, mapArgs, orgKeyOf, rejectedOf } from "./vtiger-map-pure.ts"

it("reads two paths and the value flags, never a flag value as a path", () => {
  expect(mapArgs(["--set", "S1", "a.jsonl", "m.json", "--max-rejects", "3"])).toEqual(
    Option.some({ file: "a.jsonl", mappingPath: "m.json", setId: "S1", maxRejects: 3 }),
  )
  expect(mapArgs(["a.jsonl", "m.json", "--max-rejects"])).toEqual(
    Option.some({ file: "a.jsonl", mappingPath: "m.json", setId: undefined, maxRejects: 0 }),
  )
  for (const argv of [[], ["a.jsonl"], ["a.jsonl", "m.json", "--max-rejects", "-1"], ["a.jsonl", "m.json", "--max-rejects", "1.5"]]) {
    expect(Option.isNone(mapArgs(argv))).toBe(true)
  }
})

it("keeps the first error message and counts every rejection", () => {
  const t = [failed(), failed("first"), failed("second"), bump("skipped"), bump("skippedNoKey")].reduce((acc, f) => f(acc), emptyTally)
  expect(t.firstError).toEqual(Option.some("first"))
  expect(rejectedOf(t)).toBe(5)
})

it("names schema fields, never values, and skips the no-organization markers", () => {
  expect(describeFailure("create accounts", 400, { error: `["employees"] Expected >= 0, actual -7` })).toBe(
    "create accounts: HTTP 400 (field: employees)",
  )
  expect(describeFailure("update contacts", 500, "boom")).toBe("update contacts: HTTP 500")
  expect(orgKeyOf({ accountid: 42 }, "accountid")).toEqual(Option.some("42"))
  for (const v of [null, undefined, 0, "0", ""]) expect(orgKeyOf({ accountid: v }, "accountid")).toEqual(Option.none())
})
