"use client"

// Closes an inline popup the moment the operator leaves the control that owns
// it, by either route:
//
//   POINTER: a pointerdown anywhere outside the root(s). Captured on the
//   document so it fires before the target's own handlers, and before a click
//   that moves focus somewhere else.
//
//   FOCUS: focus leaving the root(s) -- Tab, Shift+Tab, or any programmatic
//   move to another control. Without this, a keyboard operator who tabs off
//   the field leaves the popup on screen over the next fields, still showing
//   the previous answer: an overlay nothing on the page can account for any
//   more, and one no key can close, because Escape is handled by the control
//   the caret has already left.
//
// TWO roots, not one: the field and its popup are one control to the
// operator, but the popup is portalled out of any clipping ancestor (T-1450),
// so it is no longer a DOM descendant of the field's wrapper. A pointerdown or
// a focus move INTO the portalled popup -- picking a suggestion, tabbing to a
// Retry button -- must count as staying inside this control, not leaving it;
// `extra` is that second, disjoint subtree. `null` when the popup has nothing
// portalled (nothing to add).
//
// The listener lives in a hook, not in the component: it is a subscription to a
// global event stream, which is exactly what a presentation component must not
// own.

import { useEffect, type RefObject } from "react"

export function useDismissOutside(
  root: RefObject<HTMLElement | null>,
  extra: RefObject<HTMLElement | null> | null,
  active: boolean,
  dismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return undefined
    const nodes = [root.current, extra?.current ?? null].filter((n): n is HTMLElement => n !== null)
    if (nodes.length === 0) return undefined
    const inside = (target: EventTarget | null) =>
      target instanceof Node && nodes.some((n) => n.contains(target))

    const onPointerDown = (e: PointerEvent) => {
      if (inside(e.target)) return
      dismiss()
    }

    const onFocusOut = (e: FocusEvent) => {
      // relatedTarget null = the caret did not land on anything this page can
      // name: the window lost focus, or the browser's own chrome took it. The
      // operator has not moved WITHIN the page, so the popup stays and is found
      // as it was left. Tab and Shift+Tab always name the element they reach,
      // so the case this hook exists for is never the null one.
      const next = e.relatedTarget
      if (next === null) return
      if (inside(next)) return
      dismiss()
    }

    document.addEventListener("pointerdown", onPointerDown, true)
    // focusout, not blur: blur does not bubble, so a caret moving out of a
    // descendant (the input, a Retry button) would never be seen here. Each
    // root gets its own listener -- focusout does not cross the gap between
    // two disjoint subtrees either.
    for (const n of nodes) n.addEventListener("focusout", onFocusOut)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      for (const n of nodes) n.removeEventListener("focusout", onFocusOut)
    }
  }, [active, root, extra, dismiss])
}
