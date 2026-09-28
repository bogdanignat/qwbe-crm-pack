import * as Command from "@effect/platform/Command"
import { expect } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { withoutAllowScripts } from "../../tools/shared/process-pure.ts"
import { login, type Reply } from "./api-client.ts"
import { PACK } from "./pack-copy.ts"
import { asAdmin, type Session, session } from "./session.ts"
import { TestServer } from "./test-server.ts"
import { sql } from "./vtiger-cli.ts"

// What the contact-groups live checks share: the retained index tool run as the operator runs it
// against the file's database, reply text for the leak checks, accounts with exactly the
// capabilities named, and typed reads of the server's database.

/**
 * `node tools/db/ensure-contact-group-indexes.ts args` on the server's database: exit status and
 * stdout followed by stderr. The child gets the parent's environment minus npm's allow-scripts,
 * with QWBE_DATABASE_URL pointed at the test database and `env` on top (extendEnv: false only
 * avoids a second merge).
 */
export const indexTool = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
  Effect.flatMap(TestServer, ({ url }) =>
    Effect.scoped(Effect.flatMap(
      Command.start(
        Command.make(process.execPath, "tools/db/ensure-contact-group-indexes.ts", ...args).pipe(
          Command.workingDirectory(PACK),
          Command.stdin(Stream.empty),
          Command.env({ ...withoutAllowScripts(process.env), QWBE_DATABASE_URL: url, ...env }, { extendEnv: false }),
        ),
      ),
      (child) =>
        Effect.all({
          status: child.exitCode,
          stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
        }, { concurrency: "unbounded" }),
    )),
  ).pipe(Effect.map(({ status, stdout, stderr }) => ({ status, out: stdout + stderr })), Effect.orDie)

/** The reply as the caller saw it: a status alone would hide what leaked. */
export const text = (reply: Reply) => (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body))

const Named = Schema.Array(Schema.Struct({ name: Schema.String }))

/** The cube names /settings/cubes lists, as admin. */
export const mountedCubes = asAdmin.pipe(
  Effect.flatMap((admin) => admin.get("/settings/cubes")),
  Effect.flatMap((reply) => Effect.orDie(Schema.decodeUnknown(Named)(reply.body))),
  Effect.map((cubes) => cubes.map(({ name }) => name)),
)

const Id = Schema.Struct({ id: Schema.String })

/** The `id` of a created row; a reply without one fails the test. */
export const idOf = (reply: Reply) =>
  Effect.map(Effect.orDie(Schema.decodeUnknown(Id)(reply.body)), ({ id }) => id)

/**
 * A user with exactly the capabilities named and NOTHING else: the role is one nobody declares,
 * so the account starts with zero permissions.
 */
export const makeUser = (admin: Session, username: string, capabilities: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const created = yield* admin.send("POST", "/account", { username, password: "secret", roles: ["cg-http-test"] })
    expect(created.status, text(created)).toBe(200)
    for (const capability of capabilities) {
      const granted = yield* admin.send("POST", "/permissions/capabilities/user", { capability, username })
      expect(granted.status, text(granted)).toBe(200)
    }
    return session(admin.base, yield* login(admin.base, username, "secret"))
  })

/** One statement whose refusal fails the test. */
export const exec = (statement: string, values: ReadonlyArray<unknown> = []) => Effect.asVoid(Effect.orDie(sql(statement, values)))

/** The rows of one query, decoded with `row`. */
export const select = <A, I>(row: Schema.Schema<A, I>, query: string, values: ReadonlyArray<unknown> = []) =>
  Effect.orDie(sql(query, values)).pipe(
    Effect.flatMap((result) => Effect.orDie(Schema.decodeUnknown(Schema.Struct({ rows: Schema.Array(row) }))(result))),
    Effect.map(({ rows }) => rows),
  )

const N = Schema.Struct({ n: Schema.Number })

/** `SELECT count(*)::int AS n ...` as a number. */
export const countOf = (query: string, values: ReadonlyArray<unknown> = []) =>
  Effect.map(select(N, query, values), (rows) => rows[0]?.n ?? -1)
