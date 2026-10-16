// The one way this app rewrites the current URL's query in place (a tab, a
// list's search, the ?edit=all hand-off). It reads window.location at the
// moment of writing, never a render's copy of the query, so two writers in the
// same tick cannot undo each other. Next keeps useSearchParams in sync with
// the history API, without a server round trip, as long as the state passed
// is not its own (null here).

export function replaceUrlQuery(update: (query: URLSearchParams) => void): void {
  const url = new URL(window.location.href)
  update(url.searchParams)
  const search = url.searchParams.toString()
  window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`)
}
