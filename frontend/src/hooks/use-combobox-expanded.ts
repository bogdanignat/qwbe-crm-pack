"use client"

// Makes cmdk's combobox input tell the truth about its popup.
//
// cmdk builds CommandInput for a command PALETTE, where the list is always on
// screen, so it writes the ARIA of an always-expanded combobox and writes it
// LAST (node_modules/cmdk/dist/index.mjs, cmdk 1.1.1):
//
//   createElement(Primitive.input, { ...props, role: "combobox",
//     "aria-expanded": true, "aria-controls": listId, ... })
//
// `...props` is spread BEFORE those keys, so passing `aria-expanded={open}`
// from a caller is silently dropped -- the prop looks right in the JSX and the
// rendered DOM still says `aria-expanded="true"`. An inline picker whose list
// is closed most of the time therefore announces a popup that is not there,
// and an assistive technology has no way to learn it ever closed.
//
// The only layer cmdk does not own is the DOM node itself, so the attribute is
// corrected there. Deliberately WITHOUT a dependency array: it re-asserts
// after every render, including the renders cmdk triggers from its own store,
// so the value cannot drift back. React only writes an attribute when the prop
// it renders changes, and cmdk's never does, so it never fights this back.
//
// The companion half of the contract is the caller's: `aria-controls` points
// at CommandList's generated id, so that element must stay mounted in every
// state -- an `aria-controls` pointing at nothing is the same lie told about
// the other attribute.

import { useEffect, useLayoutEffect, type RefObject } from "react"

// It runs as a LAYOUT effect: the correction writes to a real DOM node that
// React has already committed with cmdk's wrong value, so it has to land in the
// same commit, before the browser paints and before an assistive technology can
// read the node. A passive effect leaves a frame in which the DOM says the
// popup is open while the list is closed -- short, but observable exactly when
// the list opens or closes, which is the only moment this attribute matters.
// On the server there is no node and no paint, so the passive effect is used
// there and React does not warn about a layout effect that cannot run.
const useDomEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

export function useComboboxExpanded(
  input: RefObject<HTMLInputElement | null>,
  expanded: boolean,
): void {
  useDomEffect(() => {
    input.current?.setAttribute("aria-expanded", expanded ? "true" : "false")
  })
}
