"use client"

// The scope selector's options: this pack's cubes, read once per session from
// the kernel's live catalogue (lib/access-scopes.ts).
//
// Fetched with the installed query primitive (@tanstack/react-query, already a
// dependency of this frontend), NOT with an effect: the catalogue is server
// state, an effect would refetch it on every remount of the panel, and this
// app's rule is that useEffect synchronizes with external systems and does not
// fetch. The provider setup is the one the installed Next docs prescribe
// (node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/
// tanstack-query.md) -- see components/query-provider.tsx.

import { useQuery } from "@tanstack/react-query"

import { fetchAccessScopes, type AccessScope } from "@/lib/access-scopes"

// One key, exported, so a caller that ever needs to invalidate or prefetch the
// catalogue names the same query as this hook.
export const ACCESS_SCOPES_QUERY_KEY = ["crm", "access-scopes"] as const

export type AccessScopes = {
  scopes: ReadonlyArray<AccessScope>
  // "fallback" = the catalogue refused this account and the built-in list is
  // being offered; the UI MUST say so (`notice`).
  source: "live" | "fallback" | null
  notice: string | null
  pending: boolean
  // A re-read asked for by the operator is in flight. The list on screen stays
  // usable while it runs; this only keeps the button from being pressed twice.
  refreshing: boolean
  // Why no list could be offered at all. A refusal is not an error here (it
  // has a fallback); this is a network/5xx/unparseable answer.
  error: string | null
  // Read the catalogue again. Offered for an error AND for a fallback list: a
  // 403 is normally fixed by granting `settings:read`, and after that the
  // operator must be able to reach the installed list without reloading the
  // whole page.
  retry: () => void
}

export function useAccessScopes(): AccessScopes {
  const query = useQuery({
    queryKey: ACCESS_SCOPES_QUERY_KEY,
    queryFn: () => fetchAccessScopes(),
    // The installed catalogue changes when a cube is switched off, which is an
    // administrative act, not a per-second one. One minute keeps a remount of
    // the panel from re-reading it while still following an install.
    //
    // A FALLBACK answer is never cached as if it were the installed list: it is
    // the shape of a 403, and a 403 is the one answer an administrative act (a
    // granted `settings:read`) is expected to change within the minute. Held
    // fresh, the built-in list would survive that grant until the tab was
    // reloaded, and no Retry appears for it because a fallback is not an error.
    staleTime: (query) => (query.state.data?.source === "fallback" ? 0 : 60_000),
    // A failure is shown with a Retry the operator presses, not hidden behind
    // silent attempts -- the same shape every other panel in this app has.
    retry: false,
  })
  return {
    scopes: query.data?.scopes ?? [],
    source: query.data?.source ?? null,
    notice: query.data?.notice ?? null,
    pending: query.isPending,
    refreshing: query.isFetching,
    error:
      query.error === null
        ? null
        : query.error instanceof Error
          ? query.error.message
          : "the cube catalogue could not be read",
    retry: () => {
      void query.refetch()
    },
  }
}
