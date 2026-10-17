"use client"

// The batch hook behind every relation cell on a page.
//
// Given the page's relation refs, it resolves them with ONE request per
// distinct target cube (`?ids=a,b,c` -- qwbe sizes the batch by the ids),
// not one request per cell. Results are cached for the session, so moving
// back to a page already seen costs nothing, and a page whose ids are partly
// known fetches only the missing ones.
//
// Failures are remembered per id: a failed batch (or a row the response did
// not return, deleted between the list and the batch) resolves to null and
// the cell falls back to the raw id -- the same fallback the old per-cell
// fetch had -- without a retry loop.

import { useCallback, useEffect, useReducer, useRef } from "react"

import { apiFetch, relationMeta } from "@/lib/cube"
import { batchListApiPath, titlesOfPage, type RelationRef } from "@/lib/relation-batch"
import type { PageOf, Row } from "@/lib/cube"

export function useRelationTitles(
  refs: ReadonlyArray<RelationRef>,
): (target: string, id: string) => string | null {
  // target -> id -> title. The map is the source of truth and lives in a ref:
  // merging a response must not race the effect that reads it, and the
  // resolve callback must always see the freshest cache.
  const cache = useRef<Map<string, Map<string, string>>>(new Map())
  const failed = useRef<Set<string>>(new Set())
  // `target|id` keys currently being fetched. Shared across effect runs so a
  // re-render between two page loads does not double-fetch an id.
  const inFlight = useRef<Set<string>>(new Set())
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    let alive = true
    // Released on cleanup: StrictMode's double effect would otherwise leave
    // the first run's keys claimed forever while its response was discarded.
    const claimed: string[] = []

    const groups = new Map<string, string[]>()
    for (const { target, id } of refs) {
      const key = `${target}|${id}`
      if (inFlight.current.has(key)) continue
      if (cache.current.get(target)?.has(id)) continue
      if (failed.current.has(key)) continue
      inFlight.current.add(key)
      claimed.push(key)
      const ids = groups.get(target)
      if (ids) ids.push(id)
      else groups.set(target, [id])
    }

    for (const [target, ids] of groups) {
      void (async () => {
        try {
          const meta = await relationMeta(target, apiFetch)
          if (!meta) throw new Error(`metadata unavailable for ${target}`)
          const r = await apiFetch(batchListApiPath(target, ids))
          if (!r.ok) throw new Error(`batch request failed: ${r.status}`)
          const page = (await r.json()) as PageOf<Row>
          if (!alive) return
          const titles = titlesOfPage(meta, page.rows)
          let bucket = cache.current.get(target)
          if (!bucket) cache.current.set(target, (bucket = new Map()))
          for (const id of ids) {
            const title = titles[id]
            if (title !== undefined) bucket.set(id, title)
            else failed.current.add(`${target}|${id}`)
          }
          bump()
        } catch {
          // The whole batch resolves to the raw ids, once, no retry loop.
          if (!alive) return
          for (const id of ids) failed.current.add(`${target}|${id}`)
          bump()
        }
      })()
    }

    return () => {
      alive = false
      for (const key of claimed) inFlight.current.delete(key)
    }
  }, [refs])

  const resolve = useCallback(
    (target: string, id: string) => cache.current.get(target)?.get(id) ?? null,
    [],
  )
  return resolve
}
