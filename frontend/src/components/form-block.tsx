// A titled block of a form, styled like the detail page's blocks but never
// collapsible: a closed block would hide the field a failed save points to.
// `aside` sits on the header's right (the address copy). Its title is an h2:
// the page's own title is the h1.

export function FormBlock({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border bg-card">
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-t-lg border-b bg-muted/50 px-3 py-1">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
