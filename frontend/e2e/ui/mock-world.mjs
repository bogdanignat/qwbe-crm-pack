// The disposable world the UI fixture runs against: a few groups, a few
// accounts and a few memberships held in memory, answered in the browser.
//
// It is a MOCK of the qwbe permissions API's shapes and statuses, not a
// reimplementation of its rules -- the only server behaviour reproduced here is
// what the panel actually reads: the page shape
// (rows/total/offset/limit), the idempotent add, the 404 wording the kernel
// really sends (`username X does not exist`, core/src/cubes/permissions/
// handler-utils.ts resolveIdentity; `group X does not exist`, groups.ts), and
// the 403 of requireCubeAccess. Each test bends one of those and asserts what
// the operator sees.
//
// Nothing here is persisted and nothing here is shared with a running CRM: the
// world is rebuilt per test.

export const CATALOGUE = [
  { name: "crm", enabled: true, entity: null },
  { name: "crm/organizations", enabled: true, entity: "Organization" },
  { name: "crm/contacts", enabled: true, entity: "Contact" },
  { name: "crm/contracts", enabled: true, entity: "Contract" },
  { name: "crm/contact-groups", enabled: true, entity: "ContactGroup" },
  { name: "echo", enabled: true, entity: null },
]

const ACCOUNTS = [
  { id: "u-admin", username: "admin", displayName: "Admin" },
  { id: "u-reader", username: "reader", displayName: "Reader" },
  { id: "u-writer", username: "writer", displayName: "Writer" },
]

/**
 * A fresh world. `plan` may override any of the four answers the tests bend:
 * the catalogue status, the group list status per cube, and a scripted refusal
 * or delay for one write.
 */
export function makeWorld(plan = {}) {
  const world = {
    catalogueStatus: plan.catalogueStatus ?? 200,
    groupsStatus: plan.groupsStatus ?? {},
    accounts: [...ACCOUNTS],
    groups: [
      { id: "g-org-1", cube: "crm/organizations", name: "Org admins", createdBy: "u-admin", createdAt: "2026-01-01" },
      { id: "g-org-2", cube: "crm/organizations", name: "Org readers", createdBy: "u-admin", createdAt: "2026-01-02" },
      { id: "g-con-1", cube: "crm/contacts", name: "Contact editors", createdBy: "u-admin", createdAt: "2026-01-03" },
    ],
    memberships: [{ id: "m-1", groupId: "g-org-1", userId: "u-reader", createdBy: "u-admin", createdAt: "2026-01-04" }],
    // Scripted answers, consumed in order: `{ match: "POST /permissions/groups/g-org-1/members",
    // status, body, delayMs }`. A request with no script left takes the normal path.
    scripts: [...(plan.scripts ?? [])],
    nextId: 100,
  }
  return world
}

const page = (rows, offset, limit) => ({
  rows: rows.slice(offset, offset + limit),
  total: rows.length,
  offset,
  limit,
  sortedBy: "createdAt",
})

/**
 * The fixture's answer to one intercepted request.
 *
 * @param {ReturnType<typeof makeWorld>} world
 */
export function answerFor(world) {
  return ({ method, path, query, body }) => {
    const key = `${method} ${path}`
    const scripted = world.scripts.findIndex((s) => s.match === key)
    if (scripted !== -1) {
      const [script] = world.scripts.splice(scripted, 1)
      if (script.status !== undefined) {
        return { status: script.status, body: script.body ?? { message: "scripted refusal" }, delayMs: script.delayMs }
      }
      // No status: only a delay was scripted, so the normal answer is used --
      // slowly. That is how "the answer arrives after the panel is gone" is
      // reproduced without a race.
      const normal = answerFor(world)({ method, path, query, body })
      return { ...normal, delayMs: script.delayMs }
    }

    // --- the cube catalogue (the scope selector) ---
    if (method === "GET" && path === "/settings/cubes") {
      if (world.catalogueStatus !== 200) {
        return { status: world.catalogueStatus, body: { message: "settings:read required" } }
      }
      return { status: 200, body: CATALOGUE }
    }

    // --- accounts (the picker and the batch label lookup) ---
    if (method === "GET" && path === "/account") {
      const ids = query.get("ids")
      if (ids !== null) {
        const wanted = new Set(ids.split(","))
        const rows = world.accounts.filter((a) => wanted.has(a.id))
        return { status: 200, body: { rows, total: rows.length, offset: 0, limit: rows.length } }
      }
      const q = (query.get("q") ?? "").trim().toLowerCase()
      const rows = q === "" ? [] : world.accounts.filter((a) => a.username.toLowerCase().startsWith(q))
      return { status: 200, body: { rows, total: rows.length, offset: 0, limit: 20 } }
    }
    if (method === "GET" && path === "/auth/me") {
      return { status: 200, body: { userId: "u-admin", username: "admin", roles: ["admin"], permissions: [] } }
    }

    // --- permission groups ---
    if (method === "GET" && path === "/permissions/groups") {
      const cube = query.get("cube") ?? ""
      const status = world.groupsStatus[cube] ?? 200
      if (status !== 200) {
        return { status, body: { message: "only an entity owner or cube admin may manage groups" } }
      }
      return { status: 200, body: world.groups.filter((g) => g.cube === cube) }
    }
    if (method === "POST" && path === "/permissions/groups") {
      const cube = String(body?.cube ?? "")
      const name = String(body?.name ?? "").trim()
      if (name === "") return { status: 400, body: { message: "group name must not be empty" } }
      const clash = world.groups.some(
        (g) => g.cube === cube && g.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (clash) return { status: 409, body: { message: "duplicate key value violates unique constraint" } }
      const created = { id: `g-${world.nextId++}`, cube, name, createdBy: "u-admin", createdAt: "2026-02-01" }
      world.groups.push(created)
      return { status: 201, body: created }
    }

    const groupPath = path.match(/^\/permissions\/groups\/([^/]+)(\/members(\/remove)?)?$/)
    if (groupPath) {
      const groupId = decodeURIComponent(groupPath[1])
      const group = world.groups.find((g) => g.id === groupId)
      const suffix = groupPath[2] ?? ""
      if (!group) return { status: 404, body: { message: `group ${groupId} does not exist` } }

      if (method === "PATCH" && suffix === "") {
        const name = String(body?.name ?? "").trim()
        if (name === "") return { status: 400, body: { message: "group name must not be empty" } }
        const clash = world.groups.some(
          (g) => g.cube === group.cube && g.id !== group.id && g.name.trim().toLowerCase() === name.toLowerCase(),
        )
        if (clash) return { status: 409, body: { message: "duplicate key value violates unique constraint" } }
        group.name = name
        return { status: 200, body: group }
      }
      if (method === "GET" && suffix === "/members") {
        const offset = Number(query.get("offset") ?? 0)
        const limit = Number(query.get("limit") ?? 50)
        return { status: 200, body: page(world.memberships.filter((m) => m.groupId === groupId), offset, limit) }
      }
      if (method === "POST" && suffix === "/members") {
        const username = String(body?.username ?? "")
        const account = world.accounts.find((a) => a.username === username)
        // The kernel resolves the username FIRST: an unknown one is a 404 about
        // the ACCOUNT, and that is exactly the answer the panel used to mislabel
        // as "This group no longer exists."
        if (!account) return { status: 404, body: { message: `username ${username} does not exist` } }
        const existing = world.memberships.find((m) => m.groupId === groupId && m.userId === account.id)
        if (existing) return { status: 201, body: existing }
        const created = {
          id: `m-${world.nextId++}`,
          groupId,
          userId: account.id,
          createdBy: "u-admin",
          createdAt: "2026-02-02",
        }
        world.memberships.push(created)
        return { status: 201, body: created }
      }
      if (method === "POST" && suffix === "/members/remove") {
        const username = String(body?.username ?? "")
        const account = world.accounts.find((a) => a.username === username)
        if (!account) return { status: 404, body: { message: `username ${username} does not exist` } }
        const at = world.memberships.findIndex((m) => m.groupId === groupId && m.userId === account.id)
        if (at === -1) return { status: 404, body: { message: "membership does not exist" } }
        world.memberships.splice(at, 1)
        // `removed` is the account ID, not the username: that is what the kernel
        // returns (core/src/cubes/permissions/sharing-handlers.ts `identity.id`)
        // and removeGroupMemberById refuses any other value as a mismatch.
        return { status: 200, body: { removed: account.id } }
      }
    }

    // Everything else this page happens to ask for (the custom-fields panel's
    // own reads) is refused the way a kernel refuses a caller without the
    // permission: the panel says so and nothing pretends to be data.
    return { status: 403, body: { message: "ui fixture: not part of this fixture" } }
  }
}
