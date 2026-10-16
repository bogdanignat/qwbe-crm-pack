// The signed-in user as qwbe's /auth/me reports it: the one place that asks.
//
// Components that mount together (the shell and a page's panels) share ONE
// request: the in-flight promise is reused until it settles. Nothing is kept
// after that, so a later mount asks again and a failure never sticks for the
// whole session (the rule the custom-fields panel relies on, QWB-60).

import { apiFetch } from "./cube.ts"

export type CurrentUser = {
  id: string
  username: string
  roles: string[]
  permissions: string[]
  // `roles` containing "admin": the permission foundation answers
  // "superadmin" on every cube for this user.
  admin: boolean
}

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

// The user from an /auth/me body, or null when the body names nobody.
export function currentUserOf(body: unknown): CurrentUser | null {
  if (!body || typeof body !== "object") return null
  const me = body as Record<string, unknown>
  if (typeof me.id !== "string" || me.id === "") return null
  const roles = stringsOf(me.roles)
  return {
    id: me.id,
    username: typeof me.username === "string" && me.username !== "" ? me.username : me.id,
    roles,
    permissions: stringsOf(me.permissions),
    admin: roles.includes("admin"),
  }
}

let inFlight: Promise<CurrentUser | null> | null = null

// Never rejects: a refusal, a network error or a body that is not a user is null.
export function fetchCurrentUser(doFetch: typeof fetch = apiFetch): Promise<CurrentUser | null> {
  inFlight ??= doFetch("/api/qwbe/auth/me")
    .then(async (r) => (r.ok ? currentUserOf(await r.json()) : null))
    .catch(() => null)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}
