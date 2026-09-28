import { expect, it } from "@effect/vitest"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { batchText, toBatches } from "./vtiger-to-staging-pure.ts"

const run = (lines: ReadonlyArray<string>, max: number) =>
  Effect.gen(function* () {
    const oversized = yield* Ref.make(0)
    const batches = yield* Stream.runCollect(toBatches(Stream.fromIterable(lines), max, oversized))
    return {
      batches: Chunk.toReadonlyArray(batches).map((b) => ({ from: b.from, to: b.to, text: batchText(b) })),
      oversized: yield* Ref.get(oversized),
    }
  })

it.effect("groups whole lines under the cap and numbers each batch by its own first line", () =>
  Effect.gen(function* () {
    // each line costs 4 (3 chars + separator); a cap of 8 holds exactly two
    const result = yield* run(["aaa", "bbb", "ccc", "ddd", "eee"], 8)
    expect(result.batches).toEqual([
      { from: 1, to: 2, text: "aaa\nbbb" },
      { from: 3, to: 4, text: "ccc\nddd" },
      { from: 5, to: 5, text: "eee" },
    ])
    expect(result.oversized).toBe(0)
  }),
)

it.effect("counts and skips a line that alone passes the cap, keeping file line numbers", () =>
  Effect.gen(function* () {
    const result = yield* run(["aa", "xxxxxxxxxx", "bb"], 6)
    expect(result.batches).toEqual([{ from: 1, to: 3, text: "aa\nbb" }])
    expect(result.oversized).toBe(1)
  }),
)

it.effect("an empty file yields no batch", () =>
  Effect.gen(function* () {
    expect(yield* run([], 8)).toEqual({ batches: [], oversized: 0 })
  }),
)
