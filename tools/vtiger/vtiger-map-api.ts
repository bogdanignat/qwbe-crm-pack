// The kernel requests of one import row, by external identity. A transport failure names the
// route only (the query carries a vtiger id) and stops the run; a refused reply is a RowFailed,
// which the row loop counts and moves past.
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { ApiFailed, call, type Session } from "../shared/api-client.ts"
import { describeFailure, describeStatus, Page } from "./vtiger-map-pure.ts"

export class RowFailed extends Data.TaggedError("RowFailed")<{ readonly message: string }> {}

/** Where the rows go: the list route and the entity name the messages carry. */
export interface Target {
  readonly route: string
  readonly entity: string
}

const refuse = (message: string) => Effect.fail(new RowFailed({ message }))

const send = (s: Session, method: "GET" | "POST" | "PATCH", path: string, body?: unknown) =>
  call(s.base, path, body === undefined ? { method, token: s.token } : { method, token: s.token, body }).pipe(
    Effect.mapError(() => new ApiFailed({ message: `${method} ${path.split("?")[0]}: no reply` })),
  )

/** The qwbe id stored under `externalId` on `route`, or none. `verb` names a failed lookup;
 *  `subject` names the rows when several share the identity -- only a database that lost its
 *  unique index can answer that way, and the lookup refuses to guess. */
export const findId = (s: Session, route: string, externalId: string, verb: string, subject: string) =>
  Effect.gen(function* () {
    const { status, body } = yield* send(s, "GET", `${route}?externalId=${encodeURIComponent(externalId)}&limit=1`)
    if (status >= 300) return yield* refuse(describeStatus(verb, status))
    const page = Schema.decodeUnknownOption(Page)(body)
    if (Option.isNone(page)) return yield* refuse(`${verb}: reply does not have the expected shape`)
    if ((page.value.total ?? 0) > 1) return yield* refuse(`${subject}: multiple rows share one externalId; refusing to guess`)
    return Option.fromNullable(page.value.rows?.[0]?.id)
  })

const create = (s: Session, target: Target, verb: string, payload: Record<string, unknown>) =>
  Effect.flatMap(send(s, "POST", target.route, payload), ({ status, body }) =>
    status < 300 ? Effect.succeed("created" as const) : refuse(describeFailure(`${verb} ${target.entity}`, status, body)))

/** PATCHes the row stored under `externalId`, or POSTs it when there is none; the counter it lands in. */
export const upsert = (s: Session, target: Target, externalId: string, payload: Record<string, unknown>) =>
  Effect.gen(function* () {
    const existing = yield* findId(s, target.route, externalId, `lookup ${target.entity}`, target.entity)
    if (Option.isNone(existing)) return yield* create(s, target, "create", { ...payload, externalId })
    // The external identity never changes: the patch carries the domain fields only.
    const res = yield* send(s, "PATCH", `${target.route}/${existing.value}`, payload)
    if (res.status < 300) return "updated" as const
    // Deleted between lookup and patch: create anew; a concurrent winner trips the index.
    if (res.status === 404) return yield* create(s, target, "recreate", { ...payload, externalId })
    return yield* refuse(describeFailure(`update ${target.entity}`, res.status, res.body))
  })
