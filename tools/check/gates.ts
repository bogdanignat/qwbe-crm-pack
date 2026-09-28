import { gateFindings, type Step } from "./steps.ts"

export type GateSpec = { readonly name: string; readonly steps: ReadonlyArray<Step> }

const CUBE_TESTS = [
  "cubes/crm/contact-groups/index.test.ts",
  "cubes/crm/contacts/index.test.ts",
  "cubes/crm/contracts/index.test.ts",
  "cubes/crm/organizations/index.test.ts",
]

// The gate list, in run order.
export const GATES: ReadonlyArray<GateSpec> = [
  { name: "typecheck", steps: [["npm", "run", "typecheck"]] },
  { name: "lint", steps: [["npx", "eslint", "."]] },
  {
    name: "test",
    steps: [
      ["npx", "vitest", "run"],
      ["node", "--test", ...CUBE_TESTS],
    ],
  },
  {
    name: "secrets",
    steps: [["gitleaks", "git", ".", "--log-opts=origin/main..HEAD", "--no-banner", "--redact"]],
  },
]

// Opt-in gates, after the list above: `--live` boots real servers, `--drift` compares against the
// qwbe sources. Plain `check` runs neither.
const LIVE: GateSpec = {
  name: "live",
  steps: [["npx", "vitest", "run", "--config", "vitest.live.config.ts"]],
}
const DRIFT: GateSpec = { name: "drift", steps: [["node", "tools/check/source-drift.ts"]] }

export const gateList = (live: boolean, drift: boolean): ReadonlyArray<GateSpec> => [
  ...GATES,
  ...(live ? [LIVE] : []),
  ...(drift ? [DRIFT] : []),
]

// Every gate `check` runs, each bound to the repo at `root` (with a trailing slash).
export const gatesFor = (root: string, live: boolean, drift: boolean) =>
  gateList(live, drift).map(({ name, steps }) => ({ name, findings: gateFindings(root, steps) }))
