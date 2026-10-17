// A titled block of a form, styled like the detail page's blocks but never
// collapsible: a closed block would hide the field a failed save points to.
// `aside` sits on the header's right (the address copy). Its title is an h2:
// the page's own title is the h1.

import { PANEL_FRAME, PanelHeader } from "@/components/kit/panel-header"

export function FormBlock({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={PANEL_FRAME}>
      <PanelHeader aside={aside} className="rounded-t-lg">
        <h2 className="label-mono min-w-0 flex-1 text-foreground">{title}</h2>
      </PanelHeader>
      {children}
    </section>
  )
}
