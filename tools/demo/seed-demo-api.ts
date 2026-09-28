// The kernel API as the seed sees it: one logged-in call, and the reply shapes it reads.
import type * as HttpClient from "@effect/platform/HttpClient"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type ApiFailed, type CallOptions, callAs, login } from "../shared/api-client.ts"

/** One authenticated request; a non-2xx status or an unexpected reply shape fails. */
export type Api = <A, I>(
  schema: Schema.Schema<A, I>,
  path: string,
  options?: CallOptions,
) => Effect.Effect<A, ApiFailed, HttpClient.HttpClient>

export const connect = (base: string, username: string, password: string) =>
  Effect.map(
    login(base, username, password),
    (token): Api => (schema, path, options = {}) => callAs(schema, base, path, { ...options, token }),
  )

const rowsOf = <A, I>(row: Schema.Schema<A, I>) => Schema.Struct({ rows: Schema.Array(row) })

export const Defs = rowsOf(Schema.Struct({ id: Schema.String, name: Schema.String, deleted: Schema.Boolean }))
export const Keyed = rowsOf(Schema.Struct({ id: Schema.String, externalId: Schema.optional(Schema.String) }))
export const Titles = Schema.extend(rowsOf(Schema.Struct({ title: Schema.String })), Schema.Struct({ total: Schema.Number }))
export const Total = Schema.Struct({ total: Schema.Number })
export const Created = Schema.Struct({ id: Schema.String })

export const defsPath = (cube: string) => `/customfields?cube=${encodeURIComponent(cube)}&limit=200`
