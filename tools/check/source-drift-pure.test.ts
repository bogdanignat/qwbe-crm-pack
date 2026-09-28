import { expect, it } from "@effect/vitest"
import { shelfVerdict, summaryLine, verdictLine } from "./source-drift-pure.ts"

const staged = { name: "crm-pack", status: "ok", stagedAt: "2026-09-27" } as const

it("a shelf staged from this repo is ok; from a scratch copy it is red", () => {
  expect(shelfVerdict({ ...staged, sourcePath: "/repo" }, "/repo")).toEqual({
    name: "crm-pack",
    ok: true,
    detail: "staged 2026-09-27 from /repo",
  })
  expect(shelfVerdict({ ...staged, sourcePath: "/tmp/copy" }, "/repo").ok).toBe(false)
})

it("a kernel red keeps its detail and counts in the summary", () => {
  const red = shelfVerdict({ name: "crm-pack", status: "drifted", detail: "shelf changed" }, "/repo")
  expect(verdictLine(red)).toBe("  RED  crm-pack  shelf changed")
  expect(summaryLine([red, { name: "x", ok: true, detail: "" }])).toBe("source-drift: FAIL (1 red)")
  expect(summaryLine([])).toBe("source-drift: PASS")
})
