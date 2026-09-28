import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

// Either of `--live`, `--drift`; anything else is refused before a gate runs.
const Flags = Schema.Array(Schema.Literal("--live", "--drift"))

export const flagsFrom = (argv: ReadonlyArray<string>) =>
  Effect.map(Schema.decodeUnknown(Flags)(argv), (flags) => ({
    live: flags.includes("--live"),
    drift: flags.includes("--drift"),
  }))