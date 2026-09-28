// crm/contact-groups on a fresh install: the kernel creates each table WITH its index on first touch
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { NAME_INDEX, PAIR_INDEX, SCHEMA } from "../../cubes/crm/contact-groups/service.ts"
import { normalizeIndexDef, TARGETS } from "../../tools/db/contact-group-indexes-spec.ts"
import { idOf, indexTool, mountedCubes, select, text } from "../_layers/contact-groups.ts"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"

// A fresh install needs no operator step: a plain authorized GET creates the groups table and the
// unique index the cube DECLARES (manifest.uniqueIndexes), so the first write succeeds; the
// members table arrives, indexed, on its own first touch. The retained tool then agrees with the
// running kernel: nothing to do, and what it renders from the declaration is what the kernel wrote.

const SERVER = { timeout: 120_000, excludeTestServices: true } as const

const Table = Schema.Struct({ table_name: Schema.String })
const Index = Schema.Struct({ index: Schema.String, indisvalid: Schema.Boolean, indisready: Schema.Boolean })
const Def = Schema.Struct({ indexdef: Schema.String })

const tables = Effect.map(
  select(Table, `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`, [SCHEMA]),
  (rows) => rows.map(({ table_name }) => table_name),
)

/** Only a VALID, READY index enforces anything, so both catalog flags are read, not just the name. */
const indexes = select(Index, `SELECT ci.relname AS index, i.indisvalid, i.indisready
    FROM pg_index i
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ci.relnamespace
   WHERE n.nspname = $1 AND ci.relname = ANY($2::text[])
   ORDER BY 1`, [SCHEMA, [NAME_INDEX, PAIR_INDEX]])

layer(testServer("contact-groups-install", {}, plantCrmPack), SERVER)((it) => {
  it.effect("crm/contact-groups is mounted", () =>
    Effect.map(mountedCubes, (names) => expect(names).toContain("crm/contact-groups")))

  it.effect("1. fresh install: the kernel creates each table WITH its index on first touch", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      // Nothing exists yet: this is a genuinely fresh install.
      expect(yield* tables).toEqual([])

      const list = yield* admin.get("/contact-groups?limit=1")
      expect(list.status, text(list)).toBe(200)
      expect(list.body).toMatchObject({ total: 0 })
      expect(yield* tables).toEqual(["contact_groups"])
      expect(yield* indexes).toEqual([{ index: NAME_INDEX, indisvalid: true, indisready: true }])

      // The FIRST write succeeds: no operator step, no readiness check in the pack, no warmed tables.
      const created = yield* admin.send("POST", "/contact-groups", { name: "Key accounts" })
      expect(created.status, text(created)).toBe(200)
      expect(created.body).toMatchObject({ name: "Key accounts", normalizedName: "key accounts" })
      const groupId = yield* idOf(created)

      // The members table is untouched until something asks for it, and then arrives WITH its index.
      const members = yield* admin.get(`/contact-groups/${groupId}/members`)
      expect(members.status, text(members)).toBe(200)
      expect(members.body).toMatchObject({ total: 0 })
      expect(yield* tables).toEqual(["contact_group_members", "contact_groups"])
      expect(yield* indexes).toEqual([
        { index: PAIR_INDEX, indisvalid: true, indisready: true },
        { index: NAME_INDEX, indisvalid: true, indisready: true },
      ])
    }))

  it.effect("2. the retained tool sees nothing to do, and renders exactly what the kernel wrote", () =>
    Effect.gen(function* () {
      const dry = yield* indexTool([])
      expect(dry.status, dry.out).toBe(0)
      expect(dry.out).toMatch(/nothing to do/)
      expect(dry.out).not.toMatch(/ABSENT/)

      // Two renderers, one declaration: drift between them would make the tool report a healthy
      // install as broken, so it is asserted against the real catalog.
      for (const target of TARGETS) {
        const rows = yield* select(Def, `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [
          SCHEMA,
          target.index,
        ])
        expect(rows).toHaveLength(1)
        expect(normalizeIndexDef(rows[0]?.indexdef ?? ""), `${target.index} as written by the KERNEL`).toBe(target.def)
      }

      const applied = yield* indexTool(["--apply", "--i-understand"])
      expect(applied.status, applied.out).toBe(0)
      expect(applied.out).toMatch(/scanned 2 created 0 exists 2 skipped 0 failed 0/)
    }))
})
