import { expect, it } from "@effect/vitest"
import * as Option from "effect/Option"
import { planRow } from "./vtiger-map-plan.ts"
import type { MapFile } from "./vtiger-map-pure.ts"

const contacts: MapFile = {
  key: "vtigerId",
  map: { lastname: "name" },
  entity: "contacts",
  route: "/contacts",
  accountKey: "accountid",
}

it("plans each line: blank, broken, skipped, or a write carrying its identity", () => {
  expect(planRow("  ", contacts)).toEqual({ _tag: "Blank" })
  expect(planRow("{not json", contacts)).toEqual({ _tag: "Broken" })
  expect(planRow(`{"lastname":"Pop"}`, contacts)).toEqual({ _tag: "Skipped", counter: "skippedNoKey" })
  expect(planRow(`{"vtigerId":7,"lastname":""}`, contacts)).toEqual({ _tag: "Skipped", counter: "skipped" })
  expect(planRow(`{"vtigerId":7,"lastname":"Pop","accountid":"0"}`, contacts)).toEqual({
    _tag: "Write", externalId: "vtiger:7", payload: { name: "Pop" }, orgKey: Option.none(),
  })
  expect(planRow(`{"vtigerId":7,"lastname":"Pop"}`, { ...contacts, entity: "accounts" })).toEqual({
    _tag: "Write", externalId: "vtiger:7", payload: { name: "Pop" },
  })
})
