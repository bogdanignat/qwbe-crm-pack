# crm-pack frontend (QWB-48)

Next.js (App Router) + TypeScript + Tailwind app for the CRM pack. All UI
components come from [shadcn/ui](https://ui.shadcn.com) — copied exactly as the
shadcn CLI generated them, never restyled -- plus, on the detail pages, the
[shadcn-admin-kit](https://github.com/marmelab/shadcn-admin-kit) 1.0.7 package (MIT), used as
published (QWB-53 / QWB-54, below).

## Authentication model

Follows `qwbe/docs/external-frontend-auth.md`: the qwbe token never reaches the
browser. It lives in an httpOnly cookie set by the Next.js server, and every
call to qwbe goes through a Next.js route handler acting as a server-side proxy
(`src/app/api/qwbe/[...path]/route.ts`).

## Metadata-driven lists and details (QWB-49)

The lists at `/organizations` and `/contacts` are one generic component driven entirely by the
per-cube field metadata that qwbe publishes at `GET /catalog/{cube}/metadata`: columns,
sorting, editability, search and paging all come from that metadata, so adding a field to a
cube makes it appear in the UI with no frontend change. Inline editing PATCHes through the
server-side proxy and surfaces a qwbe validation error in the edited cell; detail pages are
assembled from the same metadata, with an organization's contacts derived by filtering
`crm/contacts` on `organizationId` and a contact's organization shown as a relation link.
Paging and sorting are server-side end to end — the row request always carries
`offset`, `limit` and `sortBy` and never fetches more than one page.

## Detail pages: one shadcn-admin-kit renderer for every entity (QWB-53, QWB-54)

`/organizations/[id]` and `/contacts/[id]` are the SAME component, `CubeKitShow` in
`src/components/kit/cube-show.tsx`, built on the real shadcn-admin-kit 1.0.7 components (Card,
RecordField, Form, TextInput, SelectInput, BooleanInput, ReferenceInput + AutocompleteInput,
SaveButton) running on `ra-core`, the kit's runtime, inside one scoped island
(`src/components/kit/kit-context.tsx`): a `CoreAdminContext` with the data provider
(`src/lib/qwbe-data-provider.ts`, every verb over the same server-side cookie proxy every other call
uses; a refusal becomes ra-core's `HttpError` with qwbe's message and the per-field `body.errors`)
and a `MemoryRouter` so the kit's routing hooks have a context without touching the Next.js router.
Nothing outside the island changes: Next.js keeps the URLs, the navigation, the login and the
httpOnly cookie.

A page names its fieldsets by field NAME only (`ORGANIZATION_GROUPS`, `CONTACT_GROUPS` in the page
files); `groupFields` in `src/lib/cube.ts` distributes the published metadata over them, skips a name
the backend no longer publishes, and puts every field no group names in "Other" (static) or "Custom
fields" (runtime custom fields), so a field defined tomorrow shows up without a frontend change. A
group may carry `important: true`: a border accent plus the word "Important" in its legend, a layout
emphasis for the page's primary section (never color alone, never derived from the data); both pages
demonstrate it on their first group.

Read mode shows every published field with a Copy action, a relation as a link to its target's page,
and a collapsible "Schema & API" panel (QWB-55) linking the field metadata, the record JSON and the
OpenAPI document through the proxy. Edit turns the same page into a form in place (same URL): the
fields the metadata marks editable get the kit input their type calls for (enum -> `SelectInput`,
boolean -> `BooleanInput`, integer or number -> a number `TextInput`, relation -> the reference
picker, else `TextInput`), a non-editable field keeps its read-only display, and one Save PATCHes only
the keys that changed (`changedPayloadOf` in `src/lib/kit-form.ts`, coerced by the rule the inline
list editor uses); Cancel discards the drafts. A refusal keeps the drafts on screen with qwbe's own
message and the refused field's label. An organization's contacts stay a derived `CubeList` pinned on
`organizationId` under the card.

## App shell (T-1812)

Every signed-in page renders inside `AppShell` (`src/components/app-shell.tsx`, from the root
layout; `/login` stays bare): a shadcn Sidebar with the vtiger module groups holding only the
modules that have a page (`app-sidebar.tsx`; Settings only when `/auth/me` reports the `admin`
role, read once per mount by `useCurrentUser`, shared with the page's panels), a drawer on narrow
screens, and a top bar with the ⌘K / Ctrl+K search palette
(`search-palette.tsx`, the shadcn Dialog around the kit's Command; one `q` list request per module
in `src/lib/global-search.ts`, demo organizations marked), "+ New" and the account menu
(Preferences, Sign out). The pages themselves are one registry, `src/lib/app-pages.ts`: the menu,
"+ New", the search and the record links (`RELATION_ROUTES`) derive from it. What it still needs from the backend is in
`docs/plan/organizations-backend.md` §7.

## Run it

```sh
npm install
cp .env.example .env.local   # then edit if needed
npm run dev                  # http://localhost:3000
```

## Environment variables

| Variable       | Side          | Meaning                                  |
| -------------- | ------------- | ---------------------------------------- |
| `QWBE_API_URL` | server only   | Base URL of the qwbe API, e.g. `http://localhost:4500`. No `NEXT_PUBLIC_` prefix on purpose. |

## Tests and checks

```sh
npm test        # unit tests: cookie, login, proxy logic and the metadata-driven list logic (node --test)
npm run lint
npm run typecheck
npm run e2e     # end-to-end scenarios through the Orca browser (see below)
```

## End-to-end scenarios through the Orca browser (QWB-51)

`npm run e2e` runs one command end to end (`e2e/run-e2e.mjs`):

1. Copies the merged qwbe platform from its repository with `git archive origin/main` into
   `/tmp/qwbe-e2e` (the qwbe checkout itself is never touched) and installs the crm-pack
   cubes under `core/plugins/crm-pack` the way `plugins/crm-pack/probes/crm.mjs` does.
2. Starts qwbe and this frontend on free ports (never 4500/4510), each with `nohup` from
   inside the runner, records the PIDs, and polls both URLs before any browser step. If
   either server does not come up, the run stops with a clear message.
3. Seeds, through the qwbe API with a real login, two organizations and two contacts (one
   linked through `organizationId`). The seed is idempotent and its teardown deletes exactly the
   rows it created; all names are obviously fake.
4. Drives the real UI through the Orca browser (`orca` CLI): login, the organization list
   with sorting and searching, an inline edit on an editable field, the refused inline edit
   on a non-editable field, organization -> contact -> back, and logout. Every scenario
   leaves at least one screenshot and a PASS/RED/SKIP line.
5. Tears down: seed rows deleted, servers killed by PID, work directory removed. Exits
   non-zero if any scenario is not PASS.

Results (screenshots plus `results.md`) land in
`<crm-pack>/.local/e2e-results/<YYYY-MM-DD>/` (override with `QWBE_E2E_RESULTS`).

What it needs: the Orca app running locally with its runtime ready (`orca status --json`
must report `state: "ready"`), its CLI shim set in the environment (`ORCA_CLI`), and
the qwbe and crm-pack checkouts at their default paths — the kernel at `../../qwbe`
relative to this checkout, and crm-pack at this checkout (override with `QWBE_REPO` and
`CRM_PACK`). It runs only on the Orca host.

A refused login (no qwbe session) is not faked green: the login scenario is driven anyway
and recorded RED with screenshots, the session-bound scenarios are recorded SKIP, and the
runner exits non-zero.

The list tests stub qwbe entirely: they prove that columns are derived from metadata
(a field added to the stub appears without touching any component), that non-editable
fields refuse editing, that a refused PATCH leaves the old value and carries qwbe's
own message for the edited field back to the cell, that relation links resolve to the
right href (and yield no link for a target without a route), that sorting refuses a
non-sortable column, and that the list request carries the page, sort and filter
parameters without letting a filter key override paging.
