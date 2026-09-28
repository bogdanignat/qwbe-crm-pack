import { join } from "node:path"
import * as Command from "@effect/platform/Command"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { Client } from "pg"
import { withoutAllowScripts } from "../../tools/shared/process-pure.ts"
import { USERS } from "./boot.ts"
import { PACK } from "./pack-copy.ts"
import { asAdmin } from "./session.ts"
import { TestServer } from "./test-server.ts"

// The vtiger import CLIs (tools/vtiger/*.ts) run as real child processes against the file's
// check server and its database, as the operator runs them: node, argv, env, exit status.

export const MAPPING = { accounts: join(PACK, "mappings/accounts.json"), contacts: join(PACK, "mappings/contacts.json") }

const Row = Schema.Record({ key: Schema.String, value: Schema.Unknown })
export type Row = typeof Row.Type
const Fixture = Schema.parseJson(Schema.NonEmptyArray(Row))

/** A synthetic fixture (checks/_fixtures/vtiger/<entity>.fixture.json): fake names, vtiger's shape. */
export const fixture = (entity: "accounts" | "contacts") =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(join(PACK, "checks/_fixtures/vtiger", `${entity}.fixture.json`)).pipe(
      Effect.flatMap(Schema.decodeUnknown(Fixture)),
      Effect.orDie,
    ))

/** Writes `rows` as JSON Lines into `dir` and returns the path. */
export const writeJsonl = (dir: string, name: string, rows: ReadonlyArray<Row>) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => {
    const path = join(dir, name)
    return Effect.as(Effect.orDie(fs.writeFileString(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n")), path)
  })

/** `node tools/vtiger/<tool>.ts args` with the server's URL, database and the admin's credentials. */
export const cli = (tool: string, args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
  Effect.map(TestServer, ({ base, url }) =>
    Command.make(process.execPath, join("tools/vtiger", `${tool}.ts`), ...args).pipe(
      Command.workingDirectory(PACK),
      Command.stdin(Stream.empty),
      Command.env({
        ...withoutAllowScripts(process.env),
        QWB50_TEST_UNSAFE_INPUT: "1",
        QWBE_USER: "admin",
        QWBE_PASSWORD: USERS.admin,
        QWBE_URL: base,
        QWBE_DATABASE_URL: url,
        ...env,
      }, { extendEnv: false }),
    ))

/** Runs the tool to its end: exit status and stdout followed by stderr, as the old runner read them. */
export const run = (tool: string, args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
  Effect.flatMap(cli(tool, args, env), (command) =>
    Effect.scoped(Effect.flatMap(Command.start(command), (child) =>
      Effect.all({
        status: child.exitCode,
        stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
        stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
      }, { concurrency: "unbounded" }))),
  ).pipe(Effect.map(({ status, stdout, stderr }) => ({ status, out: stdout + stderr })), Effect.orDie)

const Count = Schema.Struct({ output: Schema.NumberFromString })
const Total = Schema.Struct({ total: Schema.Number })

/** Live rows of a crm cube as the server counts them: organizations by the CLI verb, contacts by the list total. */
export const count = (cube: "organizations" | "contacts") =>
  Effect.flatMap(asAdmin, (admin) =>
    cube === "organizations"
      ? admin.send("POST", "/cli/exec", { line: "crm/organizations:count" }).pipe(
        Effect.flatMap(({ body }) => Schema.decodeUnknown(Count)(body)),
        Effect.map(({ output }) => output),
      )
      : admin.get("/contacts?limit=1").pipe(
        Effect.flatMap(({ body }) => Schema.decodeUnknown(Total)(body)),
        Effect.map(({ total }) => total),
      )).pipe(Effect.orDie)

/**
 * One statement on the server's database: the proofs that live only there (row count against
 * distinct external ids, the unique index). A refused statement fails with the driver's error.
 */
export const sql = (text: string, values: ReadonlyArray<unknown> = []) =>
  Effect.flatMap(TestServer, ({ url }) =>
    Effect.scoped(Effect.flatMap(
      Effect.acquireRelease(
        Effect.tryPromise(async () => {
          const client = new Client({ connectionString: url })
          await client.connect()
          return client
        }).pipe(Effect.orDie),
        (client) => Effect.promise(() => client.end()),
      ),
      (client) => Effect.tryPromise({ try: () => client.query(text, [...values]), catch: (error) => error }),
    )))
