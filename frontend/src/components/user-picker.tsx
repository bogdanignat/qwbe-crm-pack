"use client"

// The @username combobox on the kit's Command (cmdk), shared by the record
// sharing panel and the groups panel. The typed text IS the identity sent to
// the backend (username, never an id), so it keeps working when the directory
// search is refused -- the picker then says so instead of showing "no
// matches". cmdk owns the keyboard: arrows move the active option, which
// carries aria-selected and aria-activedescendant; Enter picks it.
//
// Presentation only: the search (debounce, race control, the four answers)
// lives in hooks/use-user-directory.ts and lib/user-directory.ts, the live
// sentence in lib/user-directory.ts, and the one attribute cmdk gets wrong in
// hooks/use-combobox-expanded.ts. Accounts the caller excludes are rendered
// DISABLED with the caller's own reason ("Already in group", "Already
// shared"), never filtered away -- filtering them made an existing member look
// like a directory with no such user.
//
// NAMING: the visible label and the accessible name are the SAME word,
// "Username". They have to be: a visible label that says "Add member" over a
// control an assistive technology calls "Username" gives a speech-input
// operator a name they can see but cannot say, and gives everyone else two
// different identities for one field (WCAG 2.5.3 Label in Name). The accessible
// name stays the constant below -- the same control in every panel, addressed
// by the same word by an assistive technology, a keyboard user and the e2e
// suite.
//
// The caller's per-panel wording is NOT dropped and is NOT a second label: it
// is a sentence about what picking here will do ("Adds a member to this
// group."), rendered with the help text under the field and attached through
// aria-describedby. Described, never announced as the control's identity.

import { useId, useRef, type RefObject } from "react"

import { ChevronsUpDownIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { Badge, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "shadcn-admin-kit"

import { useComboboxExpanded } from "@/hooks/use-combobox-expanded"
import { useDismissOutside } from "@/hooks/use-dismiss-outside"
import { useUserDirectory } from "@/hooks/use-user-directory"
import {
  DIRECTORY_BOUNDED_NOTE,
  DIRECTORY_REFUSED_NOTE,
  directoryStatus,
  type ExcludedUser,
  type UserSuggestion,
} from "@/lib/user-directory"
import { Button } from "@/components/ui/button"

const HELP =
  "Pick an account from the list, or type an exact username. Typing searches every account you may see."

// The visible label AND the accessible name, everywhere. See NAMING above.
const ACCESSIBLE_NAME = "Username"
const LIST_NAME = "Search users"

// One popup surface for every answer -- results, "Searching…", the refusal, the
// failure. They are alternatives to one another, so they occupy the same layer
// in the same place: an answer that appeared in the flow instead would push the
// rest of the form down and back on each keystroke, and the operator would have
// to look for it somewhere else than where the list was.
//
// PORTALLED (T-1450): both panels mount this field, one inside a Card
// (`overflow-hidden`, ui/card.tsx) that exists to clip ITS OWN content, not a
// popup this control opens on top of everything. An `absolute` box positioned
// against the field stayed a DOM descendant of that Card and was clipped by
// it -- on screen as "the list is empty" (its rows past the Card's edge simply
// never painted) and as "clicking a suggestion does nothing" (a point outside
// the clip region hits whatever is under it, never the clipped element). Popper
// positions this against the field (the anchor) from OUTSIDE that ancestor, so
// the popup is never inside a box built to clip something else, and it now
// tracks the anchor across scroll/resize on its own. Radix's own open state,
// auto-focus and outside-dismiss are switched off below: this control already
// owns all three (`open`/`state` from the hook, `refocus`, useDismissOutside)
// and letting a second system race the first is how a click starts closing a
// popup that has not decided yet whether it is opening.
const PANEL = "rounded-md border bg-popover text-popover-foreground shadow-md"

export function UserPicker({
  ref,
  value,
  excluded,
  onChange,
  purpose,
}: {
  ref: RefObject<HTMLInputElement | null>
  value: string
  // Accounts that must not be picked again, each with the reason in the
  // caller's words (the picker never invents context copy).
  excluded: ReadonlyArray<ExcludedUser>
  onChange: (username: string) => void
  // What picking here DOES, as a sentence in the caller's words ("Adds a member
  // to this group."). Rendered with the help text, not as a label: see NAMING.
  purpose?: string
}) {
  const directory = useUserDirectory(excluded)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The popup's own portalled node (T-1450): a second, disjoint subtree
  // useDismissOutside must also treat as "inside" this control. See PANEL.
  const contentRef = useRef<HTMLDivElement | null>(null)
  const helpId = useId()
  const { open, state, suggestions, openWith, focused, queryChanged, close, retry, refocus } = directory

  const ready = state.kind === "ready" ? state : null
  // "Expanded" means exactly one thing: the listbox is on screen. While the
  // search is still running, or refused, or failed, the popup showing is not
  // the listbox, so the combobox is not expanded and says so.
  const listOpen = open && ready !== null
  // Any of the four answers being shown at all -- the one condition that
  // decides whether the portalled panel has anything to paint. `idle` is the
  // only state with nothing to show (closed, or open with nothing asked yet).
  const showPanel = open && state.kind !== "idle"
  useComboboxExpanded(ref, listOpen)
  // A pointer outside, or the caret leaving the field (Tab included), closes
  // the popup: nothing this control shows outlives the operator's presence in
  // it.
  useDismissOutside(rootRef, contentRef, open, close)

  const pick = (suggestion: UserSuggestion) => {
    // cmdk already refuses a disabled item; this keeps the refusal true even
    // if an option is ever activated another way. The backend validates the
    // membership/grant again in any case.
    if (suggestion.excludedReason !== null) return
    onChange(suggestion.username)
    close()
    refocus(ref.current)
  }

  // Both Retry buttons unmount the moment the request starts (the state leaves
  // `refused`/`failed`), so the caret has to be put back on purpose or it falls
  // to the document and the operator -- mouse or keyboard alike -- loses the
  // field. `refocus` is what keeps that programmatic focus from being read as
  // the operator arriving, which would fire a second, identical search.
  const retryHere = () => {
    retry()
    refocus(ref.current)
  }

  const query = state.kind === "idle" ? value : state.query
  const emptyQuery = query.trim() === ""
  const heading = emptyQuery ? "Accounts" : `Matches for “${query}”`

  // One persistent live region: a message that appears together with its
  // container is not announced, so the visible texts below are echoes of this.
  // It also carries what a sighted operator reads off the rows themselves --
  // the count, the accounts that are present but blocked and why, and that the
  // page is bounded -- because the arrow keys skip disabled rows and would
  // otherwise leave those accounts out of the keyboard's account of the list.
  const status = directoryStatus({ open, state, suggestions })

  return (
    <div className="flex w-full flex-col gap-1 sm:w-64">
      {/* The same word the control is named by, shown. cmdk renders the
          programmatic <label htmlFor=input> itself (visually hidden, from
          `label` below) and this input's id is cmdk's own, so this is the
          visible echo of that name, not a second, competing label. */}
      <span className="text-sm font-medium">{ACCESSIBLE_NAME}</span>
      {/* Root/Anchor/Portal/Content position and portal the popup only (T-1450,
          see PANEL); this control's own open state, focus and dismiss stay
          entirely in the hook and the two handlers below -- Radix's versions of
          all three are switched off on Content. */}
      <PopoverPrimitive.Root open={open} onOpenChange={() => {}}>
        <Command
          ref={rootRef}
          // cmdk renders this into its own visually hidden <label htmlFor=input>
          // and points the input's aria-labelledby at it. That is the supported
          // way to name this input: cmdk writes aria-labelledby after the caller's
          // props, so it always wins, and an aria-label alone would only be read
          // through the empty-labelledby fallback.
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
            // Same string as the hidden label above. aria-labelledby wins over
            // this, so it is inert while cmdk behaves; it is here as the
            // fallback that keeps the control named if the kit ever stops
            // forwarding `label`, and never as a second, different name.
            aria-label={ACCESSIBLE_NAME}
            aria-describedby={helpId}
            // The search is in flight. This is how the wait reaches an operator
            // who cannot see the "Searching…" panel, WITHOUT a live region
            // interrupting their typing once per keystroke (see
            // directoryStatus: only settled states are announced).
            aria-busy={state.kind === "loading"}
            placeholder="@username"
            value={value}
            onValueChange={(v) => {
              onChange(v)
              queryChanged(v)
            }}
            onFocus={() => focused(value)}
            // Escape closes the list and leaves the caret here, so no focus
            // event is coming: without this, clicking the field the operator is
            // already in does nothing at all and the list looks broken. Goes
            // through `focused`, which is idempotent -- a click on an open list
            // repeats no request.
            onClick={() => focused(value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            // The input keeps focus: this control only opens or closes the
            // list, the combobox itself stays where the operator types.
            aria-label={open ? "Hide account suggestions" : "Show account suggestions"}
            // `open`, not `listOpen`: this button toggles the whole popup, and
            // while the search is still running the popup IS showing (the
            // "Searching…" panel) and this click closes it. The input's own
            // aria-expanded is narrower on purpose -- it describes the listbox
            // its aria-controls points at, which is not on screen yet.
            aria-expanded={open}
            className="size-7 shrink-0 px-0"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open) close()
              else openWith(value)
              // Goes through the hook so the focus event this may fire is not
              // mistaken for the operator arriving at the field -- which would
              // re-run the search just opened, or reopen the list just closed.
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
        {/* forceMount: CommandList below must stay mounted even closed (see its
            own comment), so presence here cannot be Radix's default
            open-controlled unmount. `hidden={!showPanel}` is this component's
            own visibility switch, unrelated to Radix's. The five handlers turn
            off Radix's auto-focus and outside/escape dismissal -- this control
            already owns all of that (openAutoFocus would otherwise steal the
            caret from the input the moment a panel appears; the others would
            race useDismissOutside and Command's own Escape handler above). */}
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content
            ref={contentRef}
            // Radix hardcodes role="dialog" on this node (it is built for
            // popovers, not a listbox's popup): stripped, so the only roles an
            // assistive technology finds here are cmdk's own -- CommandList's
            // listbox and the combobox input pointing at it -- not a dialog
            // wrapping a combobox, which is not what this control is.
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
        {/* Still visible, and still visible on every keystroke: the live region
            went quiet about the search, the eye did not. */}
        {open && state.kind === "loading" && (
          <p aria-hidden className="px-2 py-1.5 text-sm">
            Searching…
          </p>
        )}
        {/* A refusal is offered a Retry as well as a failure. account:read can
            start answering between two attempts -- a grant given meanwhile, a
            session renewed -- and without this the operator's only way to ask
            again is to leave the field and come back. The note stays exactly as
            it is: the typed username remains the identity, so the fallback the
            refusal protects is never replaced by the button. */}
        {open && state.kind === "refused" && (
          <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
            <p aria-hidden className="text-xs text-muted-foreground">
              {DIRECTORY_REFUSED_NOTE}
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
        {/* ALWAYS mounted, even closed and empty: the input's aria-controls
            points at this element's generated id, and an aria-controls with no
            target is a dangling reference. Its CONTENTS stay conditional --
            options that exist while the list is closed would be reachable by
            cmdk's Enter handler, which picks the active option wherever the
            focus is. */}
        <CommandList
          // cmdk writes CommandList's aria-label after the caller's props too
          // (defaulting to "Suggestions"), so the name travels as `label`; an
          // aria-label here would be overwritten and never reach the DOM.
          label={LIST_NAME}
          hidden={!listOpen}
          className="max-h-60 overflow-y-auto p-1"
        >
          {open && ready !== null && (
            <>
              <CommandEmpty aria-hidden className="px-2 py-1.5 text-left">
                {emptyQuery ? "no accounts to show" : "no matches"}
              </CommandEmpty>
              <CommandGroup heading={heading}>
                {suggestions.map((suggestion) => (
                  <CommandItem
                    key={suggestion.id}
                    value={suggestion.username}
                    disabled={suggestion.excludedReason !== null}
                    onSelect={() => pick(suggestion)}
                    // Keep focus in the input: a pointer pick must not blur and
                    // then re-focus it, which would reopen the list it closed.
                    onMouseDown={(e) => e.preventDefault()}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {/* username + displayName only; email never renders (G8). */}
                    <span className="font-medium">{suggestion.primary}</span>
                    {suggestion.secondary && (
                      <span className="text-muted-foreground">{suggestion.secondary}</span>
                    )}
                    {suggestion.excludedReason && (
                      <Badge variant="secondary" className="ml-auto">
                        {suggestion.excludedReason}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              {ready.truncated && (
                // The bounded page is a page, not the directory: say so instead
                // of letting the first rows look like every account there is.
                // The only number is the cap that was requested, and the surplus
                // is a possibility -- see DIRECTORY_BOUNDED_NOTE.
                <p aria-hidden className="px-2 py-1.5 text-xs text-muted-foreground">
                  {DIRECTORY_BOUNDED_NOTE}
                </p>
              )}
            </>
          )}
        </CommandList>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
        </Command>
      </PopoverPrimitive.Root>
      {/* One described block: what this field will do here (the caller's
          sentence), then how to use it. Both are permanent text, so the live
          region never has to repeat either of them. */}
      <p id={helpId} className="text-xs text-muted-foreground">
        {purpose ? `${purpose} ` : ""}
        {HELP}
      </p>
    </div>
  )
}
