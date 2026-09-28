// crm/contact-groups uniqueness over HTTP: names, the clash only the index sees, concurrent members
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { NAME_INDEX, PAIR_INDEX, SCHEMA } from "../../cubes/crm/contact-groups/service.ts"
import { countOf, exec, idOf, mountedCubes, select, text } from "../_layers/contact-groups.ts"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"
import { sql } from "../_layers/vtiger-cli.ts"

// Names are unique per live row (409 on a duplicate or a rename onto another name, 200 on
// respelling one's own); the 409 the JavaScript pre-check cannot see comes from the index and
// says nothing about the storage; two concurrent adds of the same pair leave one row; and a
// 23505 from any other constraint stays a defect. The first test creates the group the rest use.

const SERVER = { timeout: 120_000, excludeTestServices: true } as const

const Sigma = Schema.Struct({ pg_sigma: Schema.Boolean })
const Row = Schema.Struct({ id: Schema.String })
const PgError = Schema.Struct({ code: Schema.String, constraint: Schema.String })
const Page = Schema.Struct({
  sortedBy: Schema.String,
  total: Schema.Number,
  rows: Schema.Array(Schema.Struct({ contactId: Schema.String })),
})

let groupId = ""

layer(testServer("contact-groups-unique", {}, plantCrmPack), SERVER)((it) => {
  it.effect("crm/contact-groups is mounted, and the check's group exists", () =>
    Effect.gen(function* () {
      expect(yield* mountedCubes).toContain("crm/contact-groups")
      const created = yield* (yield* asAdmin).send("POST", "/contact-groups", { name: "Key accounts" })
      expect(created.status, text(created)).toBe(200)
      groupId = yield* idOf(created)
    }))

  it.effect("3. duplicate name 409, rename onto another name 409, respelling one's own name 200", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      const dup = yield* admin.send("POST", "/contact-groups", { name: "  KEY ACCOUNTS " })
      expect(dup.status, text(dup)).toBe(409)

      const other = yield* admin.send("POST", "/contact-groups", { name: "Newsletter" })
      expect(other.status, text(other)).toBe(200)
      const clash = yield* admin.send("PATCH", `/contact-groups/${yield* idOf(other)}`, { name: "key accounts" })
      expect(clash.status, text(clash)).toBe(409)

      const respelled = yield* admin.send("PATCH", `/contact-groups/${groupId}`, { name: "KEY Accounts" })
      expect(respelled.status, text(respelled)).toBe(200)
      expect(respelled.body).toMatchObject({ name: "KEY Accounts", normalizedName: "key accounts" })

      const blank = yield* admin.send("POST", "/contact-groups", { name: "   " })
      expect(blank.status, text(blank)).toBe(400)
    }))

  // The pre-check compares `normalizedName`, built with JavaScript's `trim().toLowerCase()`; the
  // index compares Postgres's `lower(btrim(...))`. They disagree on a word-final Greek sigma (JS
  // folds Σ to ς, `lower()` to σ), asserted against THIS server below because the case rests on it.
  // `ΟΔΟΣ` is stored as `οδος` while the index holds `οδοσ`: a caller asking for `οδοσ` passes the
  // pre-check and is refused by the index alone, which the kernel tags as a `duplicate` -> 409.
  it.effect("3b. the INDEX alone sees the clash: create 409 and rename 409 where the pre-check misses", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      const [diverges] = yield* select(Sigma, `SELECT lower($1::text) = $2::text AS pg_sigma`, ["ΟΔΟΣ", "οδοσ"])
      expect(diverges?.pg_sigma, "this server's lower() must fold a final Σ to σ").toBe(true)
      expect("ΟΔΟΣ".toLowerCase(), "and JavaScript's must not -- otherwise there is no gap").toBe("οδος")

      const greek = yield* admin.send("POST", "/contact-groups", { name: "ΟΔΟΣ" })
      expect(greek.status, text(greek)).toBe(200)
      expect(greek.body, "the cube's key really is the other one").toMatchObject({ normalizedName: "οδος" })

      // CREATE: the index is the only thing that can see this clash.
      const created = yield* admin.send("POST", "/contact-groups", { name: "οδοσ" })
      expect(created.status, `the index refused it, so it must be a 409, not a 500: ${text(created)}`).toBe(409)
      expect(text(created)).toMatch(/already exists/)
      // A real 409 may repeat the name the caller sent; it may say nothing about the storage.
      for (const secret of [NAME_INDEX, SCHEMA, "ensure-contact-group-indexes", "23505", "lower("]) {
        expect(text(created).toLowerCase(), `409 body leaked ${secret}`).not.toContain(secret.toLowerCase())
      }

      // RENAME: same gap, same answer, and the row keeps its old name.
      const victim = yield* admin.send("POST", "/contact-groups", { name: "Sigma test" })
      expect(victim.status, text(victim)).toBe(200)
      const victimId = yield* idOf(victim)
      const renamed = yield* admin.send("PATCH", `/contact-groups/${victimId}`, { name: "οδοσ" })
      expect(renamed.status, `a rename refused by the index is a 409, not a 500: ${text(renamed)}`).toBe(409)
      const unchanged = yield* admin.get(`/contact-groups/${victimId}`)
      expect(unchanged.body, "a refused rename may not change the row").toMatchObject({ name: "Sigma test" })

      // Exactly one row holds the key: the index really did refuse both writes.
      expect(yield* countOf(
        `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_groups WHERE deleted = false AND lower(btrim(body->>'name')) = $1`,
        ["οδοσ"],
      )).toBe(1)

      // Cleaned up so the later cases see the state they expect.
      yield* exec(`UPDATE "${SCHEMA}".contact_groups SET deleted = true WHERE id = ANY($1)`, [[yield* idOf(greek), victimId]])
    }))

  it.effect("4. two CONCURRENT adds of the same pair leave one row, and both callers get it", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      const contact = yield* admin.send("POST", "/contacts", { name: "Ada Lovelace", email: "ada@example.test" })
      expect(contact.status, text(contact)).toBe(200)
      const contactId = yield* idOf(contact)

      // Unbounded on purpose: Effect.all is sequential by default, and two sequential adds prove nothing.
      const add = admin.send("POST", `/contact-groups/${groupId}/members`, { contactId })
      const [a, b] = yield* Effect.all([add, add], { concurrency: "unbounded" })
      expect(a.status, text(a)).toBe(200)
      expect(b.status, text(b)).toBe(200)
      expect(yield* idOf(a), "both callers must get the SAME membership row, never a 409").toBe(yield* idOf(b))
      expect(yield* countOf(
        `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_group_members WHERE deleted = false AND body->>'groupId' = $1`,
        [groupId],
      ), "a concurrent duplicate must not create a second row").toBe(1)

      // The member list is ordered by a field a membership row HAS, and says so.
      const page = yield* admin.get(`/contact-groups/${groupId}/members?sort=name`)
      expect(page.status, text(page)).toBe(200)
      const { rows, sortedBy, total } = yield* Effect.orDie(Schema.decodeUnknown(Page)(page.body))
      expect(sortedBy, "a group field must never order membership rows").toBe("id")
      expect(total).toBe(1)
      expect(rows[0]?.contactId).toBe(contactId)
    }))

  it.effect("7. a 23505 from an UNRELATED constraint stays a defect, never a 409", () =>
    Effect.gen(function* () {
      const [row] = yield* select(Row, `SELECT id FROM "${SCHEMA}".contact_groups LIMIT 1`)
      const refused = yield* Effect.flip(sql(
        `INSERT INTO "${SCHEMA}".contact_groups (id, type, created_at, deleted, version, body)
         VALUES ($1, 'ContactGroup', now(), false, 1, $2::jsonb)`,
        [row?.id, JSON.stringify({ name: "pkey probe", normalizedName: "pkey probe" })],
      ))
      const clash = yield* Effect.orDie(Schema.decodeUnknown(PgError)(refused))
      expect(clash).toMatchObject({ code: "23505", constraint: "contact_groups_pkey" })
      // The cube maps exactly two constraint names and re-dies everything else, so this one could
      // never surface as a 409 (the mapping itself is pinned in cubes/.../index.test.ts).
      expect([NAME_INDEX, PAIR_INDEX]).not.toContain(clash.constraint)
    }))
})
