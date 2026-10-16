// A list's query kept in the URL (?q=exe&f.industry=…&sort=-name&page=2&size=50),
// so Back from a record and a reload land where the reader was. Defaults stay
// out of the URL. Every value is checked on read and a bad one falls back to
// its default; whether a field may be filtered or sorted on is checked again
// against the live metadata (hooks/use-list-query.ts).

import { PAGE_SIZES } from "./views.ts"

export type ListState = {
  q: string
  filters: Readonly<Record<string, string>>
  sortBy: string | undefined
  descending: boolean
  offset: number
  pageSize: number
}

export const DEFAULT_LIST_STATE: ListState = {
  q: "",
  filters: {},
  sortBy: undefined,
  descending: false,
  offset: 0,
  pageSize: PAGE_SIZES[0],
}

const FILTER_PREFIX = "f."
const LIST_KEYS = ["q", "sort", "page", "size"]
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const MAX_VALUE = 200
const MAX_PAGE = 100_000

const textOf = (value: string | null) => (value && value.trim() !== "" ? value.slice(0, MAX_VALUE) : "")

function wholeNumberOf(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d{1,9}$/.test(value)) return null
  const n = Number(value)
  return n >= min && n <= max ? n : null
}

export function listStateOf(params: URLSearchParams): ListState {
  const size = wholeNumberOf(params.get("size"), 1, 1000)
  const pageSize = PAGE_SIZES.find((s) => s === size) ?? DEFAULT_LIST_STATE.pageSize
  const page = wholeNumberOf(params.get("page"), 1, MAX_PAGE) ?? 1
  const sort = /^(-?)([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(params.get("sort") ?? "")
  const filters: Record<string, string> = {}
  for (const [key, value] of params) {
    const name = key.startsWith(FILTER_PREFIX) ? key.slice(FILTER_PREFIX.length) : ""
    if (FIELD_NAME.test(name) && textOf(value) !== "") filters[name] = textOf(value)
  }
  return {
    q: textOf(params.get("q")),
    filters,
    sortBy: sort?.[2],
    descending: sort?.[1] === "-",
    offset: (page - 1) * pageSize,
    pageSize,
  }
}

// Writes `state` over the list's own keys of `params`; other keys (a tab) stay.
export function writeListState(params: URLSearchParams, state: ListState): void {
  for (const key of [...params.keys()]) {
    if (LIST_KEYS.includes(key) || key.startsWith(FILTER_PREFIX)) params.delete(key)
  }
  if (state.q.trim() !== "") params.set("q", state.q)
  for (const [name, value] of Object.entries(state.filters)) {
    if (value !== "") params.set(`${FILTER_PREFIX}${name}`, value)
  }
  if (state.sortBy) params.set("sort", `${state.descending ? "-" : ""}${state.sortBy}`)
  const page = Math.floor(state.offset / state.pageSize) + 1
  if (page > 1) params.set("page", String(page))
  if (state.pageSize !== DEFAULT_LIST_STATE.pageSize) params.set("size", String(state.pageSize))
}
