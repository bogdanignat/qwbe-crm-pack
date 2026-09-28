// Import chain end-to-end (synthetic fixture, throwaway kernel)
import { join } from "node:path"
import * as Command from "@effect/platform/Command"
import * as FileSystem from "@effect/platform/FileSystem"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"
import { cli, count, fixture, MAPPING, run, sql, writeJsonl } from "../_layers/vtiger-cli.ts"

// Upload, map, verify and map again over one server, then the kill-and-rerun proof and the unique
// index it leaves in the database (the index test reads the kill test's rows, so order matters).
// The rejection paths live in import-rejects.test.ts.

const SERVER = { timeout: 120_000, excludeTestServices: true } as const
const work = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix: "qwb50-" }))
// A run that must succeed, as the old execFileSync runner demanded: its output, or the test fails.
const ok = (tool: string, args: ReadonlyArray<string>) =>
  Effect.map(run(tool, args), ({ out, status }) => (expect(status, out).toBe(0), out))
const setId = (out: string) => /set id:\s+(\S+)/.exec(out)?.[1] ?? ""

const Profile = Schema.Struct({ rows: Schema.Number, fields: Schema.Array(Schema.Struct({ field: Schema.String, fillRate: Schema.Number })) })
const Contacts = Schema.Struct({ rows: Schema.Array(Schema.Struct({ name: Schema.String, organizationId: Schema.NullOr(Schema.String) })) })
const Tally = Schema.Struct({ rows: Schema.Tuple(Schema.Struct({ n: Schema.Number, d: Schema.Number })) })
const Indexes = Schema.Struct({ rows: Schema.Array(Schema.Struct({ indexdef: Schema.String })) })
const PgError = Schema.Struct({ code: Schema.String })

const read = <A, I>(schema: Schema.Schema<A, I>, path: string) =>
  asAdmin.pipe(Effect.flatMap((admin) => admin.get(path)), Effect.flatMap(({ body }) => Effect.orDie(Schema.decodeUnknown(schema)(body))))
const tally = <A, I>(schema: Schema.Schema<A, I>, text: string) =>
  Effect.flatMap(Effect.orDie(sql(text)), (result) => Effect.orDie(Schema.decodeUnknown(schema)(result)))

layer(testServer("import-chain", {}, plantCrmPack), SERVER)((it) => {
  it.scoped("uploads, maps, reports the missing organization, and a second run changes nothing", () =>
    Effect.gen(function* () {
      const dir = yield* work
      const accounts = yield* writeJsonl(dir, "accounts.jsonl", yield* fixture("accounts"))
      const contacts = yield* writeJsonl(dir, "contacts.jsonl", yield* fixture("contacts"))

      const upA = yield* ok("vtiger-to-staging", [accounts, "qwb50-accounts"])
      expect(upA).toMatch(/rows:\s+3/)
      expect(upA).toMatch(/malformed:\s+0/)
      const upC = yield* ok("vtiger-to-staging", [contacts, "qwb50-contacts"])
      expect(upC).toMatch(/rows:\s+3/)

      const profile = yield* read(Profile, `/staging/sets/${setId(upA)}/profile`)
      expect(profile.rows).toBe(3)
      expect(profile.fields).toContainEqual({ field: "accountname", fillRate: 100 })

      // contact 900102 points at the missing organization 900999
      const mapA = yield* ok("vtiger-map", [accounts, MAPPING.accounts, "--set", setId(upA)])
      expect(mapA).toMatch(/created:\s+3/)
      expect(mapA).toMatch(/staging matches the file row for row/)
      const mapC = yield* ok("vtiger-map", [contacts, MAPPING.contacts, "--set", setId(upC)])
      expect(mapC).toMatch(/created:\s+3/)
      expect(mapC).toMatch(/missing org:\s*1/)
      expect(mapC).toMatch(/no org:\s*1/)

      const { rows } = yield* read(Contacts, "/contacts?limit=10")
      expect(rows.find((row) => row.name === "Andrei Exemplu")?.organizationId).toEqual(expect.any(String))
      expect(rows.find((row) => row.name === "Bianca Model")).toMatchObject({ organizationId: null })
      expect([yield* count("organizations"), yield* count("contacts")]).toEqual([3, 3])

      // IDEMPOTENCE: a second mapping run updates, does not duplicate
      const mapA2 = yield* ok("vtiger-map", [accounts, MAPPING.accounts])
      const mapC2 = yield* ok("vtiger-map", [contacts, MAPPING.contacts])
      for (const out of [mapA2, mapC2]) {
        expect(out).toMatch(/updated:\s+3/)
        expect(out).toMatch(/created:\s+0/)
      }
      expect(mapC2).toMatch(/missing org:\s*1/)
      expect([yield* count("organizations"), yield* count("contacts")]).toEqual([3, 3])

      const verify = yield* ok("vtiger-verify", [accounts, contacts, "--set-accounts", setId(upA), "--set-contacts", setId(upC)])
      expect(verify).toMatch(/accounts: exported=3 staging=3 \(diff 0\) qwbe=3 \(diff 0; whole-cube total/)
      expect(verify).toMatch(/contacts: exported=3 staging=3 \(diff 0\) qwbe=3 \(diff 0; whole-cube total/)
      expect(verify).toMatch(/organization missing=1/)
    }))

  it.scoped("a mid-run kill and rerun leaves rows equal to distinct external ids (QWB-54, ticket 13)", () =>
    Effect.gen(function* () {
      const [first] = yield* fixture("accounts")
      const dir = yield* work
      const rows = Array.from({ length: 8 }, (_, i) => ({
        ...first, vtigerId: 950001 + i, accountid: 950001 + i, account_no: `FIX-ACC-K${i}`, accountname: `Kill Rerun ${i} SRL`,
      }))
      const file = yield* writeJsonl(dir, "accounts-kill.jsonl", rows)
      const before = yield* count("organizations")

      // kill as soon as at least two rows have landed -- the rest of the run never happened
      yield* Effect.scoped(Effect.gen(function* () {
        const child = yield* Effect.orDie(Effect.flatMap(cli("vtiger-map", [file, MAPPING.accounts]), Command.start))
        const landed = count("organizations").pipe(
          Effect.repeat({ schedule: Schedule.spaced("100 millis"), until: (n) => n >= before + 2, times: 150 }),
        )
        yield* Effect.raceFirst(Effect.asVoid(landed), Effect.ignore(child.exitCode))
        yield* Effect.ignore(child.kill("SIGKILL"))
      }))

      // rerun to completion: the externalId lookup PATCHes what landed and POSTs the rest. No
      // ledger decides insert versus update -- the correspondence lives on the rows.
      expect(yield* ok("vtiger-map", [file, MAPPING.accounts])).toMatch(/errors:\s+0/)
      expect(yield* Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(join(dir, "accounts-idmap.json")))))
        .toBe(false)

      // THE PROOF: row count == distinct external identities, in the DATABASE.
      const all = yield* tally(Tally, `SELECT COUNT(*)::int AS n, COUNT(DISTINCT body->>'externalId')::int AS d
        FROM "crm--organizations"."organizations" WHERE deleted = false`)
      expect(all.rows[0].n).toBe(all.rows[0].d)
      const killed = yield* tally(Tally, `SELECT COUNT(*)::int AS n, 0 AS d FROM "crm--organizations"."organizations"
        WHERE deleted = false AND body->>'externalId' LIKE 'vtiger:9500%'`)
      expect(killed.rows[0].n).toBe(8)
      expect(yield* count("organizations")).toBe(before + 8)
    }))

  it.effect("the unique index lives in the database and refuses a duplicate external id", () =>
    Effect.gen(function* () {
      // The index exists, under its deterministic name, partial on live non-null identities.
      const { rows } = yield* tally(Indexes, `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'crm--organizations' AND indexname = 'organizations_external_id_key'`)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.indexdef).toMatch(/CREATE UNIQUE INDEX organizations_external_id_key/)
      expect(rows[0]?.indexdef).toMatch(/'externalId'/)
      // And it is the DATABASE that refuses a duplicate -- not the import tool's lookup.
      const refused = yield* Effect.flip(sql(
        `INSERT INTO "crm--organizations"."organizations" (id, type, created_at, deleted, version, body)
         VALUES ('org_dup_probe', 'Organization', now(), false, 1, $1)`,
        [JSON.stringify({ name: "Duplicate Probe", externalId: "vtiger:950001" })],
      ))
      expect(yield* Effect.orDie(Schema.decodeUnknown(PgError)(refused))).toEqual({ code: "23505" })
    }))
})
