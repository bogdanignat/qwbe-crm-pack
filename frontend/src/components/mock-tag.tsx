// The visible marker of mockup data (src/mock): "mock" next to a field the
// backend does not publish yet, "demo" on a record that is not in the backend.
export function MockTag({ children = "mock" }: { children?: string }) {
  return (
    <span className="ml-1.5 rounded border border-dashed px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}
