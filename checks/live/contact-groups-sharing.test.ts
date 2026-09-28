// crm/contact-groups sharing boundary over HTTP: 403s, no grants created, no contact leaked
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { countOf, idOf, makeUser, mountedCubes, select, text } from "../_layers/contact-groups.ts"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { asAdmin } from "../_layers/session.ts"
import { testServer } from "../_layers/test-server.ts"

// The sharing boundary as evidence rather than prose: an unreadable group is 403; a caller without
// crm/contacts:read gets 403 on the member routes; reading a group one may read creates no grant
// and changes nothing about contact visibility -- a contact the caller may not read stays
// UNAVAILABLE through the contacts API, name included. The admin's group, contact and membership
// are created by the first test.

const SERVER = { timeout: 120_000, excludeTestServices: true } as const
const GROUP = "Key accounts"
const CONTACT = "Ada Lovelace"

const Rows = Schema.Struct({ rows: Schema.Array(Schema.Struct({ contactId: Schema.optional(Schema.String) })) })
const Regclass = Schema.Struct({ t: Schema.NullOr(Schema.String) })

let groupId = ""
let contactOfAdmin = ""

// The kernel makes a table on first use, so the grants table may not exist at all -- itself the
// strongest form of "no grant was created". Counted defensively either way.
const grants = (where = "", values: ReadonlyArray<unknown> = []) =>
  Effect.gen(function* () {
    const [present] = yield* select(Regclass, `SELECT to_regclass('permissions.permission_grants') AS t`)
    if (present?.t == null) return 0
    return yield* countOf(`SELECT count(*)::int AS n FROM permissions.permission_grants ${where}`, values)
  })

layer(testServer("contact-groups-sharing", {}, plantCrmPack), SERVER)((it) => {
  it.effect("crm/contact-groups is mounted, and the admin's group holds the admin's contact", () =>
    Effect.gen(function* () {
      expect(yield* mountedCubes).toContain("crm/contact-groups")
      const admin = yield* asAdmin
      const group = yield* admin.send("POST", "/contact-groups", { name: GROUP })
      expect(group.status, text(group)).toBe(200)
      groupId = yield* idOf(group)
      const contact = yield* admin.send("POST", "/contacts", { name: CONTACT, email: "ada@example.test" })
      expect(contact.status, text(contact)).toBe(200)
      contactOfAdmin = yield* idOf(contact)
      const member = yield* admin.send("POST", `/contact-groups/${groupId}/members`, { contactId: contactOfAdmin })
      expect(member.status, text(member)).toBe(200)
    }))

  it.effect("8. the sharing boundary, as evidence: 403s, no grants created, no contact leaked", () =>
    Effect.gen(function* () {
      const admin = yield* asAdmin
      const full = yield* makeUser(admin, "cg-full", ["crm/contact-groups:read", "crm/contact-groups:write", "crm/contacts:read"])
      const noContacts = yield* makeUser(admin, "cg-nocontacts", ["crm/contact-groups:read", "crm/contact-groups:write"])
      const grantsBefore = yield* grants()

      // (a) a group this caller may not read: 403, not a 404 and not the row.
      const hidden = yield* full.get(`/contact-groups/${groupId}`)
      expect(hidden.status, text(hidden)).toBe(403)
      expect(text(hidden)).not.toContain(GROUP)
      const hiddenMembers = yield* full.get(`/contact-groups/${groupId}/members`)
      expect(hiddenMembers.status, text(hiddenMembers)).toBe(403)
      expect(text(hiddenMembers), "an unreadable group must not leak its membership").not.toContain(contactOfAdmin)

      // (b) the caller's OWN group: readable, because the kernel's ownership claim made them owner.
      const own = yield* full.send("POST", "/contact-groups", { name: "Full's own group" })
      expect(own.status, text(own)).toBe(200)
      const ownId = yield* idOf(own)
      const added = yield* full.send("POST", `/contact-groups/${ownId}/members`, { contactId: contactOfAdmin })
      expect(added.status, text(added)).toBe(200)

      // (c) missing crm/contacts:read -> 403 on exactly the two routes that expose or attach a
      //     contact identity, and 200 on the group itself.
      const theirs = yield* noContacts.send("POST", "/contact-groups", { name: "No-contacts group" })
      expect(theirs.status, text(theirs)).toBe(200)
      const theirsId = yield* idOf(theirs)
      expect(yield* noContacts.status(`/contact-groups/${theirsId}`)).toBe(200)
      const membersDenied = yield* noContacts.get(`/contact-groups/${theirsId}/members`)
      expect(membersDenied.status, text(membersDenied)).toBe(403)
      const addDenied = yield* noContacts.send("POST", `/contact-groups/${theirsId}/members`, { contactId: contactOfAdmin })
      expect(addDenied.status, text(addDenied)).toBe(403)

      // (d) reading a group one MAY read returns ids -- and changes nothing about contacts. The
      //     contact belongs to admin; this caller could not read it before and still cannot.
      const list = yield* full.get(`/contact-groups/${ownId}/members`)
      expect(list.status, text(list)).toBe(200)
      const { rows } = yield* Effect.orDie(Schema.decodeUnknown(Rows)(list.body))
      expect(rows[0]?.contactId).toBe(contactOfAdmin)
      expect(text(list), "membership rows must carry no contact detail").not.toContain(CONTACT)

      const direct = yield* full.get(`/contacts/${contactOfAdmin}`)
      expect([403, 404], `expected the contact to stay protected, got ${direct.status}`).toContain(direct.status)
      expect(text(direct), "BLOCKER: the contact's name leaked").not.toContain(CONTACT)

      const resolved = yield* full.get(`/contacts?ids=${contactOfAdmin}`)
      expect(resolved.status, text(resolved)).toBe(200)
      const visible = yield* Effect.orDie(Schema.decodeUnknown(Rows)(resolved.body))
      expect(visible.rows, "BLOCKER: an unreadable contact resolved through the contacts API").toHaveLength(0)
      expect(text(resolved), "BLOCKER: the contact's name leaked").not.toContain(CONTACT)

      // (e) and reading the group created NO grant of any kind: membership is not a share.
      expect(yield* grants(), "reading a group must never create a grant").toBe(grantsBefore)
      expect(yield* grants(`WHERE body->>'entityId' = $1`, [contactOfAdmin]), "no grant may reference the contact").toBe(0)
    }))
})
