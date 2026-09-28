// crm/contact-groups when an index is lost or forged on a running server, and the tool's repair
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { GROUP_ENTITY, NAME_INDEX, PAIR_INDEX, SCHEMA } from "../../cubes/crm/contact-groups/service.ts"
import { indexSql, TARGETS } from "../../tools/db/contact-group-indexes-spec.ts"
import { countOf, exec, idOf, indexTool, mountedCubes, text } from "../_layers/contact-groups.ts"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"

// The kernel's installer does NOT retry (ensureTable is memoized per table for the life of the
// process), which is why the tool is retained: an index dropped after a successful write shuts
// the write gate again, and the tool reopens it with no restart. An index carrying the right NAME
// with the wrong json key is refused, not accepted. A defect answers a bare 500: the index name,
// the schema, the kernel's reason and the repair command are the operator's and go to the log
// (`indexNotReady`, cubes/crm/contact-groups/service.ts), never into an HTTP body.

const SERVER = { timeout: 120_000, excludeTestServices: true } as const

let groupId = ""

const leaks = (body: string, secrets: ReadonlyArray<string>) =>
  secrets.filter((secret) => body.toLowerCase().includes(secret.toLowerCase()))

layer(testServer("contact-groups-repair", {}, plantCrmPack), SERVER)((it) => {
  it.effect("crm/contact-groups is mounted, and both tables exist with their indexes", () =>
    Effect.gen(function* () {
      expect(yield* mountedCubes).toContain("crm/contact-groups")
      const admin = yield* asAdmin
      expect((yield* admin.get("/contact-groups?limit=1")).status).toBe(200)
      const created = yield* admin.send("POST", "/contact-groups", { name: "Key accounts" })
      expect(created.status, text(created)).toBe(200)
      groupId = yield* idOf(created)
      const members = yield* admin.get(`/contact-groups/${groupId}/members`)
      expect(members.status, text(members)).toBe(200)
    }))

  it.effect("5. an index lost AFTER a successful write shuts the gate again, and the tool reopens it", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      yield* exec(`DROP INDEX "${SCHEMA}"."${NAME_INDEX}"`)
      // The write gate reads the catalog on every write, so the loss is seen at once. Nobody holds
      // the name: the index is simply gone, which is a DEFECT (500), not a conflict (409).
      const refused = yield* admin.send("POST", "/contact-groups", { name: "After the drop" })
      expect(refused.status, text(refused)).toBe(500)
      const secrets = [NAME_INDEX, SCHEMA, "ensure-contact-group-indexes", "index", "invalid", "reconciled"]
      expect(leaks(text(refused), secrets), `the 500 body leaked: ${text(refused)}`).toEqual([])
      expect(text(refused)).not.toMatch(/pg_|CREATE |lower\(/)
      expect(yield* countOf(
        `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_groups WHERE body->>'name' = 'After the drop'`,
      ), "nothing may be written while the gate is shut").toBe(0)

      // Reads are unaffected while the gate is shut: that is what keeps the repair possible.
      const stillReadable = yield* admin.get("/contact-groups?limit=5")
      expect(stillReadable.status, text(stillReadable)).toBe(200)

      // Still with the index gone, a name a LIVE row really holds is a 409 from the PRE-CHECK (a
      // read, not gated). Written with SQL because the gate would refuse the kernel this insert.
      yield* exec(
        `INSERT INTO "${SCHEMA}".contact_groups (id, type, created_at, deleted, body) VALUES ($1, $2, now(), false, $3)`,
        ["cgrp-held", GROUP_ENTITY, JSON.stringify({ name: "Held name", normalizedName: "held name" })],
      )
      const held = yield* admin.send("POST", "/contact-groups", { name: "  HELD NAME  " })
      expect(held.status, text(held)).toBe(409)
      expect(text(held)).toMatch(/already exists/)
      // A real 409 may name the name the caller sent, and nothing of the storage.
      expect(text(held)).not.toContain(NAME_INDEX)
      yield* exec(`UPDATE "${SCHEMA}".contact_groups SET deleted = true WHERE id = 'cgrp-held'`)

      const applied = yield* indexTool(["--apply", "--i-understand"])
      expect(applied.status, applied.out).toBe(0)
      expect(applied.out).toMatch(/created 1 exists 1/)
      const accepted = yield* admin.send("POST", "/contact-groups", { name: "After the repair" })
      expect(accepted.status, "the running process must heal with no restart").toBe(200)
    }))

  it.effect("6. an index with the right NAME and the wrong json key is refused, not accepted", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      // The forgery the review reproduced: 'groupid' instead of 'groupId'. Every row's key is then
      // (NULL, NULL), so the index enforces nothing.
      yield* exec(`DROP INDEX "${SCHEMA}"."${PAIR_INDEX}"`)
      yield* exec(
        `CREATE UNIQUE INDEX "${PAIR_INDEX}" ON "${SCHEMA}".contact_group_members ` +
          `((body ->> 'groupid'), (body ->> 'contactid')) WHERE deleted = false`,
      )
      const refused = yield* admin.send("POST", `/contact-groups/${groupId}/members`, { contactId: "cont-forged" })
      expect(refused.status, "a same-named index with a different definition is not readiness").toBe(500)
      // The kernel answers a defect with a bare 500 (core/src/kernel/install-parts.ts); it stays bare.
      const secrets = [PAIR_INDEX, SCHEMA, "ensure-contact-group-indexes", "body ->>", "groupid", "invalid"]
      expect(leaks(text(refused), secrets), `the 500 body leaked: ${text(refused)}`).toEqual([])
      expect(yield* countOf(
        `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_group_members WHERE body->>'contactId' = 'cont-forged'`,
      )).toBe(0)

      // The tool refuses it too, and never drops anything on its own.
      const blocked = yield* indexTool(["--apply", "--i-understand"])
      expect(blocked.status, blocked.out).toBe(1)
      expect(blocked.out).toMatch(/DIFFERENT definition/)
      expect(blocked.out).toMatch(/never drops an index/)

      // The operator drops it deliberately; the correct one goes back.
      yield* exec(`DROP INDEX "${SCHEMA}"."${PAIR_INDEX}"`)
      const pair = TARGETS[1]
      if (pair === undefined) return yield* Effect.dieMessage("TARGETS has no members index")
      yield* exec(indexSql(pair))
      const accepted = yield* admin.send("POST", `/contact-groups/${groupId}/members`, { contactId: "cont-ok" })
      expect(accepted.status, text(accepted)).toBe(200)
    }))
})
