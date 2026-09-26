"use client"

// The TanStack Query provider for the panels that read server state with
// `useQuery` instead of an effect. Composition only: the client and its
// lifetime rule live in lib/query-client.ts.
//
// Deliberately NOT mounted at the root layout: only the panels that need it are
// wrapped, so nothing else in this app changes shape or acquires a cache it did
// not ask for.

import type { ReactNode } from "react"
import { QueryClientProvider } from "@tanstack/react-query"

import { getQueryClient } from "@/lib/query-client"

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
}
