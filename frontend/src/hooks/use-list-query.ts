"use client"

// One cube list's server state: its metadata (mock fields merged under it,
// the organization labels on top), the published controls, and the page the
// current query returns. Paging, sorting, search and filters are server-side
// end to end: every change is a new list request, nothing slices rows here.
// The query itself lives in the URL (hooks/use-list-state.ts); what it names
// is checked against the metadata, and no request leaves before that.
// `queryKey` changes with every request parameter, so what belongs to one
// page (the selection, a cell's error) can reset with it.

import { useEffect, useMemo, useState } from "react"

import {
  apiFetch,
  listApiPath,
  listControlsOf,
  metadataApiPath,
  requestFailure,
  sortRequestFor,
  type ColumnSpec,
  type CubeMetadata,
  type FieldMetadata,
  type PageOf,
  type Row,
  withSavedValue,
} from "@/lib/cube"
import { SEARCH_CHIP } from "@/lib/list-filters"
import { DEFAULT_LIST_STATE } from "@/lib/list-url"
import { withOrganizationDisplay } from "@/lib/organization-display"
import type { AppliedView } from "@/lib/views"
import { withMockFields } from "@/mock/organizations"

import { useListState } from "./use-list-state"

export type ListQuery = ReturnType<typeof useListQuery>

const NO_FILTERS: Readonly<Record<string, string>> = {}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function useCubeMeta(cube: string) {
  const [meta, setMeta] = useState<CubeMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    apiFetch(metadataApiPath(cube))
      .then(async (r) => {
        if (!r.ok) throw await requestFailure("metadata", r)
        return withOrganizationDisplay(withMockFields((await r.json()) as CubeMetadata))
      })
      .then((m) => alive && setMeta(m))
      .catch((e: unknown) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [cube])
  return { meta, metaError: error }
}

export function useListQuery(cube: string, fixedFilters: Readonly<Record<string, string>> = NO_FILTERS) {
  const { meta, metaError } = useCubeMeta(cube)
  // A list under pinned filters is embedded in another page: not in its URL.
  const [state, update] = useListState(Object.keys(fixedFilters).length === 0)
  const { offset, pageSize, q: prefix, filters: search } = state
  const [page, setPage] = useState<PageOf<Row> | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // The controls derive from the PUBLISHED list contract, so the UI only
  // offers what the backend honours; a field the caller pins gets none. A
  // filter or a sort the URL names but the contract does not is dropped.
  const controls = useMemo(() => (meta ? listControlsOf(meta.fields, meta.list, fixedFilters) : null), [meta, fixedFilters])
  const sortable = Boolean(state.sortBy && meta?.fields.some((f) => f.name === state.sortBy && f.sortable))
  const sortBy = sortable ? state.sortBy : undefined
  const descending = sortable && state.descending
  const filters = useMemo(() => {
    const chosen = Object.fromEntries((controls?.filters ?? []).flatMap((f) => (search[f.name] ? [[f.name, search[f.name]]] : [])))
    return { ...fixedFilters, ...chosen } as Record<string, string>
  }, [fixedFilters, search, controls])

  // The filters the reader chose (not the caller's pinned ones): the chips.
  const userFilters = useMemo(
    () => Object.fromEntries(Object.entries(filters).filter(([k, v]) => v !== "" && !(k in fixedFilters))),
    [filters, fixedFilters],
  )

  const requestPath = controls ? listApiPath(cube, { offset, limit: pageSize, sortBy, descending, q: prefix, filters }) : null
  const queryKey = requestPath ?? ""
  useEffect(() => {
    if (!requestPath) return
    let alive = true
    apiFetch(requestPath)
      .then(async (r) => {
        if (!r.ok) throw await requestFailure("list", r)
        return (await r.json()) as PageOf<Row>
      })
      // Only the CURRENT request paints, and its success retires an old alert.
      .then((p) => {
        if (!alive) return
        // A page past the end (a stale link, rows deleted since): the last one.
        const total = p.total ?? 0
        if (p.rows.length === 0 && total > 0 && offset >= total) {
          return update(() => ({ offset: Math.floor((total - 1) / pageSize) * pageSize }))
        }
        setPage(p)
        setListError(null)
      })
      .catch((e: unknown) => alive && setListError(errorText(e)))
    return () => {
      alive = false
    }
  }, [requestPath, offset, pageSize, update])

  // Every control goes back to the first page.
  const setQuery = (q: string) => update(() => ({ q, offset: 0 }))
  const setFilter = (name: string, value: string) => update((s) => ({ filters: { ...s.filters, [name]: value }, offset: 0 }))
  const clearChip = (key: string) => (key === SEARCH_CHIP ? setQuery("") : setFilter(key, ""))
  const clearAll = () => update(() => ({ q: "", filters: {}, offset: 0 }))
  const setOffset = (next: number) => update(() => ({ offset: next }))

  const toggleSort = (column: ColumnSpec) => {
    // A column the metadata does not mark sortable never produces a request.
    const next = sortRequestFor(column, sortBy, descending)
    if (next) update(() => ({ ...next, offset: 0 }))
  }

  // The first row of the old page stays in view: the offset snaps to the new size.
  const setPageSize = (size: number) => update((s) => ({ pageSize: size, offset: Math.floor(s.offset / size) * size }))

  // A saved view (or null, the defaults) replaces the whole query.
  const applyView = (applied: AppliedView | null) => {
    const params = applied?.params ?? {}
    update(() => ({
      ...DEFAULT_LIST_STATE,
      filters: Object.fromEntries(Object.entries(params.filters ?? {}).filter(([k]) => !(k in fixedFilters))),
      q: params.q ?? "",
      sortBy: params.sortBy,
      descending: params.descending ?? false,
      pageSize: applied?.pageSize ?? DEFAULT_LIST_STATE.pageSize,
    }))
  }

  // A saved cell merges only its own key: a late response must not
  // overwrite the other columns.
  const patchRow = (id: string, field: FieldMetadata, value: unknown) =>
    setPage((p) => p && { ...p, rows: p.rows.map((r) => (String(r.id) === id ? withSavedValue(r, field, value) : r)) })

  return {
    fixedFilters,
    meta,
    metaError,
    controls,
    page,
    listError,
    queryKey,
    offset,
    setOffset,
    pageSize,
    setPageSize,
    sortBy,
    descending,
    toggleSort,
    search,
    userFilters,
    prefix,
    setQuery,
    setFilter,
    clearChip,
    clearAll,
    filtered: prefix.trim() !== "" || Object.keys(userFilters).length > 0,
    applyView,
    patchRow,
  }
}
