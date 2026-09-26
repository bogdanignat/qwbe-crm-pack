// Runtime proof for the sharing adapter (frontend/src/lib/sharing.ts) against a
// real qwbe kernel on a scratch data dir and scratch database -- live data is
// never touched, ports are free ones (never 4500/4510).
//
// The adapter's own functions run here with an injected fetch that rewrites
// the same-origin proxy prefix (/api/qwbe) to the scratch server and adds the
// bearer token, so every path and payload the panel would send is the one
// proven below. The scenario is the contract inventory's 5.2 list:
// grantee 403 on the record and on the grant list, TOTAL user grant = six
// actions, route gate untouched (PATCH still 403 for a reader), name lookup,
// group grant, revoke order, duplicates tolerated.
//
//   cd frontend && npm run check:sharing          # QWBE_REPO defaults to ../../../qwbe
//   QWBE_REPO=<qwbe> node e2e/sharing-adapter-check.mjs
//
// It was probes/crm-sharing.mjs until 2026-09-26 (T-1452). It proves the FRONTEND adapter, not
// the pack's runtime surface, and it boots its own kernel from a checkout -- so it lives with the
// frontend and is not one of the probes `qwbe check` runs (every probes/*.mjs is run there
// against the checker's kernel, via QWBE_URL). Like any checkout-mode run it judges the
// INSTALLED copy at <qwbe>/core/plugins/crm-pack, not this working tree. Never run it with
// QWBE_DATABASE_URL exported: lib.mjs would reuse that database instead of a scratch one. It is
// ignored explicitly (deleted before booting); the scratch database comes from QWBE_PG_* only.

import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const qwbeRepo = resolve(process.env.QWBE_REPO ?? join(here, "..", "..", "..", "..", "qwbe"))
const { client, dropScratch, freePort, makeScore, scratchDataDir, startServer, stopServer } = await import(
  join(qwbeRepo, "probes/lib.mjs")
)
const sharing = await import(join(here, "../src/lib/sharing.ts"))

const score = makeScore()
const port = await freePort()
const data = scratchDataDir("crm-sharing")
const api = client(port)
const LEGACY = {
  QWBE_LEGACY_MIGRATIONS:
    "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack,bookmarks:example-plugin,tags:example-plugin",
}
// Ignored on purpose: startServer would otherwise reuse that database (ownsDb=false).
delete process.env.QWBE_DATABASE_URL
const server = await startServer(port, { QWBE_DATA_DIR: data, ...LEGACY })
if (!server.alive) {
  dropScratch(data)
  console.error(`server did not start:\n${server.output}`)
  process.exit(1)
}

// The panel's fetch, as one session: /api/qwbe/<path> -> http://127.0.0.1:port/<path>.
const asSession = (token) => (input, init = {}) =>
  fetch(String(input).replace(/^\/api\/qwbe/, `http://127.0.0.1:${port}`), {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  })

const CUBE = "crm/organizations"
const TYPE = "Organization"

// A refusal inside the try throws Refused, so finally still stops the kernel and drops the
// scratch database; it is reported (exit 1) after finally.
class Refused extends Error {}
let refused = null

try {
  const admin = await api.login()
  const cubes = await api.call("/settings/cubes", { headers: admin.headers })
  if (!(Array.isArray(cubes.body) ? cubes.body : []).some((c) => c.name === CUBE)) {
    throw new Refused(`refused: cube "${CUBE}" is not mounted (GET /settings/cubes http=${cubes.status}) -- install crm-pack first.`)
  }
  const mihaiCreated = await api.call("/account", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ username: "mihai", password: "mihai-pw", displayName: "Mihai", roles: ["reader"] }),
  })
  score.check("account mihai created as reader", mihaiCreated.status === 200, `http=${mihaiCreated.status}`)
  const mihaiId = mihaiCreated.body?.id
  const mihai = await api.login("mihai", "mihai-pw")

  const org = await api.call("/organizations", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ name: "Sharing Probe Org" }),
  })
  score.check("organization created by admin (owner = admin)", org.status === 200, `http=${org.status}`)
  const id = org.body.id
  const asAdmin = asSession(admin.token)
  const asMihai = asSession(mihai.token)
  const ref = { cube: CUBE, entityType: TYPE, entityId: id }

  // 2-3. grantee side before any share: record 403, grant list 403 (the panel's gate).
  const hidden = await api.call(`/organizations/${id}`, { headers: mihai.headers })
  score.check("mihai cannot read the record before sharing (403)", hidden.status === 403, `http=${hidden.status}`)
  const deniedList = await sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch: asMihai })
  score.check(
    "mihai gets 403 on the grant list with qwbe's message",
    !deniedList.ok && deniedList.status === 403 && /owner/.test(deniedList.message),
    JSON.stringify(deniedList),
  )

  // 4. admin shares TOTAL through the adapter: explicit six actions travel.
  const total = await sharing.createUserGrant({ ...ref, username: "mihai", actions: sharing.TOTAL_ACTIONS, doFetch: asAdmin })
  score.check(
    "createUserGrant TOTAL stores exactly the six actions",
    total.ok && sharing.isTotalActions(total.value.actions) && total.value.subject.userId === mihaiId,
    JSON.stringify(total),
  )

  // 5. grantee reads; the route gate still refuses PATCH (QWB-63 separation).
  const visible = await api.call(`/organizations/${id}`, { headers: mihai.headers })
  score.check("mihai reads the record after the share (200)", visible.status === 200, `http=${visible.status}`)
  const patch = await api.call(`/organizations/${id}`, {
    method: "PATCH",
    headers: mihai.headers,
    body: JSON.stringify({ name: "Renamed By Grantee" }),
  })
  score.check("PATCH by the TOTAL grantee is refused at the route gate (403)", patch.status === 403, `http=${patch.status}`)
  const reshare = await sharing.createUserGrant({ ...ref, username: "admin", actions: ["read"], doFetch: asMihai })
  score.check("a TOTAL grantee cannot re-share (403)", !reshare.ok && reshare.status === 403, JSON.stringify(reshare))
  const granteeList = await sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch: asMihai })
  score.check("a TOTAL grantee still cannot list grants (403)", !granteeList.ok && granteeList.status === 403, JSON.stringify(granteeList))

  // 6. manager side: page with total, names resolved, chips labelled.
  const page = await sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch: asAdmin })
  score.check("admin lists one grant with total=1", page.ok && page.value.total === 1 && page.value.rows.length === 1, JSON.stringify(page))
  const view = sharing.grantsPageView(page.value)
  score.check("grantsPageView: hasMore=false on the single page", view.hasMore === false, JSON.stringify(view))
  const names = await sharing.lookupUserNames([mihaiId], asAdmin)
  const groupsBefore = await sharing.lookupGroups(CUBE, asAdmin)
  const chips = sharing.chipsOf(page.value.rows, names, groupsBefore ?? {})
  score.check(
    "chip: @mihai TOTAL from the resolved name",
    chips.length === 1 && chips[0].label === "mihai" && chips[0].total && chips[0].actions === "TOTAL",
    JSON.stringify(chips),
  )
  const search = await sharing.searchAccounts({ q: "mih", limit: 20, doFetch: asAdmin })
  score.check(
    "searchAccounts finds mihai by prefix and carries no email",
    search.ok && search.value.rows.some((u) => u.username === "mihai") && search.value.rows.every((u) => !("email" in u)),
    JSON.stringify(search),
  )

  // 7. group grant: create group, add mihai, grant read through the adapter.
  const group = await api.call("/permissions/groups", {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ cube: CUBE, name: "Sales" }),
  })
  score.check("group Sales created", group.status === 200, `http=${group.status}`)
  const member = await api.call(`/permissions/groups/${group.body.id}/members`, {
    method: "POST",
    headers: admin.headers,
    body: JSON.stringify({ username: "mihai" }),
  })
  score.check("mihai added to Sales", member.status === 200, `http=${member.status}`)
  const groups = await sharing.lookupGroups(CUBE, asAdmin)
  score.check("lookupGroups names Sales by id", groups !== null && groups[group.body.id] === "Sales", JSON.stringify(groups))
  const groupGrant = await sharing.createGroupGrant({ ...ref, groupId: group.body.id, actions: ["read"], doFetch: asAdmin })
  score.check("createGroupGrant read stores [read]", groupGrant.ok && groupGrant.value.actions.join() === "read", JSON.stringify(groupGrant))
  const emptyActions = await sharing.createGroupGrant({ ...ref, groupId: group.body.id, actions: [], doFetch: asAdmin })
  score.check("createGroupGrant refuses an empty set before any request", !emptyActions.ok && emptyActions.status === 400, JSON.stringify(emptyActions))
  const unknown = await sharing.createUserGrant({ ...ref, username: "nobody-here", actions: ["read"], doFetch: asAdmin })
  score.check("unknown username answers 404 with qwbe's message", !unknown.ok && unknown.status === 404 && /nobody-here/.test(unknown.message), JSON.stringify(unknown))

  // 8. revoke order: user grant gone, group keeps access; group grant gone, 403 again.
  const revokedUser = await sharing.revokeGrant(total.value.id, asAdmin)
  score.check("revokeGrant on the user grant", revokedUser.ok && revokedUser.value.revoked === total.value.id, JSON.stringify(revokedUser))
  const viaGroup = await api.call(`/organizations/${id}`, { headers: mihai.headers })
  score.check("mihai still reads through the group grant (200)", viaGroup.status === 200, `http=${viaGroup.status}`)
  const twice = await sharing.revokeGrant(total.value.id, asAdmin)
  score.check("revoking the same grant again answers 404", !twice.ok && twice.status === 404, JSON.stringify(twice))
  const revokedGroup = await sharing.revokeGrant(groupGrant.value.id, asAdmin)
  score.check("revokeGrant on the group grant", revokedGroup.ok, JSON.stringify(revokedGroup))
  const gone = await api.call(`/organizations/${id}`, { headers: mihai.headers })
  score.check("mihai loses access after both revokes (403)", gone.status === 403, `http=${gone.status}`)
  const empty = await sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch: asAdmin })
  score.check("grant list is empty with total=0 after the revokes", empty.ok && empty.value.total === 0, JSON.stringify(empty))

  // 10. duplicates are NOT rejected by the backend (G4): the UI guards client-side.
  const d1 = await sharing.createUserGrant({ ...ref, username: "mihai", actions: ["read"], doFetch: asAdmin })
  const d2 = await sharing.createUserGrant({ ...ref, username: "mihai", actions: ["read"], doFetch: asAdmin })
  const dup = await sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch: asAdmin })
  score.check("two identical shares yield two rows (backend does not deduplicate)", d1.ok && d2.ok && dup.ok && dup.value.total === 2, JSON.stringify(dup.value?.total))
  const dupChips = sharing.chipsOf(dup.value.rows, names, {})
  score.check("duplicate rows are two separately revokable chips", dupChips.length === 2 && dupChips[0].grantId !== dupChips[1].grantId, JSON.stringify(dupChips))
  const revoked = await sharing.revokeGrant(d1.value.id, asAdmin)
  score.check("revoking one duplicate keeps the other", revoked.ok && (await sharing.fetchGrantPage({ ...ref, offset: 0, limit: 50, doFetch: asAdmin })).value.total === 1, "")
} catch (err) {
  if (!(err instanceof Refused)) throw err
  refused = err
} finally {
  await stopServer(server)
  dropScratch(data)
}

if (refused) {
  console.error(refused.message)
  process.exit(1)
}
process.exit(score.report("crm-pack sharing adapter probe"))
