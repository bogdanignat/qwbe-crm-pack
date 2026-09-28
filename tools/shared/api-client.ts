// The one HTTP client of the pack's tools, on @effect/platform's HttpClient, shaped like qwbe's
// core/checks/_layers/api-client.ts. Failures carry a message for runTool: method, path and HTTP
// status only, never a reply body (it may hold customer values).
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import type * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export class ApiFailed extends Data.TaggedError("ApiFailed")<{ readonly message: string }> {}

export interface Reply {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

export interface CallOptions {
  readonly method?: HttpClientRequest.HttpClientRequest["method"]
  readonly token?: string
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
}

/** A logged-in kernel: its base URL and the session token. */
export interface Session {
  readonly base: string
  readonly token: string
}

const LoginReply = Schema.Struct({ token: Schema.NonEmptyString })

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const request = (url: string, { method = "GET", token, body, headers = {} }: CallOptions) =>
  HttpClientRequest.make(method)(url).pipe(
    HttpClientRequest.setHeaders(headers),
    token === undefined ? (req) => req : HttpClientRequest.bearerToken(token),
    body === undefined ? (req) => req : HttpClientRequest.bodyUnsafeJson(body),
  )

const reply = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.map(
    response.text,
    (text): Reply => ({ status: response.status, headers: response.headers, body: parse(text) }),
  )

const where = (path: string, options: CallOptions) => `${options.method ?? "GET"} ${path}`

/** One request to `base + path`; any status comes back, a transport failure or timeout fails. */
export const call = (base: string, path: string, options: CallOptions = {}) =>
  HttpClient.execute(request(`${base}${path}`, options)).pipe(
    Effect.flatMap(reply),
    Effect.timeout("10 seconds"),
    Effect.mapError((error) => new ApiFailed({ message: `${where(path, options)}: ${error.message}` })),
  )

const isOk = (status: number): boolean => status >= 200 && status < 300

/** A 2xx reply whose body decodes with `schema`; any other status or shape fails. */
export const callAs = <A, I>(schema: Schema.Schema<A, I>, base: string, path: string, options: CallOptions = {}) =>
  call(base, path, options).pipe(
    Effect.filterOrFail(
      ({ status }) => isOk(status),
      ({ status }) => new ApiFailed({ message: `${where(path, options)}: HTTP ${status}` }),
    ),
    Effect.flatMap(({ body }) =>
      Effect.mapError(
        Schema.decodeUnknown(schema)(body),
        () => new ApiFailed({ message: `${where(path, options)}: reply does not have the expected shape` }),
      ),
    ),
  )

/** Logs in and returns the session token. */
export const login = (base: string, username: string, password: string) =>
  callAs(LoginReply, base, "/auth/login", { method: "POST", body: { username, password } }).pipe(
    Effect.map(({ token }) => token),
    Effect.mapError(({ message }) => new ApiFailed({ message: `login of ${username} refused (${message})` })),
  )
