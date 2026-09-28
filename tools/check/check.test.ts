import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { flagsFrom } from "../shared/args.ts"
import { GATES, gateList } from "./gates.ts"
import { exitCodeFor, runGates } from "./run-gates.ts"

it.effect("plain check keeps the list; --live and --drift each append one gate", () =>
  Effect.gen(function* () {
    const flags = yield* flagsFrom(["--drift", "--live"])
    expect(gateList(false, false)).toEqual(GATES)
    expect(gateList(flags.live, flags.drift).map(({ name }) => name)).toEqual([
      ...GATES.map(({ name }) => name),
      "live",
      "drift",
    ])
  }),
)

it.effect("all green gives exit 0", () =>
  Effect.gen(function* () {
    const failed = yield* runGates([{ name: "empty", findings: Effect.succeed([]) }])
    expect(exitCodeFor(failed)).toBe(0)
  }),
)

it.effect("one red gate gives exit 1", () =>
  Effect.gen(function* () {
    const failed = yield* runGates([
      { name: "green", findings: Effect.succeed([]) },
      { name: "red", findings: Effect.succeed(["boom"]) },
    ])
    expect(exitCodeFor(failed)).toBe(1)
  }),
)
