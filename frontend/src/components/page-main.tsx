// The work area of a signed-in page (T-1817): the full width to the right of
// the menu, with the page's inner padding; no max-width cap.

export function PageMain({ children }: { children: React.ReactNode }) {
  return <main className="flex w-full min-w-0 flex-col gap-4 p-4 lg:px-6">{children}</main>
}
