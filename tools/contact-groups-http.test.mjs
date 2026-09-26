// The contact-groups cube over REAL HTTP, on a throwaway kernel and a throwaway database.
//
// Why this file exists: every other test in this pack proves a piece. The handler tests use a
// store double, so they cannot see the kernel's entity mediation, its lazy table creation or its
// permission filtering; the index-tool test creates the tables by hand, so it cannot see a fresh
// install at all. Two defects hid in exactly that gap -- a fresh install that could never accept
// its first write, and a readiness answer memoized for the life of the process -- so the whole
// lifecycle is exercised here, against a server, in order:
//
//   1. install -> a plain authorized GET /contact-groups creates the groups table AND its declared
//      unique index (the kernel owns that now, from manifest.uniqueIndexes), so the FIRST write
//      succeeds with no operator step at all; each table is created, and indexed, on ITS own first
//      touch -- the pack no longer warms tables it has not been asked for;
//   2. the retained tool agrees with the running kernel: nothing to do, and the definition it
//      renders from the cube's declaration is byte-for-byte what the kernel wrote;
//   3. names: duplicate 409, rename 409, respelling one's own name 200;
//  3b. the 409 only the INDEX can raise: a clash the JavaScript pre-check cannot see, because
//      `lower()` and `toLowerCase` disagree on a word-final Greek sigma, on create AND on rename --
//      the case that used to come back as a 500 plus a false operator alarm about a healthy index;
//   4. membership: two concurrent adds of the SAME pair -> one row, both callers get it;
//   5. an index dropped after a successful write shuts the write gate again -- the kernel's
//      installer does NOT retry (ensureTable is memoized per table for the life of the process),
//      which is exactly why the tool is retained -- and the tool reopens it with no restart;
//   6. an index carrying the right NAME with the wrong json key is refused, not accepted;
//   7. a 23505 from an unrelated constraint stays a defect, not a 409;
//   8. the SHARING BOUNDARY, as evidence rather than prose: an unreadable group is 403; a caller
//      without crm/contacts:read gets 403 on the member routes; reading a group one may read
//      creates no grant and changes nothing about contact visibility -- a contact the caller may
//      not read stays UNAVAILABLE through the contacts API, name included.
//
// Nothing outside the throwaway database and the temp copy of core is touched: the qwbe checkout
// is read-only here, exactly as in import.test.mjs, whose harness recipe this follows.
//
// Run:  QWBE_REPO=/path/to/qwbe QWBE_PG_PASSWORD=... node --test tools/contact-groups-http.test.mjs

import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import pg from "pg"
import { requireDbUrl } from "./db-url.mjs"
import { dropThrowawayDb } from "./drop-throwaway-db.mjs"
import { GROUP_ENTITY, NAME_INDEX, PAIR_INDEX, SCHEMA } from "../cubes/crm/contact-groups/service.ts"
import { TARGETS, indexSql, normalizeIndexDef } from "./ensure-contact-group-indexes.mjs"

const here = new URL(".", import.meta.url).pathname
const repoRoot = join(here, "..")
const qwbeRepo = process.env.QWBE_REPO

describe("crm/contact-groups over HTTP (throwaway kernel)", { skip: !qwbeRepo && "QWBE_REPO not set" }, () => {
  let base, dbUrl, stop, adminToken
  let core

  const login = async (username, password) => {
    const r = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    assert.ok(r.ok, `login ${username}: HTTP ${r.status}`)
    return (await r.json()).token
  }

  /** One request. Returns status AND body, because a status alone would hide what leaked. */
  const call = async (token, method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await r.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: r.status, body: json, text }
  }

  const sql = async (text, values = []) => {
    const c = new pg.Client({ connectionString: dbUrl })
    await c.connect()
    try {
      return await c.query(text, values)
    } finally {
      await c.end()
    }
  }

  /** The operator's tool, exactly as an operator runs it. Returns stdout+stderr and the code. */
  const tool = (args) => {
    try {
      const out = execFileSync(process.execPath, [join(here, "ensure-contact-group-indexes.mjs"), ...args], {
        encoding: "utf8",
        env: { ...process.env, QWBE_DATABASE_URL: dbUrl },
      })
      return { out, status: 0 }
    } catch (e) {
      return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), status: e.status }
    }
  }

  /** A user with exactly the capabilities named and NOTHING else: the role is one nobody
   *  declares, so the account starts with zero permissions. */
  const makeUser = async (username, capabilities) => {
    const created = await call(adminToken, "POST", "/account", {
      username,
      password: "secret",
      roles: ["cg-http-test"],
    })
    assert.equal(created.status, 200, created.text)
    for (const capability of capabilities) {
      const granted = await call(adminToken, "POST", "/permissions/capabilities/user", { capability, username })
      assert.equal(granted.status, 200, granted.text)
    }
    return await login(username, "secret")
  }

  before(async () => {
    const lib = await import(join(qwbeRepo, "probes/lib.mjs"))
    const port = await lib.freePort()
    base = `http://127.0.0.1:${port}`

    core = join(mkdtempSync(join(tmpdir(), "cghttp-core-")), "core")
    cpSync(join(qwbeRepo, "core"), core, { recursive: true })
    rmSync(join(core, "plugins", "crm-pack"), { recursive: true, force: true })
    cpSync(join(repoRoot, "cubes"), join(core, "plugins", "crm-pack", "cubes"), { recursive: true })
    cpSync(join(repoRoot, "qwbe-package.json"), join(core, "plugins", "crm-pack", "qwbe-package.json"))

    // Same source of truth as the pack's other real-server test: QWBE_DATABASE_URL, or the
    // QWBE_PG_* spelling. Never a default, and the string is never printed.
    const adminUrl = requireDbUrl()
    adminUrl.pathname = "/postgres"
    const dbName = `qwbe_cghttp_${randomBytes(4).toString("hex")}`
    if (!dbName.startsWith("qwbe_cghttp_")) throw new Error("refusing: throwaway database name guard")
    const adminPool = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 })
    await adminPool.query(`CREATE DATABASE "${dbName}"`)
    await adminPool.end()
    const url = new URL(adminUrl.toString())
    url.pathname = `/${dbName}`
    dbUrl = url.toString()

    const proc = spawn(process.execPath, ["src/main.ts"], {
      cwd: core,
      env: {
        ...process.env,
        QWBE_PORT: String(port),
        QWBE_ADMIN_PASSWORD: "admin",
        QWBE_READER_PASSWORD: "reader",
        QWBE_DATABASE_URL: dbUrl,
        QWBE_LEGACY_MIGRATIONS:
          "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack,bookmarks:example-plugin,tags:example-plugin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    proc.stdout.on("data", (d) => (output += d))
    proc.stderr.on("data", (d) => (output += d))
    let alive = false
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 250))
      if (proc.exitCode !== null) break
      try {
        const r = await fetch(`${base}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "admin" }),
        })
        if (r.ok) {
          alive = true
          break
        }
      } catch {}
    }
    if (!alive) throw new Error(`server did not start:\n${output}`)
    stop = async () => {
      proc.kill("SIGTERM")
      const a = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 })
      await dropThrowawayDb(a, dbName).catch(() => {})
      await a.end()
      rmSync(core, { recursive: true, force: true })
    }

    adminToken = await login("admin", "admin")
    const cubes = await call(adminToken, "GET", "/settings/cubes")
    const names = (cubes.body ?? []).map((c) => c.name)
    assert.ok(names.includes("crm/contact-groups"), `contact-groups not mounted: ${names.join(", ")}`)
  })

  after(async () => {
    if (stop) await stop()
  })

  // state shared by the ordered steps below
  let groupId, contactOfAdmin

  it("1. fresh install: the kernel creates each table WITH its index on first touch", async () => {
    const tables = async () =>
      (
        await sql(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`, [SCHEMA])
      ).rows.map((r) => r.table_name)
    /** Only a VALID, READY index enforces anything, so both catalog flags are read, not just the name. */
    const indexes = async () =>
      (
        await sql(
          `SELECT ci.relname AS index, i.indisvalid, i.indisready
             FROM pg_index i
             JOIN pg_class ci ON ci.oid = i.indexrelid
             JOIN pg_namespace n ON n.oid = ci.relnamespace
            WHERE n.nspname = $1 AND ci.relname = ANY($2::text[])
            ORDER BY 1`,
          [SCHEMA, [NAME_INDEX, PAIR_INDEX]],
        )
      ).rows

    // Nothing exists yet: this is a genuinely fresh install.
    assert.deepEqual(await tables(), [])

    // An ordinary authorized read. It creates the groups table and, because the cube DECLARES its
    // invariant, the kernel installs that table's unique index in the same first touch.
    const list = await call(adminToken, "GET", "/contact-groups?limit=1")
    assert.equal(list.status, 200, list.text)
    assert.equal(list.body.total, 0)
    assert.deepEqual(await tables(), ["contact_groups"])
    assert.deepEqual(await indexes(), [{ index: NAME_INDEX, indisvalid: true, indisready: true }])

    // And the FIRST write succeeds: no operator step, no readiness check in the pack, no warmed
    // tables. This is the B3 change, stated against a server.
    const created = await call(adminToken, "POST", "/contact-groups", { name: "Key accounts" })
    assert.equal(created.status, 200, created.text)
    assert.equal(created.body.name, "Key accounts")
    assert.equal(created.body.normalizedName, "key accounts")
    groupId = created.body.id

    // The members table is untouched until something asks for it -- and then it arrives WITH its
    // own index, by the same rule.
    const members = await call(adminToken, "GET", `/contact-groups/${groupId}/members`)
    assert.equal(members.status, 200, members.text)
    assert.equal(members.body.total, 0)
    assert.deepEqual(await tables(), ["contact_group_members", "contact_groups"])
    assert.deepEqual(await indexes(), [
      { index: PAIR_INDEX, indisvalid: true, indisready: true },
      { index: NAME_INDEX, indisvalid: true, indisready: true },
    ])
  })

  it("2. the retained tool sees nothing to do, and renders exactly what the kernel wrote", async () => {
    const dry = tool([])
    assert.equal(dry.status, 0, dry.out)
    assert.match(dry.out, /nothing to do/)
    assert.doesNotMatch(dry.out, /ABSENT/)

    // Two renderers, one declaration: the kernel built these indexes from manifest.uniqueIndexes,
    // the tool renders its expectation from the same array. Drift between them would make the tool
    // report a healthy install as broken, so it is asserted against the real catalog here.
    for (const target of TARGETS) {
      const rendered = (
        await sql(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [SCHEMA, target.index])
      ).rows[0].indexdef
      assert.equal(normalizeIndexDef(rendered), target.def, `${target.index} as written by the KERNEL`)
    }

    const applied = tool(["--apply", "--i-understand"])
    assert.equal(applied.status, 0, applied.out)
    assert.match(applied.out, /scanned 2 created 0 exists 2 skipped 0 failed 0/)
  })

  it("3. duplicate name 409, rename onto another name 409, respelling one's own name 200", async () => {
    const dup = await call(adminToken, "POST", "/contact-groups", { name: "  KEY ACCOUNTS " })
    assert.equal(dup.status, 409, dup.text)

    const other = await call(adminToken, "POST", "/contact-groups", { name: "Newsletter" })
    assert.equal(other.status, 200, other.text)
    const clash = await call(adminToken, "PATCH", `/contact-groups/${other.body.id}`, { name: "key accounts" })
    assert.equal(clash.status, 409, clash.text)

    const respelled = await call(adminToken, "PATCH", `/contact-groups/${groupId}`, { name: "KEY Accounts" })
    assert.equal(respelled.status, 200, respelled.text)
    assert.equal(respelled.body.name, "KEY Accounts")
    assert.equal(respelled.body.normalizedName, "key accounts")

    const blank = await call(adminToken, "POST", "/contact-groups", { name: "   " })
    assert.equal(blank.status, 400, blank.text)
  })

  it("3b. the INDEX alone sees the clash: create 409 and rename 409 where the pre-check misses", async () => {
    // The 409 that only the DATABASE can raise, over real HTTP, with no doubles and no `blind`.
    //
    // The pre-check compares `normalizedName`, which the cube builds with JavaScript's
    // `trim().toLowerCase()`. The index compares Postgres's `lower(btrim(...))`. The two disagree on
    // a word-final Greek sigma: JavaScript lowercases Σ to ς (U+03C2), `lower()` to σ (U+03C3).
    // Asserted against THIS server below, not assumed, because the whole case rests on it.
    //
    // So `ΟΔΟΣ` is stored with `normalizedName = 'οδος'` while the index holds `οδοσ`. A caller
    // asking for `οδοσ`:
    //   * passes the pre-check, which looks for a row whose `normalizedName` is `οδοσ` -- there is
    //     none;
    //   * is refused by the index, which sees the same key twice;
    //   * and cannot be explained by re-reading `normalizedName`, which misses for the same reason
    //     the pre-check did.
    // Classifying that refusal by re-read answered it with a 500 and an operator alarm naming a
    // perfectly healthy index. The kernel's refusal is TAGGED now (`UniqueIndexRefusal`,
    // qwbe-core/errors), so a `duplicate` is the ordinary 409 whatever the re-read finds.
    //
    // No real data is involved: both names are created and removed inside this test.
    const diverges = await sql(`SELECT lower($1::text) = $2::text AS pg_sigma`, ["ΟΔΟΣ", "οδοσ"])
    assert.equal(diverges.rows[0].pg_sigma, true, "this server's lower() must fold a final Σ to σ")
    assert.equal("ΟΔΟΣ".toLowerCase(), "οδος", "and JavaScript's must not -- otherwise there is no gap")

    const greek = await call(adminToken, "POST", "/contact-groups", { name: "ΟΔΟΣ" })
    assert.equal(greek.status, 200, greek.text)
    assert.equal(greek.body.normalizedName, "οδος", "the cube's key really is the other one")

    // CREATE: the index is the only thing that can see this clash.
    const created = await call(adminToken, "POST", "/contact-groups", { name: "οδοσ" })
    assert.equal(created.status, 409, `the index refused it, so it must be a 409, not a 500: ${created.text}`)
    assert.match(created.body.message ?? created.text, /already exists/)
    // A real 409 may repeat the name the caller sent; it may say nothing about the storage.
    for (const secret of [NAME_INDEX, SCHEMA, "ensure-contact-group-indexes", "23505", "lower("]) {
      assert.ok(!created.text.toLowerCase().includes(secret.toLowerCase()), `409 body leaked ${secret}: ${created.text}`)
    }

    // RENAME: same gap, same answer, and the row keeps its old name.
    const victim = await call(adminToken, "POST", "/contact-groups", { name: "Sigma test" })
    assert.equal(victim.status, 200, victim.text)
    const renamed = await call(adminToken, "PATCH", `/contact-groups/${victim.body.id}`, { name: "οδοσ" })
    assert.equal(renamed.status, 409, `a rename refused by the index is a 409, not a 500: ${renamed.text}`)
    const unchanged = await call(adminToken, "GET", `/contact-groups/${victim.body.id}`)
    assert.equal(unchanged.body.name, "Sigma test", "a refused rename may not change the row")

    // Exactly one row holds the key: the index really did refuse both writes.
    const held = await sql(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_groups ` +
        `WHERE deleted = false AND lower(btrim(body->>'name')) = $1`,
      ["οδοσ"],
    )
    assert.equal(held.rows[0].n, 1)

    // Cleaned up so the later lifecycle cases see the state they expect.
    await sql(`UPDATE "${SCHEMA}".contact_groups SET deleted = true WHERE id = ANY($1)`, [
      [greek.body.id, victim.body.id],
    ])
  })

  it("4. two CONCURRENT adds of the same pair leave one row, and both callers get it", async () => {
    const contact = await call(adminToken, "POST", "/contacts", { name: "Ada Lovelace", email: "ada@example.test" })
    assert.equal(contact.status, 200, contact.text)
    contactOfAdmin = contact.body.id

    const [a, b] = await Promise.all([
      call(adminToken, "POST", `/contact-groups/${groupId}/members`, { contactId: contactOfAdmin }),
      call(adminToken, "POST", `/contact-groups/${groupId}/members`, { contactId: contactOfAdmin }),
    ])
    assert.equal(a.status, 200, a.text)
    assert.equal(b.status, 200, b.text)
    assert.equal(a.body.id, b.body.id, "both callers must get the SAME membership row, never a 409")
    const live = await sql(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_group_members WHERE deleted = false AND body->>'groupId' = $1`,
      [groupId],
    )
    assert.equal(live.rows[0].n, 1, "a concurrent duplicate must not create a second row")

    // The member list is ordered by a field a membership row HAS, and says so.
    const page = await call(adminToken, "GET", `/contact-groups/${groupId}/members?sort=name`)
    assert.equal(page.status, 200, page.text)
    assert.equal(page.body.sortedBy, "id", "a group field must never order membership rows")
    assert.equal(page.body.total, 1)
    assert.equal(page.body.rows[0].contactId, contactOfAdmin)
  })

  it("5. an index lost AFTER a successful write shuts the gate again, and the tool reopens it", async () => {
    await sql(`DROP INDEX "${SCHEMA}"."${NAME_INDEX}"`)
    const refused = await call(adminToken, "POST", "/contact-groups", { name: "After the drop" })
    // The kernel's write gate reads the catalog on every write, so the loss is seen at once -- and
    // what the CALLER is told is decided by the refusal's TAG (`UniqueIndexRefusal.reason`), not by
    // re-reading the table: `notReady` is this defect, `duplicate` is the 409. An earlier round did
    // classify by re-read; that inference is gone, because the re-read used the cube's JavaScript
    // `normalizedName` and the index uses Postgres `lower(btrim(...))` (case 3b).
    //
    // Nobody holds "After the drop": the index is simply gone, so every writer is refused and no
    // name is available at all. That is a DEFECT, not a conflict. This used to answer 409
    // "reconciled", which is a false sentence -- it tells the caller somebody else has the name
    // when nobody does, invites a retry that cannot ever succeed, and hides the incident from the
    // operator, since a 409 is an ordinary business answer nobody pages on. 409 is now reserved
    // for a real duplicate -- either caught by the pre-check (below, a read, not gated) or told by
    // the index itself through a `duplicate` tag (case 3b).
    assert.equal(refused.status, 500, refused.text)
    // A defect body carries NOTHING: the index name, the schema, the kernel's reason and the
    // command that repairs it are the OPERATOR's, and they go to the log (see `indexNotReady`,
    // cubes/crm/contact-groups/service.ts). In an HTTP body they would hand an unprivileged
    // caller the storage layout and the repair command.
    for (const secret of [NAME_INDEX, SCHEMA, "ensure-contact-group-indexes", "index", "invalid", "reconciled"]) {
      assert.ok(
        !refused.text.toLowerCase().includes(secret.toLowerCase()),
        `the 500 body leaked ${JSON.stringify(secret)}: ${refused.text}`,
      )
    }
    assert.doesNotMatch(refused.text, /pg_|CREATE |lower\(/)
    const absent = await sql(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_groups WHERE body->>'name' = 'After the drop'`,
    )
    assert.equal(absent.rows[0].n, 0, "nothing may be written while the gate is shut")

    // Reads are unaffected while the gate is shut: that is what keeps the repair possible.
    const stillReadable = await call(adminToken, "GET", "/contact-groups?limit=5")
    assert.equal(stillReadable.status, 200, stillReadable.text)

    // ...and the other half of the picture, still with the index gone: a name a LIVE row really
    // holds is a 409 -- but it comes from the PRE-CHECK, which is a read and is not gated, not from
    // the refusal. Once the gate has spoken there is nothing left to decide: a `notReady` refusal is
    // the operator's incident above, whatever the table contains, because nothing is enforcing the
    // invariant and no name is obtainable. The 409 that only the INDEX can raise is case 3b, where
    // the index is healthy and the pre-check is the thing that misses.
    // Written with SQL because the gate would refuse the kernel this insert.
    await sql(
      `INSERT INTO "${SCHEMA}".contact_groups (id, type, created_at, deleted, body) ` +
        `VALUES ($1, $2, now(), false, $3)`,
      ["cgrp-held", GROUP_ENTITY, JSON.stringify({ name: "Held name", normalizedName: "held name" })],
    )
    const held = await call(adminToken, "POST", "/contact-groups", { name: "  HELD NAME  " })
    assert.equal(held.status, 409, held.text)
    assert.match(held.body.message ?? held.text, /already exists/)
    // A real 409 may name the name the caller sent -- and nothing of the storage.
    assert.ok(!held.text.includes(NAME_INDEX), held.text)
    await sql(`UPDATE "${SCHEMA}".contact_groups SET deleted = true WHERE id = 'cgrp-held'`)

    const applied = tool(["--apply", "--i-understand"])
    assert.equal(applied.status, 0, applied.out)
    assert.match(applied.out, /created 1 exists 1/)
    const accepted = await call(adminToken, "POST", "/contact-groups", { name: "After the repair" })
    assert.equal(accepted.status, 200, "the running process must heal with no restart")
  })

  it("6. an index with the right NAME and the wrong json key is refused, not accepted", async () => {
    // The exact forgery the review reproduced: 'groupid' instead of 'groupId'. Every row's key is
    // then (NULL, NULL), so the index enforces nothing -- and the old lowercase-everything
    // normalizer could not tell it from the real one.
    await sql(`DROP INDEX "${SCHEMA}"."${PAIR_INDEX}"`)
    await sql(
      `CREATE UNIQUE INDEX "${PAIR_INDEX}" ON "${SCHEMA}".contact_group_members ` +
        `((body ->> 'groupid'), (body ->> 'contactid')) WHERE deleted = false`,
    )
    const refused = await call(adminToken, "POST", `/contact-groups/${groupId}/members`, { contactId: "cont-forged" })
    assert.equal(refused.status, 500, "a same-named index with a different definition is not readiness")
    // ...and the 500 says NOTHING about why. The operator's sentence -- the index name, the
    // schema, the kernel's reason, the command that inspects it -- is a LOG line (see
    // `indexNotReady`, cubes/crm/contact-groups/service.ts); putting it in an HTTP body would hand
    // an unprivileged caller the storage layout and the repair command. The kernel answers a
    // defect with a bare 500 (core/src/kernel/install-parts.ts), and this asserts it stays bare.
    for (const secret of [PAIR_INDEX, SCHEMA, "ensure-contact-group-indexes", "body ->>", "groupid", "invalid"]) {
      assert.ok(
        !refused.text.toLowerCase().includes(secret.toLowerCase()),
        `the 500 body leaked ${JSON.stringify(secret)}: ${refused.text}`,
      )
    }
    const none = await sql(
      `SELECT count(*)::int AS n FROM "${SCHEMA}".contact_group_members WHERE body->>'contactId' = 'cont-forged'`,
    )
    assert.equal(none.rows[0].n, 0)

    // The tool refuses it too, and never drops anything on its own.
    const blocked = tool(["--apply", "--i-understand"])
    assert.equal(blocked.status, 1, blocked.out)
    assert.match(blocked.out, /DIFFERENT definition/)
    assert.match(blocked.out, /never drops an index/)

    // The operator drops it deliberately; the correct one goes back.
    await sql(`DROP INDEX "${SCHEMA}"."${PAIR_INDEX}"`)
    await sql(indexSql(TARGETS[1]))
    const accepted = await call(adminToken, "POST", `/contact-groups/${groupId}/members`, { contactId: "cont-ok" })
    assert.equal(accepted.status, 200, accepted.text)
  })

  it("7. a 23505 from an UNRELATED constraint stays a defect, never a 409", async () => {
    const row = await sql(`SELECT id FROM "${SCHEMA}".contact_groups LIMIT 1`)
    const clash = await sql(
      `INSERT INTO "${SCHEMA}".contact_groups (id, type, created_at, deleted, version, body)
       VALUES ($1, 'ContactGroup', now(), false, 1, $2::jsonb)`,
      [row.rows[0].id, JSON.stringify({ name: "pkey probe", normalizedName: "pkey probe" })],
    ).then(
      () => null,
      (e) => e,
    )
    assert.ok(clash, "the primary key did not refuse a duplicate id")
    assert.equal(clash.code, "23505")
    assert.equal(clash.constraint, "contact_groups_pkey")
    // The cube maps exactly two constraint names and re-dies everything else, so this one could
    // never surface as a 409 (the mapping itself is pinned in cubes/.../index.test.ts).
    assert.ok(![NAME_INDEX, PAIR_INDEX].includes(clash.constraint))
  })

  it("8. the sharing boundary, as evidence: 403s, no grants created, no contact leaked", async () => {
    const full = await makeUser("cg-full", [
      "crm/contact-groups:read",
      "crm/contact-groups:write",
      "crm/contacts:read",
    ])
    const noContacts = await makeUser("cg-nocontacts", ["crm/contact-groups:read", "crm/contact-groups:write"])

    // The kernel makes a table on first use, so the grants table may not exist at all -- which is
    // itself the strongest form of "no grant was created". Counted defensively either way.
    const grants = async (where = "", values = []) => {
      const present = await sql(`SELECT to_regclass('permissions.permission_grants') AS t`)
      if (present.rows[0].t === null) return 0
      return (await sql(`SELECT count(*)::int AS n FROM permissions.permission_grants ${where}`, values)).rows[0].n
    }
    const grantsBefore = await grants()

    // (a) a group this caller may not read: 403, not a 404 and not the row.
    const hidden = await call(full, "GET", `/contact-groups/${groupId}`)
    assert.equal(hidden.status, 403, hidden.text)
    assert.ok(!hidden.text.includes("KEY Accounts"), hidden.text)
    const hiddenMembers = await call(full, "GET", `/contact-groups/${groupId}/members`)
    assert.equal(hiddenMembers.status, 403, hiddenMembers.text)
    assert.ok(!hiddenMembers.text.includes(contactOfAdmin), "an unreadable group must not leak its membership")

    // (b) the caller's OWN group: readable, because the kernel's ownership claim made them owner.
    const own = await call(full, "POST", "/contact-groups", { name: "Full's own group" })
    assert.equal(own.status, 200, own.text)
    const added = await call(full, "POST", `/contact-groups/${own.body.id}/members`, { contactId: contactOfAdmin })
    assert.equal(added.status, 200, added.text)

    // (c) missing crm/contacts:read -> 403 on exactly the two routes that expose or attach a
    //     contact identity, and 200 on the group itself.
    const theirs = await call(noContacts, "POST", "/contact-groups", { name: "No-contacts group" })
    assert.equal(theirs.status, 200, theirs.text)
    assert.equal((await call(noContacts, "GET", `/contact-groups/${theirs.body.id}`)).status, 200)
    const membersDenied = await call(noContacts, "GET", `/contact-groups/${theirs.body.id}/members`)
    assert.equal(membersDenied.status, 403, membersDenied.text)
    const addDenied = await call(noContacts, "POST", `/contact-groups/${theirs.body.id}/members`, {
      contactId: contactOfAdmin,
    })
    assert.equal(addDenied.status, 403, addDenied.text)

    // (d) reading a group one MAY read returns ids -- and changes nothing about contacts. The
    //     contact belongs to admin; this caller could not read it before and still cannot.
    const list = await call(full, "GET", `/contact-groups/${own.body.id}/members`)
    assert.equal(list.status, 200, list.text)
    assert.equal(list.body.rows[0].contactId, contactOfAdmin)
    assert.ok(!list.text.includes("Ada Lovelace"), "membership rows must carry no contact detail")

    const direct = await call(full, "GET", `/contacts/${contactOfAdmin}`)
    assert.ok(direct.status === 403 || direct.status === 404, `expected the contact to stay protected, got ${direct.status}`)
    assert.ok(!direct.text.includes("Ada Lovelace"), "BLOCKER: the contact's name leaked")

    const resolved = await call(full, "GET", `/contacts?ids=${contactOfAdmin}`)
    assert.equal(resolved.status, 200, resolved.text)
    assert.equal(resolved.body.rows.length, 0, "BLOCKER: an unreadable contact resolved through the contacts API")
    assert.ok(!resolved.text.includes("Ada Lovelace"), "BLOCKER: the contact's name leaked")

    // (e) and reading the group created NO grant of any kind: membership is not a share.
    assert.equal(await grants(), grantsBefore, "reading a group must never create a grant")
    assert.equal(
      await grants(`WHERE body->>'entityId' = $1`, [contactOfAdmin]),
      0,
      "no grant may reference the contact",
    )
  })
})
