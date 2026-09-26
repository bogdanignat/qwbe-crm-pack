// The TanStack Query client this frontend's non-kit routes share.
//
// The lifetime rule is the one the INSTALLED Next docs prescribe for the App
// Router (node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/
// tanstack-query.md, Next 16.3.3): a FRESH client per server render, so two
// requests never share one cache, and ONE client reused in the browser, so a
// panel that remounts does not throw away what it already fetched. A client
// created inside a component (useState/useMemo) would be per mount and would
// re-read the server on every remount -- which is the cost the effect-free read
// exists to avoid.
//
// This is a separate client from the one ra-core's CoreAdminContext owns for the
// kit pages (components/kit/kit-context.tsx): that one belongs to a different
// provider tree and must not be merged with this by accident.

import { QueryClient } from "@tanstack/react-query"

let browserQueryClient: QueryClient | undefined

// Same defaults as the kit context: a failed request is reported to the
// operator with a Retry, never re-attempted behind their back.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}
