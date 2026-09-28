import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { flagsFrom } from "./args.ts"

it.effect("decodes --live alone", () =>
  Effect.gen(function* () {
    const flags = yield* flagsFrom(["--live"])
    expect(flags).toEqual({ live: true, drift: false })
  }),
)

it.effect("decodes both flags", () =>
  Effect.gen(function* () {
    const flags = yield* flagsFrom(["--live", "--drift"])
    expect(flags).toEqual({ live: true, drift: true })
  }),
)

it.effect("decodes no flag", () =>
  Effect.gen(function* () {
    const flags = yield* flagsFrom([])
    expect(flags).toEqual({ live: false, drift: false })
  }),
)

it.effect("refuses an unknown flag", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(flagsFrom(["--live", "--bench"]))
    expect(exit._tag).toBe("Failure")
  }),
)