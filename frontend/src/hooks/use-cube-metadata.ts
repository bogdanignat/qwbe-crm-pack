"use client"

// A cube's published metadata as every surface renders it: the mock fields
// merged under it (src/mock) and the organization display labels on top.
// Through react-query, so the pieces of one page share a single request; it
// needs a QueryClient above it (the KitContext provides one).

import { useQuery } from "@tanstack/react-query"

import { apiFetch, metadataApiPath, requestFailure, type CubeMetadata } from "@/lib/cube"
import { withOrganizationDisplay } from "@/lib/organization-display"
import { withMockFields } from "@/mock/organizations"

export function useCubeMetadata(cube: string): { meta: CubeMetadata | undefined; error: string | null } {
  const { data, error } = useQuery({
    queryKey: ["cube-metadata", cube],
    queryFn: async () => {
      const response = await apiFetch(metadataApiPath(cube))
      if (!response.ok) throw await requestFailure("metadata", response)
      return withOrganizationDisplay(withMockFields((await response.json()) as CubeMetadata))
    },
    staleTime: Infinity,
  })
  return { meta: data, error: error ? error.message : null }
}
