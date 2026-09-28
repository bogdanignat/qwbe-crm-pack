// Contract and behaviour tests for the contact-groups cube, without a server.
//
// The store double below is not a stub: it enforces the SAME two unique indexes the database
// enforces, and it raises the SAME shape of error Postgres raises (code 23505 plus the offending
// constraint name). That is what makes the conflict and idempotence tests mean something -- a
// double that merely returned rows would prove the handlers call it, nothing more. `blind(n)`
// makes the next n reads return nothing, which is how a lost race is reproduced honestly: the
// pre-check sees an uncommitted world, the index does not.
//
// The kernel owns the index lifecycle now (`manifest.uniqueIndexes`), so what used to be tested
// here -- a pg_indexes probe, its expected definitions, the table warming that fed it -- is tested
// in the kernel's own suite and, against a real server, in
// tools/db/ensure-contact-group-indexes.test.ts.
// What is left here is the cube's half: the DECLARATION it publishes, and what it says when
// the database refuses a write. Both refusals the kernel can hand over are exercised: a duplicate
// (23505 carrying the index) and the write gate's `UniqueIndexNotReady`.
//
// Run:  node --test cubes/crm/contact-groups/index.test.ts

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { CurrentUser } from "qwbe-core/auth"
import { type CubeTools, validateCubeParts, validateManifest } from "qwbe-core/cube"
import { Conflict, Forbidden, UniqueIndexNotReady } from "qwbe-core/errors"
import { cube } from "./index.ts"
import {
  NAME_INDEX,
  PAIR_INDEX,
  SCHEMA,
  UNIQUE_INDEXES,
  memberPageRequest,
  normalize,
  onNameTaken,
  onPairTaken,
} from "./service.ts"

type Row = Record<string, unknown> & { id: string }

/** Postgres's duplicate-key error, as the driver hands it over: the code and the CONSTRAINT are
 *  what the cube matches on, and nothing else may be matched on. */
const duplicate = (constraint: string): Error =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
  })

/**
 * The NAME key exactly as PostgreSQL builds it, which is NOT what `normalize` builds.
 *
 * `lower(btrim(...))` is the server's; `normalize` is JavaScript's `trim().toLowerCase()`. On a real
 * server (measured: PostgreSQL 16.14, datcollate en_US.utf8) `lower('ΟΔΟΣ')` is `οδοσ` -- U+03C3 --
 * while JavaScript lowercases a word-final Σ to ς, U+03C2. So the two disagree on a Greek word
 * ending in sigma, and the index, not the cube, is the arbiter. Reproduced here as one substitution
 * rather than a whole ICU port: that single codepoint is the whole divergence this cube can hit, and
 * the tests that use it are about what the cube does when the two disagree, not about Unicode.
 */
const pgNameKey = (name: string): string => name.trim().toLowerCase().replaceAll("\u03c2", "\u03c3")

/**
 * `shut`: tables whose kernel write gate is SHUT, mapped to the index it names. The kernel refuses
 * the write before the statement runs, so the double throws instead of writing -- see `shutGate`.
 *
 * `indexKey`: how the DOUBLE'S name index builds its key. Defaults to `normalize`, i.e. the cube's
 * own approximation, which is the ordinary case where server and cube agree. Pass `pgNameKey` to
 * get the case that matters: an index that refuses a write the cube's own pre-check and re-read
 * cannot see a reason for.
 */
type StoreOptions = {
  readonly shut?: Readonly<Record<string, string>>
  readonly indexKey?: (name: string) => string
}

const makeTools = (options: StoreOptions = {}) => {
  const shut = new Map<string, string>(Object.entries(options.shut ?? {}))
  const tables = new Map<string, Array<Row>>()
  const published: Array<{ topic: string; payload: unknown }> = []
  /** Every table `count` was asked for, in order: nothing may warm a table behind a read. */
  const counted: Array<string> = []
  /** Every page request the handlers issued, so the ordering they actually ask for is visible. */
  const pages: Array<{ table: string; page: { sortBy?: string | undefined; descending?: boolean } }> = []
  let seq = 0
  let blindFor = 0

  const rowsOf = (table: string): Array<Row> => {
    const existing = tables.get(table)
    if (existing) return existing
    const fresh: Array<Row> = []
    tables.set(table, fresh)
    return fresh
  }
  const live = (table: string): Array<Row> => rowsOf(table).filter((r) => r["deleted"] !== true)

  /** What the kernel's write gate does before a statement runs when the required index is absent,
   *  mis-defined or invalid: it throws, and a throw inside the store is a DEFECT, never a failure
   *  (core/src/pg/setup.ts `requireUniqueIndex`, core/src/pg/store.ts insert/update). */
  const gate = (table: string): void => {
    const index = shut.get(table)
    if (index !== undefined) {
      throw new UniqueIndexNotReady(index, `${SCHEMA}.${table} has no index by that name`)
    }
  }

  const indexKey = options.indexKey ?? normalize
  const enforce = (table: string, values: Record<string, unknown>): void => {
    if (table === "contact_groups") {
      const key = indexKey(String(values["name"] ?? ""))
      if (live(table).some((r) => indexKey(String(r["name"] ?? "")) === key)) throw duplicate(NAME_INDEX)
    }
    if (table === "contact_group_members") {
      const same = live(table).some((r) => r["groupId"] === values["groupId"] && r["contactId"] === values["contactId"])
      if (same) throw duplicate(PAIR_INDEX)
    }
  }

  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== "object") return true
    const w = where as {
      field?: string
      value?: string
      equals?: ReadonlyArray<{ field: string; value: string }>
    }
    if (w.field !== undefined) return row[w.field] === w.value
    return (w.equals ?? []).every((e) => row[e.field] === e.value)
  }

  const store = {
    all: (table: string) => Effect.sync(() => live(table)),
    byId: (table: string, id: string) => Effect.sync(() => live(table).find((r) => r.id === id)),
    count: (table: string) =>
      Effect.sync(() => {
        counted.push(table)
        return live(table).length
      }),
    page: (table: string, page: { offset: number; limit: number; sortBy?: string | undefined }, where?: unknown) =>
      Effect.sync(() => {
        pages.push({ table, page })
        const blind = blindFor > 0
        if (blind) blindFor -= 1
        const hits = blind ? [] : live(table).filter((r) => matches(r, where))
        return {
          rows: hits.slice(page.offset, page.offset + page.limit),
          total: hits.length,
          offset: page.offset,
          limit: page.limit,
          sortedBy: page.sortBy ?? "createdAt",
        }
      }),
    insert: (table: string, type: string, prefix: string, values: Record<string, unknown>) =>
      Effect.sync(() => {
        gate(table)
        enforce(table, values)
        seq += 1
        const row: Row = {
          id: `${prefix}-${seq}`,
          type,
          createdAt: new Date().toISOString(),
          deleted: false,
          ...values,
        }
        rowsOf(table).push(row)
        return row
      }),
    update: (table: string, id: string, patch: Record<string, unknown>) =>
      Effect.sync(() => {
        gate(table)
        const row = rowsOf(table).find((r) => r.id === id)
        if (!row) return undefined
        if (table === "contact_groups" && typeof patch["name"] === "string") {
          const key = indexKey(patch["name"])
          if (live(table).some((r) => r.id !== id && indexKey(String(r["name"] ?? "")) === key)) {
            throw duplicate(NAME_INDEX)
          }
        }
        Object.assign(row, patch)
        return row
      }),
  }

  const tools = {
    store,
    bus: { publish: (topic: string, payload: unknown) => Effect.sync(() => published.push({ topic, payload })) },
  } as unknown as CubeTools

  return {
    tools,
    parts: cube.create(tools),
    published,
    live,
    counted,
    pages,
    /** The kernel's gate shuts under a running process too: an index dropped after a successful
     *  write refuses the next one, with no restart and no memo. */
    shutGate: (table: string, index: string) => {
      shut.set(table, index)
    },
    /** The next `n` reads see nothing: the world another transaction has not committed yet. */
    blind: (n: number) => {
      blindFor = n
    },
  }
}

const admin = {
  id: "u1",
  username: "admin",
  roles: ["admin"],
  permissions: ["crm/contact-groups:read", "crm/contact-groups:write", "crm/contacts:read"],
  sessionId: "s1",
}
/** Holds every contact-group permission but may NOT read contacts. */
const groupsOnly = { ...admin, id: "u2", username: "groups-only", permissions: admin.permissions.slice(0, 2) }
const outsider = { ...admin, id: "u3", username: "outsider", roles: ["reader"], permissions: [] }

/** Every handler seen from the outside: request-shaped argument in, an Effect needing the caller
 *  out. The argument is cast at the call site the way the sibling cube's test does it -- the
 *  request shapes are the endpoints', and they are asserted separately above. */
type AnyHandler = (args: never) => Effect.Effect<unknown, unknown, CurrentUser>

const call = (handler: unknown, args: unknown, user: typeof admin = admin) =>
  Effect.runPromiseExit((handler as AnyHandler)(args as never).pipe(Effect.provideService(CurrentUser, user)))

const value = (exit: Exit.Exit<unknown, unknown>): Record<string, unknown> => {
  assert.ok(Exit.isSuccess(exit), `expected success, got ${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "?"}`)
  return exit.value as Record<string, unknown>
}
const failureTag = (exit: Exit.Exit<unknown, unknown>): string => {
  assert.ok(Exit.isFailure(exit), "expected a failure, got a success")
  const failure = Cause.failureOption(exit.cause)
  assert.ok(failure._tag === "Some", `expected a typed failure, got ${Cause.pretty(exit.cause)}`)
  return (failure.value as { _tag: string })._tag
}

type Parts = ReturnType<typeof makeTools>["parts"]
const create = (parts: Parts, name: string, user = admin) => call(parts.handlers.create, { payload: { name } }, user)
const addMember = (parts: Parts, id: unknown, contactId: string, user = admin) =>
  call(parts.handlers.addMember, { path: { id: String(id) }, payload: { contactId } }, user)

describe("contact-groups cube contract", () => {
  it("is a valid cube: manifest and handlers pass the kernel's own validators", () => {
    const { parts } = makeTools()
    assert.doesNotThrow(() => validateManifest("contact-groups", cube.manifest))
    assert.doesNotThrow(() => validateCubeParts("contact-groups", parts))
  })

  it("declares its own identity, its own tables and nothing of the kernel's access groups", () => {
    assert.equal(cube.manifest.name, "contact-groups")
    assert.equal(cube.manifest.parent, "crm")
    assert.equal(cube.manifest.entity, "ContactGroup")
    assert.deepEqual(cube.manifest.tables, ["contact_groups", "contact_group_members"])
    assert.equal(cube.manifest.requiresAuth, true)
    for (const p of cube.manifest.permissions ?? []) assert.ok(p.name.startsWith("crm/contact-groups:"), p.name)
    // Nothing here may reach into the kernel's permission cube: not its tables, not its
    // permissions, not its grants or memberships.
    const source = JSON.stringify(cube.manifest)
    for (const word of ["permission_groups", "permission_memberships", "permission_grants", '"permissions:'])
      assert.ok(!source.includes(word), word)
  })

  it("no endpoint carries two path parameters, and every one of them publishes 403", () => {
    // Both are mount-blocking rules of the kernel's entity mediation. The 403 check is
    // behavioural: a Forbidden that encodes against the endpoint's error schema IS in the union.
    const { parts } = makeTools()
    for (const [name, endpoint] of Object.entries(parts.group.endpoints)) {
      const e = endpoint as unknown as { path: string; errorSchema: Schema.Schema<unknown, unknown, never> }
      const params = e.path.split("/").filter((s) => s.startsWith(":"))
      assert.ok(params.length <= 1, `${name} has ${params.length} path parameters: ${e.path}`)
      assert.doesNotThrow(
        () =>
          Schema.encodeUnknownSync(e.errorSchema)(new Forbidden({ message: "no", needed: "crm/contact-groups:read" })),
        `${name} does not publish 403`,
      )
    }
  })

  it("removal is a POST with the pair in the payload, never DELETE /members/:contactId", () => {
    const { parts } = makeTools()
    const remove = parts.group.endpoints["removeMember"] as unknown as { path: string; method: string }
    assert.equal(remove.path, "/contact-groups/:id/members/remove")
    assert.equal(remove.method, "POST")
  })
})

describe("contact-groups: names", () => {
  it("creates a group, keeps the display name and derives the normalized one", async () => {
    const { parts, published } = makeTools()
    const group = value(await create(parts, "  Key Accounts  "))
    assert.equal(group["name"], "  Key Accounts  ")
    assert.equal(group["normalizedName"], "key accounts")
    assert.equal(group["type"], "ContactGroup")
    assert.deepEqual(published, [
      { topic: "crm/contact-groups.created", payload: { id: group["id"], title: group["name"] } },
    ])
  })

  it("refuses a blank name on create and on rename, with the same 400", async () => {
    const { parts } = makeTools()
    for (const blank of ["", "   ", "\t\n"]) {
      assert.equal(failureTag(await create(parts, blank)), "BadRequest", JSON.stringify(blank))
    }
    const group = value(await create(parts, "Ada"))
    const renamed = await call(parts.handlers.rename, { path: { id: group["id"] }, payload: { name: "  " } })
    assert.equal(failureTag(renamed), "BadRequest")
  })

  it("refuses a duplicate name differing only in case or in surrounding space", async () => {
    const { parts } = makeTools()
    value(await create(parts, "Key accounts"))
    assert.equal(failureTag(await create(parts, "KEY ACCOUNTS")), "Conflict")
    assert.equal(failureTag(await create(parts, "  key accounts  ")), "Conflict")
    // A genuinely different name is not a conflict.
    assert.ok(Exit.isSuccess(await create(parts, "Key accounts EMEA")))
  })

  it("refuses a rename onto another group's name and allows a group to respell its own", async () => {
    const { parts } = makeTools()
    const ada = value(await create(parts, "Ada"))
    value(await create(parts, "Grace"))
    const clash = await call(parts.handlers.rename, { path: { id: ada["id"] }, payload: { name: "grace" } })
    assert.equal(failureTag(clash), "Conflict")
    const respelled = value(await call(parts.handlers.rename, { path: { id: ada["id"] }, payload: { name: "ADA " } }))
    assert.equal(respelled["name"], "ADA ")
    assert.equal(respelled["normalizedName"], "ada")
  })

  it("answers 409 when only the DATABASE sees the clash (the race the pre-check cannot win)", async () => {
    // The pre-check reads an uncommitted world and finds nothing; the unique index still refuses
    // the insert. The caller must get the same 409 as in the ordinary case, never a 500.
    const { parts, blind } = makeTools()
    value(await create(parts, "Ada"))
    blind(1)
    assert.equal(failureTag(await create(parts, "ada")), "Conflict")
  })
})

describe("contact-groups: membership", () => {
  it("adds, lists and removes a member, and re-adding is idempotent", async () => {
    const { parts, live } = makeTools()
    const group = value(await create(parts, "Key accounts"))
    const first = value(await addMember(parts, group["id"], "cont-1"))
    assert.equal(first["groupId"], group["id"])
    assert.equal(first["type"], "ContactGroupMember")

    const again = value(await addMember(parts, group["id"], "cont-1"))
    assert.equal(again["id"], first["id"], "re-adding must return the same membership row")
    assert.equal(live("contact_group_members").length, 1, "re-adding must not create a second row")

    const page = value(await call(parts.handlers.members, { path: { id: group["id"] }, urlParams: {} }))
    assert.equal(page["total"], 1)

    const removed = value(
      await call(parts.handlers.removeMember, { path: { id: group["id"] }, payload: { contactId: "cont-1" } }),
    )
    assert.equal(removed["removed"], first["id"])
    assert.equal(live("contact_group_members").length, 0)

    // A removed membership can be added again, and gets a NEW row.
    const readded = value(await addMember(parts, group["id"], "cont-1"))
    assert.notEqual(readded["id"], first["id"])
  })

  it("stays idempotent when a concurrent caller wins the pair race", async () => {
    // The "is it already there" read sees nothing, the pair index refuses the insert. The caller
    // must still get the existing membership back -- never a 409, never a 500, and no second row.
    const { parts, live, blind } = makeTools()
    const group = value(await create(parts, "Key accounts"))
    const first = value(await addMember(parts, group["id"], "cont-1"))
    blind(1)
    const raced = value(await addMember(parts, group["id"], "cont-1"))
    assert.equal(raced["id"], first["id"])
    assert.equal(live("contact_group_members").length, 1)
  })

  it("says the RACE was lost, not that the index is broken, when the winning row vanishes", async () => {
    // The index refused the insert as a `duplicate`, so it is enforcing -- but the row that won the
    // race was soft-deleted before the re-read (`blind(2)` blinds the pre-check AND the re-read,
    // which is what a removed winner looks like from here). There is nothing to return, so it is
    // still a defect; what changed is the sentence. Blaming an absent index for this used to send an
    // operator to inspect a healthy one, and that false alarm is the whole point of the tag.
    const { parts, blind } = makeTools()
    const group = value(await create(parts, "Key accounts"))
    value(await addMember(parts, group["id"], "cont-1"))
    blind(2)
    const exit = await addMember(parts, group["id"], "cont-1")
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "nothing to return is not a 4xx")
    const text = Cause.pretty(exit.cause)
    assert.ok(text.includes("The invariant is intact"), text)
    assert.ok(text.includes("retry the request"), text)
    assert.ok(!text.includes("NOTHING is enforcing"), "a lost race must not be reported as a missing index")
    assert.ok(!text.includes("ensure-contact-group-indexes"), "and must not send an operator to the tool")
  })

  it("never removes a membership of another group", async () => {
    const { parts, live } = makeTools()
    const a = value(await create(parts, "A"))
    const b = value(await create(parts, "B"))
    value(await addMember(parts, a["id"], "cont-1"))
    const wrong = await call(parts.handlers.removeMember, { path: { id: b["id"] }, payload: { contactId: "cont-1" } })
    assert.equal(failureTag(wrong), "NotFound")
    assert.equal(live("contact_group_members").length, 1, "the other group's membership must survive")
  })

  it("refuses every member operation on a group that does not exist", async () => {
    const { parts } = makeTools()
    assert.equal(failureTag(await addMember(parts, "cgrp-none", "cont-1")), "NotFound")
    assert.equal(failureTag(await call(parts.handlers.members, { path: { id: "cgrp-none" }, urlParams: {} })), "NotFound")
    assert.equal(
      failureTag(
        await call(parts.handlers.removeMember, { path: { id: "cgrp-none" }, payload: { contactId: "cont-1" } }),
      ),
      "NotFound",
    )
    assert.equal(failureTag(await call(parts.handlers.get, { path: { id: "cgrp-none" } })), "NotFound")
  })

  it("a contact may be in several groups, and a group may be empty", async () => {
    const { parts, live } = makeTools()
    const a = value(await create(parts, "A"))
    const b = value(await create(parts, "B"))
    value(await create(parts, "Empty"))
    value(await addMember(parts, a["id"], "cont-1"))
    value(await addMember(parts, b["id"], "cont-1"))
    assert.equal(live("contact_group_members").length, 2)
    assert.equal(live("contact_groups").length, 3)
  })
})

describe("contact-groups: authorization", () => {
  it("refuses a caller with no contact-group permission", async () => {
    const { parts } = makeTools()
    assert.equal(failureTag(await create(parts, "Ada", outsider)), "Forbidden")
    assert.equal(failureTag(await call(parts.handlers.get, { path: { id: "x" } }, outsider)), "Forbidden")
  })

  it("requires crm/contacts:read exactly where a contact identity is exposed or attached", async () => {
    const { parts } = makeTools()
    const group = value(await create(parts, "Key accounts", groupsOnly))
    // The group itself is readable without it...
    assert.ok(Exit.isSuccess(await call(parts.handlers.get, { path: { id: group["id"] } }, groupsOnly)))
    // ...the members are not, and neither is attaching one.
    assert.equal(
      failureTag(await call(parts.handlers.members, { path: { id: group["id"] }, urlParams: {} }, groupsOnly)),
      "Forbidden",
    )
    assert.equal(failureTag(await addMember(parts, group["id"], "cont-1", groupsOnly)), "Forbidden")
  })
})

describe("contact-groups: the declared invariant", () => {
  it("declares BOTH unique indexes, with the exact names, key order and normalization", () => {
    // These specs ARE the invariant: the kernel renders the SQL from them and the operator CLI
    // reads the same array, so a change here changes the index on every database. The names are
    // the matcher keys Postgres reports as `constraint` on a 23505 and `onUniqueIndex` matches on.
    assert.deepEqual(cube.manifest.uniqueIndexes, [
      {
        table: "contact_groups",
        index: NAME_INDEX,
        keys: [{ body: "name", normalize: "lower-btrim" }],
        rows: "active",
      },
      {
        table: "contact_group_members",
        index: PAIR_INDEX,
        keys: [{ body: "groupId" }, { body: "contactId" }],
        rows: "active",
      },
    ])
    // One statement of it, shared with the CLI: the manifest holds the very array service.ts
    // exports, not a copy that could drift from it.
    assert.equal(cube.manifest.uniqueIndexes, UNIQUE_INDEXES)
    // Every declared table is one this cube owns, and the predicate is the only one there is.
    for (const spec of cube.manifest.uniqueIndexes ?? []) {
      assert.ok((cube.manifest.tables ?? []).includes(spec.table), spec.table)
      assert.equal(spec.rows, "active")
    }
  })

  it("does NOT declare usesBatch: the raw batch path would write around the indexes", () => {
    // The kernel refuses a mount that declares both (`uniqueIndexReasons`), because `batch` calls
    // neither ensureTable nor the write gate. The cube's one former use of it was a read-only
    // pg_indexes probe, which is now the kernel's gate, done properly -- including indisvalid.
    assert.equal(cube.manifest.usesBatch, undefined)
    assert.ok(!Object.hasOwn(cube.manifest, "usesBatch"))
    assert.doesNotThrow(() => validateManifest("contact-groups", cube.manifest))
  })

  it("touches no table on the read path any more: no warming, no probe, no privileged statement", async () => {
    // The old fresh-install deadlock (the pack's tool could not index a table the kernel had not
    // created) was closed by counting both tables behind every list. The kernel now creates the
    // table and its index together on first touch, so the list is a list again.
    const { parts, counted } = makeTools()
    value(await call(parts.handlers.list, { urlParams: {} }))
    assert.deepEqual(counted, [], "a plain list must not count tables to provoke DDL")
    assert.equal("batch" in (makeTools().tools.store as object), false, "no raw-SQL capability is used")
  })

  it("dies, and writes nothing, while the kernel's NAME gate is shut and no live row holds the name", async () => {
    // The gate throws before the statement runs, so the store double throws too. NOBODY holds the
    // name in this state -- the index is not there to hold it -- so a 409 ("already taken") would
    // be a false sentence to the caller AND would hide the incident from the operator. It is a
    // DEFECT: the kernel answers 500 with no details, and the log names the index and the tool.
    //
    // The decision is the kernel's TAG (`notReady`), not the outcome of a re-read, which is why the
    // operator sentence is now definite about the three states instead of hedging about a race.
    const { parts, live } = makeTools({ shut: { contact_groups: NAME_INDEX } })
    const exit = await create(parts, "Ada")
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "a shut NAME gate is a defect, not a 4xx")
    const text = Cause.pretty(exit.cause)
    assert.ok(text.includes("NOTHING is enforcing this invariant"), text)
    assert.ok(text.includes("refused before the statement ran"), text)
    assert.ok(text.includes(NAME_INDEX), "the operator log must name the index")
    assert.ok(text.includes("ensure-contact-group-indexes"), "and the command that inspects it")
    assert.equal(live("contact_groups").length, 0, "nothing may be written while the gate is shut")
  })

  it("a RENAME refused by a shut NAME gate is the same defect, and changes nothing", async () => {
    // The group exists and the new name is free, so the only thing that can refuse the update is
    // the gate. `update` is a write and is gated exactly like `insert`; the caller must not be told
    // "that name is already taken" when nothing holds it.
    const { parts, live, shutGate } = makeTools()
    const ada = value(await create(parts, "Ada"))
    shutGate("contact_groups", NAME_INDEX)
    const exit = await call(parts.handlers.rename, { path: { id: ada["id"] }, payload: { name: "Grace" } })
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "a shut NAME gate on rename is a defect, not a 409")
    const text = Cause.pretty(exit.cause)
    assert.ok(text.includes(NAME_INDEX), text)
    assert.ok(text.includes("ensure-contact-group-indexes"), text)
    assert.equal(live("contact_groups")[0]?.["name"], "Ada", "the name may not change while the gate is shut")
  })

  it("a rename onto the group's OWN name is not reported as somebody else's duplicate", async () => {
    // A respelling of the row's OWN name does not violate the index -- an UPDATE that keeps the
    // row's index key is not a conflict with itself -- so the only thing that can refuse it is the
    // gate, and the gate's refusal is the operator's defect. There is no `selfId` bookkeeping left:
    // a `duplicate` tag on rename is by construction somebody else's row.
    const { parts, shutGate } = makeTools()
    const ada = value(await create(parts, "Ada"))
    shutGate("contact_groups", NAME_INDEX)
    const exit = await call(parts.handlers.rename, { path: { id: ada["id"] }, payload: { name: "ADA" } })
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "its own name is never a conflict")
  })

  it("a shut gate stays a defect even when a live row happens to hold the name", async () => {
    // The refusal came from the GATE: the index is absent, so it is enforcing nothing and no name is
    // obtainable at all. That another row happens to hold this one does not make "already exists"
    // the right answer -- it would send the caller away with a 409 while the invariant is down and
    // the operator never hears about it. The tag decides; what the table contains does not.
    const { parts, blind, shutGate } = makeTools()
    value(await create(parts, "Ada"))
    shutGate("contact_groups", NAME_INDEX)
    blind(1)
    const exit = await create(parts, "ada")
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "a shut gate is an incident, not a conflict")
    assert.ok(Cause.pretty(exit.cause).includes("NOTHING is enforcing this invariant"), Cause.pretty(exit.cause))
  })

  it("CREATE: a real 23505 is a 409 even where the index's key and JavaScript's diverge", async () => {
    // The regression this pair of tests exists for. `ΟΔΟΣ` is stored with `normalizedName` =
    // `οδος` (JavaScript's final sigma), while the index holds `οδοσ` (Postgres's `lower`). Creating
    // `οδοσ` therefore:
    //   * passes the pre-check -- it looks for `normalizedName = 'οδοσ'` and no row has it;
    //   * is refused by the index, which sees the same key twice;
    //   * and cannot be explained by a re-read, which looks up the same field and finds nothing.
    // Classifying by re-read answered this with `Effect.die` -- a 500 for the user plus an operator
    // alarm naming a perfectly healthy index. The index spoke, so the index exists: 409.
    const { parts, live } = makeTools({ indexKey: pgNameKey })
    value(await create(parts, "ΟΔΟΣ"))
    assert.equal(live("contact_groups")[0]?.["normalizedName"], "οδος", "the cube's key really is the other one")
    const exit = await create(parts, "οδοσ")
    assert.equal(failureTag(exit), "Conflict")
    assert.ok(Exit.isFailure(exit))
    const failure = Cause.failureOption(exit.cause)
    assert.ok(failure._tag === "Some")
    const message = String((failure.value as { message: string }).message)
    assert.match(message, /already exists/)
    assert.ok(!message.includes(NAME_INDEX), message)
    assert.ok(!message.includes("23505"), message)
    assert.equal(live("contact_groups").length, 1, "the duplicate is refused, not written")
  })

  it("RENAME: the same divergence is the same 409, and the row keeps its old name", async () => {
    const { parts, live } = makeTools({ indexKey: pgNameKey })
    value(await create(parts, "ΟΔΟΣ"))
    const other = value(await create(parts, "Key accounts"))
    const exit = await call(parts.handlers.rename, { path: { id: other["id"] }, payload: { name: "οδοσ" } })
    assert.equal(failureTag(exit), "Conflict")
    assert.ok(Exit.isFailure(exit))
    const failure = Cause.failureOption(exit.cause)
    assert.ok(failure._tag === "Some")
    assert.match(String((failure.value as { message: string }).message), /already exists/)
    assert.equal(live("contact_groups").find((r) => r.id === other["id"])?.["name"], "Key accounts")
  })

  it("shuts again when an index is lost after a successful write, with no restart and no memo", async () => {
    // A NEW name, so nothing holds it: the refusal is the gate's and the answer is the operator's
    // defect, not a 409 that would blame a group nobody can name.
    const { parts, live, shutGate } = makeTools()
    value(await create(parts, "Ada"))
    shutGate("contact_groups", NAME_INDEX)
    const exit = await create(parts, "Grace")
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "a lost index is a defect, not a conflict")
    assert.equal(live("contact_groups").length, 1, "only the write made while the index existed may stand")
  })

  it("a shut gate on the MEMBERS table is a defect, not a fake idempotent success", async () => {
    // addMember treats a refused pair as "someone else got there first" and returns the live row.
    // When the refusal is the GATE, inventing that answer would be a lie -- nothing is enforcing the
    // pair at all -- so the tag is checked BEFORE the re-read and it dies with the kernel's reason.
    const { parts, live } = makeTools({ shut: { contact_group_members: PAIR_INDEX } })
    const group = value(await create(parts, "Key accounts"))
    const exit = await addMember(parts, group["id"], "cont-1")
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "a missing membership index is a defect, not a 4xx")
    const text = Cause.pretty(exit.cause)
    assert.ok(text.includes("NOTHING is enforcing this invariant"), text)
    assert.ok(text.includes(PAIR_INDEX), "the operator log must name the index")
    assert.ok(text.includes("ensure-contact-group-indexes"), "and the command that inspects it")
    assert.equal(live("contact_group_members").length, 0)
  })

  it("a REMOVAL refused by the shut MEMBERS gate is a defect, and the membership survives", async () => {
    // A soft delete IS an update, so it goes through the same write gate -- the write the pack's
    // old readiness check never covered. There is no mapping on this path and there must not be
    // one: a removal cannot be answered with a conflict or a 404, and reporting success while the
    // row is still live would be the worst answer of the three. It dies; the row stays.
    const { parts, live, shutGate } = makeTools()
    const group = value(await create(parts, "Key accounts"))
    const member = value(await addMember(parts, group["id"], "cont-1"))
    shutGate("contact_group_members", PAIR_INDEX)
    const exit = await call(parts.handlers.removeMember, { path: { id: group["id"] }, payload: { contactId: "cont-1" } })
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.failureOption(exit.cause)._tag, "None", "a shut gate on removal is a defect, not a 4xx")
    assert.ok(Cause.pretty(exit.cause).includes(PAIR_INDEX), "the kernel's own reason names the index")
    assert.equal(live("contact_group_members").length, 1, "the membership may not be removed while the gate is shut")
    assert.equal(live("contact_group_members")[0]?.id, member["id"])
  })

  it("orders members only by fields a membership row HAS, with a deterministic default", () => {
    // `?sort=name` used to reach `ORDER BY body -> 'name'`, which is NULL on every membership row:
    // Postgres may then return any order it likes and pages repeat or drop rows.
    const asked = (sortBy?: string) => memberPageRequest({ offset: 0, limit: 25, sortBy, descending: false })
    assert.equal(asked("name").sortBy, "id", "a group field must not order membership rows")
    assert.equal(asked(undefined).sortBy, "id", "the default must be unique, so paging is stable")
    assert.equal(asked("normalizedName").sortBy, "id")
    assert.equal(asked("createdAt").sortBy, "createdAt")
    assert.equal(asked("id").sortBy, "id")
    // Everything else about the request is the caller's and is left alone.
    assert.deepEqual(memberPageRequest({ offset: 50, limit: 10, sortBy: "name", descending: true }), {
      offset: 50,
      limit: 10,
      sortBy: "id",
      descending: true,
    })
  })

  it("the members endpoint asks the store for that ordering and reports it back honestly", async () => {
    const { parts, pages } = makeTools()
    const group = value(await create(parts, "Key accounts"))
    value(await addMember(parts, group["id"], "cont-1"))
    const page = value(
      await call(parts.handlers.members, { path: { id: group["id"] }, urlParams: { sort: "name:desc" } }),
    )
    const issued = pages.filter((p) => p.table === "contact_group_members").at(-1)
    assert.equal(issued?.page.sortBy, "id")
    assert.equal(page["sortedBy"], "id", "the caller must be told which ordering was really used")
  })
  it("maps only its OWN named index, hands the reason over, and re-dies everything else", async () => {
    // `onUniqueIndex` (qwbe-core/errors) matches TWO conditions on ONE index name: the driver's
    // 23505 carrying it, and the write gate's UniqueIndexNotReady for it. Nothing else, ever --
    // a cube that swallowed another constraint's 23505 would report a system fault as its own 409.
    // Both mappings are the SAME seam now (`onIndexRefusal`): the reason is handed to a recovery
    // that re-reads, because only the database can say whether anything holds the key.
    const seen: Array<string> = []
    const recover = (reason: string) => {
      seen.push(reason)
      return Effect.succeed("recovered")
    }
    const named = await Effect.runPromiseExit(Effect.die(duplicate(NAME_INDEX)).pipe(onNameTaken(recover)))
    assert.deepEqual(named, Exit.succeed("recovered"))

    const notReady = await Effect.runPromiseExit(
      Effect.die(new UniqueIndexNotReady(NAME_INDEX, "absent")).pipe(onNameTaken(recover)),
    )
    assert.deepEqual(notReady, Exit.succeed("recovered"))
    // A duplicate and a shut gate are NOT the same situation, so the recovery is told which.
    assert.equal(seen.length, 2)
    assert.notEqual(seen[0], seen[1], seen.join(" | "))

    const foreign = await Effect.runPromiseExit(Effect.die(duplicate("contact_groups_pkey")).pipe(onNameTaken(recover)))
    assert.ok(Exit.isFailure(foreign))
    assert.equal(Cause.failureOption(foreign.cause)._tag, "None", "another constraint's 23505 must stay a defect")

    const otherIndex = await Effect.runPromiseExit(
      Effect.die(new UniqueIndexNotReady(PAIR_INDEX, "absent")).pipe(onNameTaken(recover)),
    )
    assert.ok(Exit.isFailure(otherIndex))
    assert.equal(Cause.failureOption(otherIndex.cause)._tag, "None", "another index's gate is not this one's business")

    const other = await Effect.runPromiseExit(
      Effect.die(Object.assign(new Error("fk"), { code: "23503", constraint: NAME_INDEX })).pipe(
        onNameTaken(recover),
      ),
    )
    assert.ok(Exit.isFailure(other))
    assert.equal(Cause.failureOption(other.cause)._tag, "None", "another error code must stay a defect")
    assert.equal(seen.length, 2, "an unrelated defect must never reach the recovery")
  })

  it("keeps a typed failure of the write itself out of the refusal seam", async () => {
    // The seam catches its OWN sentinel and nothing else: a typed failure travelling through it
    // must arrive unchanged, or a Conflict raised elsewhere would be re-answered as a refusal.
    const recover = () => Effect.succeed("recovered")
    const passed = await Effect.runPromiseExit(
      Effect.fail(new Conflict({ message: "someone else's 409" })).pipe(onNameTaken(recover)),
    )
    assert.equal(failureTag(passed), "Conflict")
  })

  it("hands the pair refusal to the recovery WITH the reason, and re-dies anything unrelated", async () => {
    const seen: Array<string> = []
    const recover = (reason: string) => {
      seen.push(reason)
      return Effect.succeed("recovered")
    }
    const dup = await Effect.runPromiseExit(Effect.die(duplicate(PAIR_INDEX)).pipe(onPairTaken(recover)))
    assert.deepEqual(dup, Exit.succeed("recovered"))

    const gate = await Effect.runPromiseExit(
      Effect.die(new UniqueIndexNotReady(PAIR_INDEX, "absent")).pipe(onPairTaken(recover)),
    )
    assert.deepEqual(gate, Exit.succeed("recovered"))
    // The two conditions are NOT the same situation, and the recovery is the only place that can
    // tell them apart -- so it is told which one happened.
    assert.equal(seen.length, 2)
    assert.notEqual(seen[0], seen[1], seen.join(" | "))

    const foreign = await Effect.runPromiseExit(Effect.die(duplicate(NAME_INDEX)).pipe(onPairTaken(recover)))
    assert.ok(Exit.isFailure(foreign))
    assert.equal(Cause.failureOption(foreign.cause)._tag, "None", "the name index is not the pair index")
    assert.equal(seen.length, 2, "an unrelated defect must never reach the recovery")
  })
})
