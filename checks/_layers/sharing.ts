import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Sharing from "../../frontend/src/lib/sharing.ts"
import { login } from "./api-client.ts"
import { asAdmin, type Session, session } from "./session.ts"
import { TestServer } from "./test-server.ts"

// What the sharing checks share: the frontend adapter itself, the panel's fetch aimed at the
// check server, and lookups that find again what an earlier step created.

export { Sharing }

export const CUBE = "crm/organizations"
export const TYPE = "Organization"
export const ORG_NAME = "Sharing Probe Org"
export const MIHAI = { username: "mihai", password: "mihai-pw", displayName: "Mihai", roles: ["reader"] } as const

/**
 * The panel's fetch for one session: the same-origin proxy prefix /api/qwbe goes to the check
 * server and the session's bearer token rides along, so every path and payload under check is the
 * adapter's own.
 */
export const panelFetch = ({ base, token }: Session): typeof fetch => (input, init) => {
  const headers = new Headers(init?.headers)
  headers.set("authorization", `Bearer ${token}`)
  return fetch(String(input).replace(/^\/api\/qwbe/, base), { ...init, headers })
}

/** Runs one adapter call; the adapter answers every refusal as a value and never rejects on one. */
export const adapter = <A>(session: Session, call: (doFetch: typeof fetch) => Promise<A>) =>
  Effect.promise(() => call(panelFetch(session)))

export const createMihai = Effect.flatMap(asAdmin, (admin) => admin.send("POST", "/account", MIHAI))

export const createOrg = Effect.flatMap(asAdmin, (admin) => admin.send("POST", "/organizations", { name: ORG_NAME }))

export const asMihai = Effect.flatMap(TestServer, ({ base }) =>
  Effect.map(login(base, MIHAI.username, MIHAI.password), (token) => session(base, token)))

const Rows = Schema.Struct({ rows: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String, username: Schema.optional(Schema.String) })) })

const firstRow = (path: string) =>
  asAdmin.pipe(
    Effect.flatMap((admin) => admin.get(path)),
    Effect.flatMap((reply) => Effect.orDie(Schema.decodeUnknown(Rows)(reply.body))),
    Effect.map(({ rows }) => rows[0]),
  )

/** mihai's account id, from the directory. */
export const mihaiId = Effect.map(firstRow(`/account?q=${MIHAI.username}`), ({ id }) => id)

/** The entity reference of the check organization, as the adapter takes it. */
export const orgRef = Effect.map(firstRow(`/organizations?name=${encodeURIComponent(ORG_NAME)}`), ({ id }) => ({
  cube: CUBE,
  entityType: TYPE,
  entityId: id,
}))

/** The organization's grant page, as admin, through the adapter. */
export const grantPage = Effect.gen(function* () {
  const ref = yield* orgRef
  return yield* adapter(yield* asAdmin, (doFetch) => Sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch }))
})
