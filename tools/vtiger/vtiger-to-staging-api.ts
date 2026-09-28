// The staging cube as the upload sees it: create a set, post one chunk, finish, read the counts.
// Non-2xx: method, path and status only. A rejected chunk's 400 body embeds the whole chunk text
// (raw customer rows) -- never echo any part of a response body.
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { ApiFailed, call, callAs, type Session } from "../shared/api-client.ts"
import { Refused } from "../shared/run-tool.ts"
import { addChunk, type Batch, batchText, chunkFailure, noTotals, toBatches } from "./vtiger-to-staging-pure.ts"

const Created = Schema.Struct({ id: Schema.String })
const Parsed = Schema.Struct({ parsed: Schema.optional(Schema.Number), malformed: Schema.optional(Schema.Array(Schema.Unknown)) })
const SetState = Schema.Struct({ rowCount: Schema.Number, malformedCount: Schema.Number })

/** A new JSONL set; its id. */
const createSet = (s: Session, name: string, sourceFile: string) =>
  Effect.map(
    callAs(Created, s.base, "/staging/sets", { method: "POST", token: s.token, body: { name, format: "jsonl", sourceFile } }),
    (set) => set.id,
  )

/** One chunk, numbered by its first line; a refused chunk is Refused (exit 1) naming where to resume. */
const postBatch = (s: Session, setId: string, batch: Batch) => {
  const path = `/staging/sets/${setId}/chunks`
  return call(s.base, path, { method: "POST", token: s.token, body: { text: batchText(batch), startLine: batch.from } }).pipe(
    Effect.filterOrFail(
      ({ status }) => status < 300,
      ({ status }) => new ApiFailed({ message: `POST ${path} -> HTTP ${status}` }),
    ),
    Effect.flatMap(({ body }) =>
      Effect.mapError(Schema.decodeUnknown(Parsed)(body), () => new ApiFailed({ message: `POST ${path}: unexpected reply shape` }))),
    Effect.mapError(({ message }) => new Refused({ message: chunkFailure(batch, setId, message), code: 1 })),
  )
}

/** Posts the lines as whole-line chunks under `max`, one at a time; the parsed totals and how
 *  many single lines were too large to post at all. */
const uploadChunks = <E, R>(s: Session, setId: string, lines: Stream.Stream<string, E, R>, max: number) =>
  Effect.gen(function* () {
    const oversized = yield* Ref.make(0)
    const totals = yield* toBatches(lines, max, oversized).pipe(
      Stream.mapEffect((batch) => postBatch(s, setId, batch)),
      Stream.runFold(noTotals, addChunk),
    )
    return { totals, oversized: yield* Ref.get(oversized) }
  })

const finishSet = (s: Session, setId: string) =>
  callAs(Schema.Unknown, s.base, `/staging/sets/${setId}/finish`, { method: "POST", token: s.token })

const setState = (s: Session, setId: string) => callAs(SetState, s.base, `/staging/sets/${setId}`, { token: s.token })

/** The whole upload into a new set: create it, post the chunks, finish it, read its counts. */
export const uploadSet = <E, R>(s: Session, name: string, sourceFile: string, lines: Stream.Stream<string, E, R>, max: number) =>
  Effect.gen(function* () {
    const setId = yield* createSet(s, name, sourceFile)
    const { totals, oversized } = yield* uploadChunks(s, setId, lines, max)
    yield* finishSet(s, setId)
    return { setId, state: yield* setState(s, setId), totals, oversized }
  })
