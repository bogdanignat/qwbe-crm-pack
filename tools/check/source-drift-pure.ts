import { resolve } from "node:path"
import * as Schema from "effect/Schema"

// The kernel's shelfDrift answer. It comes from another checkout, so it is decoded, never trusted.
export const ShelfDrift = Schema.Struct({
  name: Schema.String,
  status: Schema.Literal("ok", "no-provenance", "source-missing", "drifted"),
  sourcePath: Schema.optional(Schema.String),
  stagedAt: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
})
export type ShelfDrift = typeof ShelfDrift.Type

export type Verdict = { readonly name: string; readonly ok: boolean; readonly detail: string }

export const verdictLine = ({ name, ok, detail }: Verdict) => `  ${ok ? "ok" : "RED"}  ${name}  ${detail}`

export const summaryLine = (verdicts: ReadonlyArray<Verdict>) => {
  const red = verdicts.filter(({ ok }) => !ok).length
  return red === 0 ? "source-drift: PASS" : `source-drift: FAIL (${red} red)`
}

// The kernel's verdict plus the one pack-side rule it cannot know: the shelf must have been staged
// from THIS repo (`repo`, a real path), never from a scratch copy.
export const shelfVerdict = (drift: ShelfDrift, repo: string): Verdict => {
  const fromRepo = drift.status === "ok" && resolve(drift.sourcePath ?? "") === repo
  return {
    name: drift.name,
    ok: fromRepo,
    detail:
      drift.status !== "ok"
        ? (drift.detail ?? "")
        : fromRepo
          ? `staged ${drift.stagedAt} from ${drift.sourcePath}`
          : `staged from "${drift.sourcePath}" - a scratch copy, not this repo`,
  }
}
