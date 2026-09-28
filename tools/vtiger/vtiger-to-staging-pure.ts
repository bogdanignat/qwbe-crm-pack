// Decisions of the staging upload, free of I/O: the argv, the chunk cap, and how numbered lines
// group into chunks. The staging cube's contract: a chunk is whole lines, at most
// MAX_CHUNK_CHARS (2,000,000) characters, and carries the absolute number of its first line.
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

export const USAGE = "usage: node tools/vtiger/vtiger-to-staging.ts <file.jsonl> [setName]"

/** `<file.jsonl> [setName]`; words after the set name are ignored, as they always were. */
export const Args = Schema.Tuple([Schema.NonEmptyString], Schema.String)

export const setName = (baseName: string, name: string | undefined) => name ?? baseName.replace(/\.jsonl$/, "")

// 1.9M chars: safely under the cube's 2,000,000-char cap. QWB50_MAX_CHARS exists so the tests
// can force real chunk boundaries and rejections; unset, zero or not a number means the default.
export const maxChars = (raw: string) => Number(raw) || 1_900_000

export interface Line {
  readonly no: number
  readonly text: string
}

export interface Batch {
  readonly from: number
  readonly to: number
  readonly lines: Chunk.Chunk<string>
}

const empty: Batch = { from: 0, to: 0, lines: Chunk.empty() }

// Whole lines, grouped until the next one would pass `max`; the line that would is the next
// batch's first. Oversized lines are dropped before this sink.
const batches = (max: number) =>
  Sink.foldWeighted<Batch, Line>({
    initial: empty,
    maxCost: max,
    cost: (_, line) => line.text.length + 1,
    body: (batch, line) => ({
      from: Chunk.isEmpty(batch.lines) ? line.no : batch.from,
      to: line.no,
      lines: Chunk.append(batch.lines, line.text),
    }),
  })

export const batchText = (batch: Batch) => Chunk.join(batch.lines, "\n")

/** The file's lines (numbered from 1) as batches. A line that with its separator alone passes
 *  the cap can never be posted: it is counted in `oversized` and skipped. */
export const toBatches = <E, R>(lines: Stream.Stream<string, E, R>, max: number, oversized: Ref.Ref<number>) =>
  lines.pipe(
    Stream.zipWithIndex,
    Stream.map(([text, i]): Line => ({ no: i + 1, text })),
    Stream.filterEffect((line) =>
      line.text.length + 1 > max ? Effect.as(Ref.update(oversized, (n) => n + 1), false) : Effect.succeed(true)),
    Stream.transduce(batches(max)),
    Stream.filter((batch) => !Chunk.isEmpty(batch.lines)),
  )

/** The rows the staging cube parsed from one chunk, and the lines it counted malformed. */
export interface ChunkReply {
  readonly parsed?: number | undefined
  readonly malformed?: ReadonlyArray<unknown> | undefined
}

export const noTotals = { parsed: 0, malformed: 0 }

export const addChunk = (totals: typeof noTotals, reply: ChunkReply) => ({
  parsed: totals.parsed + (reply.parsed ?? 0),
  malformed: totals.malformed + (reply.malformed?.length ?? 0),
})

/** A rejected chunk must not abort silently: the range and set id say where to resume. */
export const chunkFailure = (batch: Batch, setId: string, reason: string) =>
  `chunk FAILED: lines ${batch.from}-${batch.to} (set ${setId}): ${reason}\n` +
  `resume from line ${batch.from}; nothing after it was uploaded`

export const uploadLines = (
  setId: string,
  state: { readonly rowCount: number; readonly malformedCount: number },
  totals: typeof noTotals,
  oversized: number,
): ReadonlyArray<string> => [
  `set id:        ${setId}`,
  `rows:          ${state.rowCount}`,
  `malformed:     ${state.malformedCount}`,
  `chunks parsed: ${totals.parsed} rows, ${totals.malformed} malformed lines counted`,
  ...(oversized === 0 ? [] : [`oversized:     ${oversized} single lines larger than the chunk cap were refused, not posted`]),
]
