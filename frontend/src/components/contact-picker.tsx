"use client"

// The CONTACT combobox: search the contacts cube by text and pick ONE existing
// contact. It is the only way a contact enters a group, because the backend
// cannot verify that a contactId exists (contract, known limit 1) -- so the
// only id this app ever posts is one a contact search just returned. There is
// no field here in which an id can be typed.
//
// NOT the UserPicker. That control addresses APP ACCOUNTS by @username for
// authorization; this one addresses BUSINESS CONTACTS by opaque id, shows
// name and company, and never calls the account directory. They look alike
// because the combobox pattern is the same, and they must never be merged:
// the two identities are different things and one of them grants access.
//
// Presentation only: the search (debounce, race control, the four answers)
// lives in hooks/use-contact-search.ts and lib/contact-directory.ts; the live
// sentence in lib/contact-directory.ts; the one attribute cmdk gets wrong in
// hooks/use-combobox-expanded.ts. Contacts the caller excludes are rendered
// DISABLED with the caller's own reason, never filtered away -- filtering an
// existing member makes the search look like it found nothing.
//
// PORTALLED (the T-1450 lesson, which must not recur here): this control
// mounts inside a Card, and a Card exists to clip ITS OWN content. An
// `absolute` popup stayed a DOM descendant of that Card and was clipped by it
// -- on screen as "the list is empty" and as "clicking a suggestion does
// nothing", because a point outside the clip region hits whatever is under it.
// Popper positions this against the field from OUTSIDE that ancestor and
// tracks it across scroll and resize. Radix's own open state, auto-focus and
// outside-dismiss are switched off: this control already owns all three
// (`open` from the hook, `refocus`, useDismissOutside), and two systems racing
// over one popup is how a click starts closing a list that has not finished
// opening.

import { useId, useRef, type RefObject } from "react"

import { ChevronsUpDownIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"
import {
  Badge,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "shadcn-admin-kit"

import { useComboboxExpanded } from "@/hooks/use-combobox-expanded"
import { useDismissOutside } from "@/hooks/use-dismiss-outside"
import { useContactSearch } from "@/hooks/use-contact-search"
import {
  contactSearchStatus,
  CONTACT_SEARCH_BOUNDED_NOTE,
  CONTACT_SEARCH_REFUSED_NOTE,
  type ContactSuggestion,
  type ExcludedContact,
} from "@/lib/contact-directory"
import { Button } from "@/components/ui/button"

const HELP = "Type a name to search the contacts you may see, then pick one from the list."

// The visible label AND the accessible name are the SAME word: a visible label
// an assistive technology does not say back is a name a speech-input operator
// can see but cannot pronounce (WCAG 2.5.3 Label in Name).
const ACCESSIBLE_NAME = "Contact"
const LIST_NAME = "Search contacts"

// One popup surface for every answer -- results, "Searching...", the refusal,
// the failure. They are alternatives to one another, so they occupy the same
// layer in the same place; an answer rendered in the flow instead would push
// the form down on each keystroke and move where the operator has to look.
const PANEL = "rounded-md border bg-popover text-popover-foreground shadow-md"

export type ContactPickerProps = {
  ref: RefObject<HTMLInputElement | null>
  // The typed text, controlled by the caller. It is search text, never an
  // identity: the identity is the contact `onPick` hands back.
  value: string
  // Contacts that must not be picked again, each with the reason in the
  // caller's words. This picker never invents context copy.
  excluded: ReadonlyArray<ExcludedContact>
  onValueChange: (text: string) => void
  onPick: (contact: ContactSuggestion) => void
  // What picking here DOES, as a sentence in the caller's words ("Adds a
  // contact to this group."). Described, never announced as the field's name.
  purpose?: string
}

export function ContactPicker({
  ref,
  value,
  excluded,
  onValueChange,
  onPick,
  purpose,
}: ContactPickerProps) {
  const directory = useContactSearch(excluded)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The popup's own portalled node: a second, disjoint subtree that
  // useDismissOutside must also treat as "inside" this control.
  const contentRef = useRef<HTMLDivElement | null>(null)
  const helpId = useId()
  const { open, state, suggestions, openWith, focused, queryChanged, close, retry, refocus } =
    directory

  const ready = state.kind === "ready" ? state : null
  // "Expanded" means exactly one thing: the listbox is on screen. While the
  // search runs, or is refused, or failed, the popup showing is not the
  // listbox, so the combobox is not expanded and says so.
  const listOpen = open && ready !== null
  const showPanel = open && state.kind !== "idle"
  useComboboxExpanded(ref, listOpen)
  useDismissOutside(rootRef, contentRef, open, close)

  const pick = (suggestion: ContactSuggestion) => {
    // cmdk already refuses a disabled item; this keeps the refusal true if an
    // option is ever activated another way. The backend re-checks membership
    // in any case.
    if (suggestion.excludedReason !== null) return
    onPick(suggestion)
    close()
    refocus(ref.current)
  }

  // Retry unmounts the moment the request starts (the state leaves
  // refused/failed), so the caret has to be put back on purpose or it falls to
  // the document and the operator loses the field.
  const retryHere = () => {
    retry()
    refocus(ref.current)
  }

  const query = state.kind === "idle" ? value : state.query
  const emptyQuery = query.trim() === ""
  const heading = emptyQuery ? "Contacts" : `Matches for "${query}"`
  const status = contactSearchStatus({ open, state, suggestions })

  return (
    <div className="flex w-full flex-col gap-1 sm:w-72">
      <span className="text-sm font-medium">{ACCESSIBLE_NAME}</span>
      <PopoverPrimitive.Root open={open} onOpenChange={() => {}}>
        <Command
          ref={rootRef}
          // cmdk renders this into its own visually hidden <label htmlFor>
          // and points the input's aria-labelledby at it -- the supported way
          // to name this input, and it wins over any aria-label.
          label={ACCESSIBLE_NAME}
          shouldFilter={false}
          className="relative w-full overflow-visible rounded-md border bg-transparent **:data-[slot=command-input-wrapper]:border-b-0"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !open) openWith(value)
            if (e.key === "Escape" && open) {
              e.stopPropagation()
              close()
            }
          }}
        >
          <PopoverPrimitive.Anchor asChild>
            <div className="flex items-center pr-1">
              <CommandInput
                ref={ref}
                aria-label={ACCESSIBLE_NAME}
                aria-describedby={helpId}
                // The search is in flight. This is how the wait reaches an
                // operator who cannot see the "Searching..." panel, without a
                // live region interrupting their typing once per keystroke.
                aria-busy={state.kind === "loading"}
                placeholder="Search contacts"
                value={value}
                onValueChange={(v) => {
                  onValueChange(v)
                  queryChanged(v)
                }}
                onFocus={() => focused(value)}
                // Escape closes the list and leaves the caret here, so no focus
                // event is coming: without this, clicking the field the
                // operator is already in does nothing and the list looks
                // broken. `focused` is idempotent, so a click on an open list
                // repeats no request.
                onClick={() => focused(value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={open ? "Hide contact suggestions" : "Show contact suggestions"}
                // `open`, not `listOpen`: this toggles the whole popup, and
                // while the search runs the popup IS showing.
                aria-expanded={open}
                className="size-7 shrink-0 px-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (open) close()
                  else openWith(value)
                  refocus(ref.current)
                }}
              >
                <ChevronsUpDownIcon className="size-4 opacity-60" />
              </Button>
            </div>
          </PopoverPrimitive.Anchor>
          <p role="status" className="sr-only">
            {status}
          </p>
          {/* forceMount: CommandList must stay mounted even closed (its
              aria-controls target), so presence here cannot be Radix's
              open-controlled unmount. The handlers switch off Radix's
              auto-focus and its outside/escape dismissal, all of which this
              control already owns. */}
          <PopoverPrimitive.Portal forceMount>
            <PopoverPrimitive.Content
              ref={contentRef}
              // Radix hardcodes role="dialog" here; stripped, so the only roles
              // an assistive technology finds are cmdk's own listbox and the
              // combobox pointing at it.
              role={undefined}
              hidden={!showPanel}
              side="bottom"
              align="start"
              sideOffset={4}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => e.preventDefault()}
              onPointerDownOutside={(e) => e.preventDefault()}
              onFocusOutside={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
              className={`z-50 w-(--radix-popover-trigger-width) ${PANEL}`}
            >
              {open && state.kind === "loading" && (
                <p aria-hidden className="px-2 py-1.5 text-sm">
                  Searching…
                </p>
              )}
              {/* A refusal is offered a Retry as well as a failure:
                  crm/contacts:read can start answering between two attempts
                  (a grant given meanwhile, a session renewed), and without
                  this the only way to ask again is to leave the field. */}
              {open && state.kind === "refused" && (
                <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                  <p aria-hidden className="text-xs text-muted-foreground">
                    {CONTACT_SEARCH_REFUSED_NOTE}
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={retryHere}>
                    Retry
                  </Button>
                </div>
              )}
              {open && state.kind === "failed" && (
                <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                  <p aria-hidden className="text-xs text-destructive">
                    {state.message}
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={retryHere}>
                    Retry
                  </Button>
                </div>
              )}
              {/* ALWAYS mounted, even closed: the input's aria-controls points
                  at this element's generated id, and a dangling aria-controls
                  is the same lie. Its CONTENTS stay conditional -- options
                  existing while the list is closed would still be reachable by
                  cmdk's Enter handler. */}
              <CommandList label={LIST_NAME} hidden={!listOpen} className="max-h-60 overflow-y-auto p-1">
                {open && ready !== null && (
                  <>
                    <CommandEmpty aria-hidden className="px-2 py-1.5 text-left">
                      {emptyQuery ? "no contacts to show" : "no matches"}
                    </CommandEmpty>
                    <CommandGroup heading={heading}>
                      {suggestions.map((suggestion) => (
                        <CommandItem
                          key={suggestion.id}
                          // The id is what gets posted, so it is also what
                          // cmdk keys its active option on: two contacts may
                          // share a name, and the row the operator chose must
                          // be the row that is sent.
                          value={suggestion.id}
                          disabled={suggestion.excludedReason !== null}
                          onSelect={() => pick(suggestion)}
                          // Keep focus in the input: a pointer pick must not
                          // blur and then re-focus it, which would reopen the
                          // list it just closed.
                          onMouseDown={(e) => e.preventDefault()}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="font-medium">{suggestion.name}</span>
                          {suggestion.company !== null && (
                            <span className="text-muted-foreground">{suggestion.company}</span>
                          )}
                          {suggestion.excludedReason !== null && (
                            <Badge variant="secondary" className="ml-auto">
                              {suggestion.excludedReason}
                            </Badge>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {ready.truncated && (
                      // The bounded page is a page, not the cube: say so
                      // instead of letting the first rows look like every
                      // contact there is.
                      <p aria-hidden className="px-2 py-1.5 text-xs text-muted-foreground">
                        {CONTACT_SEARCH_BOUNDED_NOTE}
                      </p>
                    )}
                  </>
                )}
              </CommandList>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </Command>
      </PopoverPrimitive.Root>
      <p id={helpId} className="text-xs text-muted-foreground">
        {purpose !== undefined ? `${purpose} ` : ""}
        {HELP}
      </p>
    </div>
  )
}
