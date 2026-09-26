# T-1452 - Access groups restored in CRM Settings (Step A)

- **Date:** 2026-09-26
- **Repo / branch:** `qwbe-plugins/crm-pack` - `feat/t1450-user-picker-ux`, working tree dirty
- **Baseline HEAD:** `a621d657a1582680736b06e1e6e67d1cb945825a`
- **Plan:** `qwbe/docs/superpowers/plans/2026-09-26-crm-settings-sdk-continuation.md`, **Step A only**
  (approved for execution on 2026-09-26; the older "NOT APPROVED" line is superseded by the
  owner's explicit approval recorded in the plan's Status section)
- **Scope guard:** nothing outside `crm-pack/frontend` was touched. `qwbe`, the CRM root
  `package.json`, backend cubes, root tools and the plan document are unchanged.

## What Step A delivers

CRM `/settings` mounts **Access groups** again: the permission groups of a CRM cube, administered
through the SAME qwbe permissions API the host uses (same group IDs, same create / rename /
membership endpoints). No new store, no roles, no inheritance, no `deleteGroup`. Business
**Contact groups** stay a separate feature on `/contact-groups`.

The access-scope selector is independent of the customfields entity selector. It reads the live
cube catalogue and keeps only this pack's cubes (`crm` or `crm/*`, enabled), including
`crm/contact-groups` labelled *"Contact groups (access to the group records)"* so it can never be
misread as contact membership. Switching scope remounts the panel (`key={chosen}`), so no group
list, member page, rename draft or open confirm survives from the previous scope.

## Baseline (captured before any edit)

| Command | Result |
| --- | --- |
| `git status --porcelain` (both repos) | dirty; 13 tracked modifications + untracked T-1450 / contact-groups artifacts, `.t1450-baseline/`, `.playwright-mcp/`, screenshots - all preserved |
| `npm test` (frontend) | 367 pass / 0 fail |
| `npm run typecheck` | clean |
| `npm run lint` | 1 pre-existing warning: `src/hooks/use-relation-titles.ts 83:43 react-hooks/exhaustive-deps` |
| `npm run build` | exit 0 |

No stash command was used (blocked by policy); the baseline was recorded from status/diff only.

## Files

New:

- `frontend/src/lib/access-scopes.ts` - scope catalogue seam: `isAccessScope`, `accessScopeLabel`,
  `parseCubeCatalogue`, `accessScopesOf`, `fetchAccessScopes`, `FALLBACK_ACCESS_SCOPES`,
  `FALLBACK_NOTICE`.
- `frontend/src/hooks/use-access-scopes.ts` - effect-free catalogue read (`useQuery`, `retry:false`,
  `staleTime` 60s, explicit `retry()`).
- `frontend/src/hooks/use-permission-groups.ts` - list / access / create controller extracted from
  the old 506-line panel; `loading | manage | denied | failed`; seq + mounted guards; selection
  retained through `retainSelectedGroup`.
- `frontend/src/hooks/use-group-members.ts` - members controller: one batch `lookupAccounts` per
  page, `MEMBERS_PAGE = 50`, `membersHasMore()` reused, step-back when a later page empties,
  `settle(status)` refetches and reports 403/404 upward.
- `frontend/src/components/group-section.tsx` - rename form, member list + pager, `UserPicker` with
  `excluded` marks.
- `frontend/src/components/member-item.tsx` - the two-step remove row, moved out unchanged.
- `frontend/src/components/access-groups-panel.tsx` - the Access groups card and scope selector.
- `frontend/src/lib/query-client.ts` - the shared QueryClient and its lifetime rule.
- `frontend/src/components/query-provider.tsx` - composition only; wraps just this panel.
- `frontend/src/lib/access-scopes.test.ts` - catalogue tests.

Modified:

- `frontend/src/components/groups-panel.tsx` - rewritten as presentation over the two hooks.
- `frontend/src/app/settings/page.tsx` - mounts `<QueryProvider><AccessGroupsPanel /></QueryProvider>`
  below the existing customfields panel; the stale `/tmp/qwbe-access-ui-report.md` comment now points
  at this document.
- `frontend/src/lib/sharing.ts` - stale "no uniqueness check exists" comment replaced with the real
  rule; added `retainSelectedGroup` and `groupWriteRefusalMessage`.
- `frontend/src/lib/sharing.test.ts` - duplicate-name (409) and selection-retention suites.
- `frontend/e2e/user-picker-portal-check.mjs` - header comment corrected: `/settings` mounts access
  groups again.

## Decisions worth keeping

- **403 fallback is not an auth bypass.** Only a `403` from the *catalogue* yields the built-in
  scope list, and always with a visible `role="status"` notice saying the list is the pack's own,
  not the installation's. Any other failure is surfaced with a Retry, never silently replaced. Each
  scope's group list is still authorised by the kernel; the fallback only affects which names the
  operator can pick.
- **No new fetching `useEffect`.** The single new read (the cube catalogue) goes through the
  already-installed `@tanstack/react-query` 5.102.8, scoped to this panel - not an app-wide
  migration. The relocated group/member fetching is pre-existing code moved into hooks with
  identical semantics.
- **Group names are unique per cube.** `permission_groups_cube_name_key` is partial-unique on
  `lower(btrim(name))`, so `409` is a normal answer for create AND rename; the wording says names
  ignore case and surrounding spaces.
- **No scope is auto-selected**, so nothing is fetched or shown before the operator chooses.

## Documentation consulted

- `frontend/node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/tanstack-query.md`
  (installed Next 16.3.3) - the QueryClient lifetime rule: fresh client per server render, one
  reused browser client.
- `qwbe/core/src/cubes/settings/index.ts` - `GET /settings/cubes`, `settings:read`.
- `qwbe/core/src/http-contracts.ts:30` - `CubeInfo`, the catalogue row shape the parser accepts.
- `qwbe/core/src/cubes/permissions/groups.ts` and `groups-unique.test.ts` - the uniqueness index.
- `~/.pi/agent/rules/INDEX.md`, `react-rules` `references/react-patterns.md`, repo `CLAUDE.md` / wiki.

## Verification after the change

| Command (run in `frontend/`) | Result |
| --- | --- |
| `npm test` | `tests 385 / pass 385 / fail 0` (baseline 367) |
| `npm run typecheck` | clean (`tsc --noEmit && tsc -p e2e --noEmit`) |
| `npm run lint` | unchanged: the same single pre-existing `use-relation-titles.ts` warning |
| `npm run build` | success - `Compiled successfully`, 15/15 static pages, `/settings` static |

Test coverage added: exact cube scope list / order / disabled-drop, `crm/contact-groups` label
asserted to say *access* and not *member*, catalogue path equals `/api/qwbe/settings/cubes`, `403`
to fallback + notice, `500` and malformed body reject, `409` on create and on rename with
case-insensitive wording, `403`/`400`/`404` refusal wording, selection retention across a re-read.

## Caveats

- The `executing-plans` skill named in the brief is **not installed** (`Unknown skill`); the plan was
  executed step-scoped by hand instead.
- Context7 MCP was unavailable to this worker and the cache had no `/tanstack/query` entry
  (`status: missing`) - **cacheRefreshNeeded**: `/tanstack/query` "QueryClientProvider Next.js App
  Router client component". The installed Next doc was used as the authority instead.
- **No browser run.** `npm run e2e` copies qwbe and starts real servers plus the Orca CLI, and no
  DOM test library (testing-library / jsdom / vitest / jest) is installed, so no mocked fixture can
  exercise the panel without live services. Remount behaviour is covered by `key=` in code plus the
  pure `retainSelectedGroup` tests; the live check remains outstanding.
- No `diffcheck` script exists in either `package.json`; the diff was reviewed manually
  (`git status` / `git diff` per file).
- Nothing was committed, pushed or merged; the active DB was not queried or mutated; the installed
  plugin was not restarted or synchronised; no prior dirty work or untracked artifact was removed.

---

# Opus UI review of Step A - findings and how each was resolved

- **Review date:** 2026-09-26, read-only Opus diff review of Step A. **Verdict: REVISE.**
- **Review artefact:** `/tmp/t1452-ui-review.EbT4Vj/result.txt` (a `/tmp` path, therefore
  reproduced below - this document is the durable copy the plan asks for).
- **Fix round:** 2026-09-26, same branch `feat/t1450-user-picker-ux`, frontend only. The other
  worker owns `qwbe`, the CRM root `package.json`, backend cubes and root `tools/`; nothing outside
  `crm-pack/frontend` was touched, no commit, no push, no active DB, no restart, and no untracked
  artefact of an earlier ticket was removed.

Every finding was reproduced in the code before it was changed; nothing was fixed on the
reviewer's word alone.

| # | Sev | Finding | Verified as | Resolution |
| --- | --- | --- | --- | --- |
| 1 | HIGH | `e2e/scenarios.mjs` waited for "Permission groups" straight after `open("/settings")`, but that text only exists in the groups panel, which mounts after a scope is chosen (`access-groups-panel.tsx` `chosen !== ""`). `scenarioGroups` was a guaranteed RED. | real | New `chooseAccessScope(label)` helper (mirrors `chooseEntity`); the scenario now waits for the **Access groups** card, chooses **Organizations** (the label of `crm/organizations`, the cube it asserts at the API), and only then waits for "Permission groups". Each step records its own RED detail. |
| 2 | HIGH | `groupWriteRefusalMessage` was applied to MEMBERSHIP writes: a real `404 username X does not exist` was shown as "This group no longer exists.", and a `400` from this adapter ("choose a user", "invalid group id") as "A group name is required." | real | New `memberWriteRefusalMessage` in `lib/sharing.ts`, used by `add` and `remove` only. It words the one status whose meaning is fixed on those routes (`403`) and passes every other message through verbatim, because on `/members` a `404` can be the username, the group or the membership and only the message says which. `groupWriteRefusalMessage` is now documented and used for create/rename alone (`rename` keeps it: `409` there means the name is taken). |
| 3 | MEDIUM | The coverage the plan demanded (cross-scope remount / stale / dialogs / already-member / durable browser fixture) did not exist: only pure tests, `key=` as source text, and no `*-check.mjs` bound to an npm script. | real | New isolated browser fixture, `npm run test:ui` - see **Durable UI fixture** below. Six tests, all six run and pass; three of them fail on the pre-fix code (negative control recorded below). |
| 4 | MEDIUM-LOW | The `403` fallback answer was cached as a success with `staleTime: 60_000`, and the Retry only rendered on `error`, so after `settings:read` was granted the built-in list survived until a page reload. | real | `staleTime` is now a function: `0` when `data.source === "fallback"`, 60s for a live answer, so a fallback is never held fresh. The fallback notice carries its own Retry (accessible name "Read the installed access scopes again"; the error-path Retry is named "Read the access scopes again", so the two are never the same control by name), disabled while a re-read is in flight (`refreshing`). |
| 5 | LOW | `FALLBACK_ACCESS_SCOPES` was built in `LABELS` order (organizations, contacts, contracts, contact-groups) while a live answer is sorted by cube name, so the selector reordered itself between the two sources. | real | Both paths go through one exported-in-spirit comparator `byCubeName`; the fallback list is sorted with it. `access-scopes.test.ts` now asserts the sorted order AND that it equals a sort of itself; the browser fixture asserts the order the operator actually sees. |
| 6 | LOW | `setBusy(true)` with no `try/finally` in `use-permission-groups.create` and the three writes of `use-group-members`: a throw would leave the panel disabled with no message. Worse than reported: the flag was only cleared `if (mounted.current)`, so switching GROUP mid-write left the surviving parent panel busy forever. | real, plus the leak above | Every write releases the flag in `finally`. `usePermissionGroups` now owns a guarded `setBusy` (a no-op once the list itself unmounted), so the child sections release it unconditionally and a section replaced mid-write can no longer strand the panel. |
| 7 | LOW | Toast after unmount: the hooks knew `mounted`, the components toasted anyway, so "Added @x to \<old group\>" could appear after a scope switch. | real | The three membership writes and `create` now answer `null` when their panel is gone (`SettledMemberWrite` / `SettledGroupWrite`); `groups-panel.tsx` and `group-section.tsx` return on `null` and say nothing. Asserted in the fixture (test 5). |
| 8 | INFO | Two data mechanisms in one panel (react-query for the catalogue, relocated effect+state for groups/members) and a second parser over `/settings/cubes`. Explicitly noted as not a plan violation. | acknowledged | Left as designed. The plan rejects effect fetching for NEW reads and rejects an app-wide query migration; the group/member code is pre-existing behaviour relocated unchanged. `parseActivityCubes` cannot be reused (it drops `entity: null`, which the scope list needs for `crm`). |

Reviewer items that were already correct were left alone: fallback only on a catalogue `403`, group
lists still authorised per request, no token/storage write, `contact-groups` separate, no `any`, no
business logic or fetching in components, one component per file, existing primitives.

The reviewer's own two caveats stand: `requireCubeAccess` does not check `enabled` (a backend
matter, and the fallback only widens which NAMES can be picked, never what the server allows), and
`frontend/e2e/user-picker-portal-check.mjs` is untracked, not modified - the earlier "Modified"
line in this document's Files section is corrected by this sentence.

## Durable UI fixture (`npm run test:ui`)

`frontend/e2e/ui/` - the real app in a real Chromium against a mocked world, and **nothing of the
live CRM**:

- `fixture.mjs` - builds this frontend into `QWBE_DIST_DIR=.next-ui-fixture` (new, gitignored) and
  serves it with `next start` on an **ephemeral** port; `4500`, `4510` and `4520` are refused
  outright. `.next` is never written, so a running `next dev` and the output of `npm run build` are
  untouched. `next build` also rewrites the tsconfig it is configured with (it injects that
  distDir's type globs and reformats the file), so the fixture no longer lets it near the tracked
  `tsconfig.json` at all: it hands Next a throwaway byte copy through `QWBE_TSCONFIG` - see
  **Final review round** below, which replaced the earlier snapshot-and-restore of the real file.
- `mock-world.mjs` - a disposable in-memory world rebuilt per test, reproducing only the shapes and
  statuses the panel reads: the members page shape, the idempotent add, the `403` of
  `requireCubeAccess`, and the three different `404` messages the kernel really sends
  (`username X does not exist`, `group X does not exist`, `membership does not exist`). `removed`
  is the account **id**, as `sharing-handlers.ts` returns it.
- `access-groups.test.mjs` - `node:test`, six tests. Every `/api/qwbe/**` request is fulfilled
  **inside the browser** by a Playwright route handler, so the Next proxy never runs: no qwbe
  process, no database, no token, no session. The session cookie is a literal string, because the
  middleware only checks that the cookie exists.
- Playwright `1.63.0` and its Chromium are the ones already present under
  `frontend/node_modules` / `~/.cache/ms-playwright`. It is now a **declared, exactly pinned
  devDependency** of `frontend/package.json` (`"playwright": "1.63.0"`), installed offline from the
  npm cache - see **Final review round** below for the lock diff and the reproducibility evidence.
  The fixture still imports it lazily, so a tree without it fails with one sentence instead of a
  bare module-resolution error.

| Fixture test | What it pins |
| --- | --- |
| no panel before a scope is chosen; a scope switch keeps nothing | nothing is administered by default; after the switch the member row, the rename form and the previous group's name are gone, the group select is back to "choose a group", and the new scope's own group is what is offered |
| a vanished group is dropped, and the confirmation open over it with it | with a remove confirmation open, the group is deleted behind the panel; the next list read drops the selection and the confirmation disappears with the section |
| an account already in the group is offered DISABLED | the suggestion carries "Already in group" and `aria-disabled="true"` |
| a membership refusal keeps the server's words | `username ghost does not exist` is shown; "This group no longer exists." and "A group name is required." appear nowhere; the panel is not left busy |
| an answer after the panel was replaced says nothing | a 2.5s-late successful add, with the scope switched meanwhile: no toast, the old group is never named, and the new panel's Create is enabled (the `finally` released the flag) |
| the `403` fallback is not a dead end | the notice is shown, the four fallback options are in cube-name order, and its Retry reaches the installed list once the `403` stops (a live-only option, `crm`, appears) |

### Negative control (the tests were proven to fail on the pre-fix code)

The four fixes were temporarily reverted in place (member mapper, the unmount guard in `add`, the
fallback sort, the fallback `staleTime` + notice Retry) and `npm run test:ui` was re-run:

```
pass 3 / fail 3
x reports a refused membership write in the words the server sent, never as a missing group
x says nothing when the answer arrives after its panel was replaced, and still releases the busy flag
x lets the operator leave the 403 fallback list, and offers it in the same order a live answer would
```

The three that still passed (remount, stale + dialog, already-member disabled) cover behaviour that
was already correct; they are the coverage the plan asked for, not regressions of a shipped defect.
The sources were restored from byte copies and re-verified after the run.

## Verification of this fix round (all run in `frontend/`)

| Command | Result |
| --- | --- |
| `npm test` | `tests 388 / pass 388 / fail 0` (385 before this round; +3 for the membership refusal mapper) |
| `npm run typecheck` | clean (`tsc --noEmit && tsc -p e2e --noEmit`; the e2e project type-checks the new `.mjs` fixture too) |
| `npm run lint` | back to the ONE pre-existing warning, `src/hooks/use-relation-titles.ts 83:43 react-hooks/exhaustive-deps`; 0 errors |
| `npm run build` | `Compiled successfully`, 15/15 static pages, `/settings` static |
| `npm run test:ui` | `tests 6 / pass 6 / fail 0` - a real Chromium, run four times in total (two red rounds while the selectors were wrong, then green, then green again after the tsconfig-restore change) |

## Files touched in this round

- `frontend/src/lib/sharing.ts` - `memberWriteRefusalMessage` added; `groupWriteRefusalMessage`
  scoped in words to create/rename.
- `frontend/src/lib/sharing.test.ts` - three suites for the membership mapper.
- `frontend/src/lib/access-scopes.ts` - `byCubeName`, one order for both sources.
- `frontend/src/lib/access-scopes.test.ts` - the fallback order assertion corrected to the sorted
  order.
- `frontend/src/hooks/use-access-scopes.ts` - `staleTime` per source, `refreshing`, Retry documented.
- `frontend/src/hooks/use-group-members.ts` - membership mapper, `try/finally`, `null` when gone.
- `frontend/src/hooks/use-permission-groups.ts` - guarded `setBusy`, `try/finally`, `null` when gone.
- `frontend/src/components/access-groups-panel.tsx` - Retry beside the fallback notice, both Retry
  controls given distinct accessible names.
- `frontend/src/components/groups-panel.tsx`, `frontend/src/components/group-section.tsx` -
  presentation only: return on a `null` outcome.
- `frontend/e2e/scenarios.mjs` - `chooseAccessScope` and the corrected `scenarioGroups` opening.
- `frontend/e2e/ui/fixture.mjs`, `frontend/e2e/ui/mock-world.mjs`,
  `frontend/e2e/ui/access-groups.test.mjs` - new.
- `frontend/package.json` - `test:ui` script.
- `frontend/next.config.ts` - optional `QWBE_DIST_DIR`, used only by the fixture.
- `frontend/.gitignore` - `/.next-ui-fixture/`.

## What is still NOT verified

- **`npm run e2e` was not run.** It copies the kernel out of the `qwbe` repository, starts real
  servers and needs the Orca CLI, and the `qwbe` backend is being changed by another worker in the
  same window. The `scenarioGroups` correction is therefore reviewed and type-checked
  (`tsc -p e2e`), not executed; it must be run once the backend settles.
- No live CRM stack was driven: the browser evidence above is the fixture's mocked world, not the
  installed instance. A live check remains outstanding, as the plan says.
- The other `*-check.mjs` scripts in `e2e/` are still not bound to an npm script; they need the live
  stack, so binding them was left out of this scope deliberately.
- `playwright` remains undeclared in `package.json` (see above) - `npm run test:ui` depends on an
  ad-hoc install until the owner approves adding it.

---

# Final review round - Opus re-review of the fix round (2026-09-26)

- **Review artefact:** `/tmp/t1452-ui-rereview.RcGYpS/result.txt` (a `/tmp` path, therefore
  summarised here - this document is the durable copy). **Verdict: APPROVE WITH NITS.** All seven
  earlier findings were confirmed fixed in source, and three new items were raised.
- **Fix round:** same branch `feat/t1450-user-picker-ux`, **frontend only**. The other worker still
  owns `qwbe`, the CRM root `package.json`/`package-lock.json`, backend cubes and root `tools/`;
  nothing outside `crm-pack/frontend` was touched. No commit, no push, no `~/.pi/agent` change, no
  live stack, no DB, and no foreign artefact removed (the stray root screenshots of T-1450 and
  `.t1450-baseline/` were left exactly as found).
- The `executing-plans` skill named in the brief is still **not installed** (`Unknown skill`);
  `react-rules` was loaded and applied.

## Finding A (MEDIUM-LOW) - the unmount guard suppressed the PARENT's refresh, not just the toast

`use-group-members.ts` opened each of its three writes with `if (!mounted.current) return null`
**before** any effect. `mounted` belongs to the member SECTION, which the panel keys by group id
(`groups-panel.tsx` `key={admin.selected.id}`), so switching group unmounts it while the panel above
it lives on. The early return therefore also skipped `onChanged()` - the parent list's re-read:

- a rename that succeeded while the operator switched group left the group select still offering the
  **old** name;
- an add/remove answered `404 group X does not exist` after a switch left the deleted group still on
  the list.

**Resolution** - the guard now gates the ANNOUNCEMENT only, and nothing else:

- `rename` asks for `onChanged()` first (on success, `403` or `404`), builds the outcome, and returns
  `mounted.current ? outcome : null`.
- `settle` (used by `add` and `remove`) keeps `onChanged()` unconditional for `403`/`404` because the
  list is the parent's and outlives the section, and now runs `refetch()` **only** if still mounted -
  re-reading this section's own member page after it is gone would fetch for a screen nobody is
  looking at.
- `add` and `remove` call `settle` before the guard and likewise return `mounted.current ? outcome : null`.
- `busy` was already released unconditionally in `finally` (guarded inside `usePermissionGroups`), so
  that half of the contract was already right; the `SettledMemberWrite` doc comment now states the
  rule: **`null` suppresses the announcement only.**

`use-permission-groups.create` keeps its guard *before* `load()` on purpose: there `mounted` is the
panel's own, so a `load()` after it unmounted would be a read for nothing.

## Finding B (LOW) - `next-env.d.ts` was not restored, and the `tsconfig.json` restore was unconditional

Two halves of one problem, and the reviewer's suggested fix (restore only if the post-build file
`contains DIST_DIR`) was judged **not adequate**: `next build` reformats the whole file, so a
concurrent edit that landed inside the build window would still be discarded byte-for-byte.

An **isolated fixture project copy** was tried first and is **not feasible on this stack**: a copy in
`os.tmpdir()` with `node_modules` symlinked back is rejected by Turbopack, verified by running it:

```
Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid, it points out of the filesystem root
```

and copying or hard-linking the 810 MB `node_modules` would either be too slow per run or share
inodes with the real tree - exactly the mutation hazard being removed.

**Resolution** - split by which file Next lets us redirect:

- **`tsconfig.json` (tracked): now never opened for writing at all.** Next resolves the file it
  rewrites as `join(dir, typescript.tsconfigPath || "tsconfig.json")`
  (`next/dist/lib/verify-typescript-setup.js:106-107`, Next `16.3.3` installed here), so
  `next.config.ts` gained a fixture-only `QWBE_TSCONFIG` knob and the fixture hands `next build` a
  **byte copy** (`tsconfig.ui-fixture.json`, gitignored) deleted in `finally` together with any
  `tsconfig.ui-fixture.tsbuildinfo`. A byte copy, so it cannot drift from the real config. With
  nothing written, there is no snapshot to restore and no concurrent edit a restore could clobber.
- **`next-env.d.ts` (generated, gitignored, "should not be edited"): the one file still written in
  place**, because its path is hard-coded `join(baseDir, "next-env.d.ts")`
  (`next/dist/lib/typescript/writeAppTypeDeclarations.js`) and its contents follow `distDir`. The
  restore is now conditional: it happens **only** when the post-build file has the same line count
  as the snapshot and every differing line is a generated `import "./<dir>/types/...";` whose new
  value names `DIST_DIR`. Anything else is left untouched and a `console.warn` says so - a stale
  d.ts that the next `next dev`/`next build` regenerates is a smaller loss than a silently
  discarded edit.

## Verification of this final round (all in `frontend/`)

| Command | Result |
| --- | --- |
| `npm test` | `tests 388 / pass 388 / fail 0` |
| `npm run typecheck` | clean - `tsc --noEmit && tsc -p e2e --noEmit` (the e2e project `checkJs`-types the new `.mjs` files too) |
| `npm run lint` | 0 errors; the ONE pre-existing warning only (`src/hooks/use-relation-titles.ts 83:43 react-hooks/exhaustive-deps`, untouched file) |
| `npm run build` | exit 0, 17 routes; run twice - `tsconfig.json` byte-identical both times and `next-env.d.ts` idempotent (`288` bytes, `diff` clean) |
| `npm run test:ui` | **`tests 12 / pass 12 / fail 0`**, real Chromium, 27.9 s (8 browser tests + 4 pure tests of the restore rule) |

Fixture hygiene after a full `test:ui` run, checked by hash rather than by eye:

- `md5sum -c` on `tsconfig.json` and `next-env.d.ts` taken before the run: **both OK**.
- `.next/BUILD_ID` unchanged - the real build output was not touched.
- no `.next-ui-fixture/`, no `tsconfig.ui-fixture.json`, no `tsconfig.ui-fixture.tsbuildinfo` left.
- `QWBE_DIST_DIR` / `QWBE_TSCONFIG` appear only in `next.config.ts` and the fixture, and are passed
  in the spawned child's `env` object - never exported into this shell or any other process.
  `next start` deliberately gets `QWBE_DIST_DIR` only, since it configures no TypeScript.
- the fixture server bound an ephemeral port; `4500`/`4510`/`4520` are refused by `forbidden()`. The
  live stack's own listeners on those ports (`qwbe/core`, `qwbe/web`, and a CRM `next dev` on 4520)
  belong to another worker and were verified to be foreign (no `QWBE_DIST_DIR` in their environ) and
  still healthy afterwards (`4520 /login -> 200`).

### Negative control for finding A

`use-group-members.ts` was reverted in place to the guard-first form (a byte copy taken first) and
`npm run test:ui` re-run:

```
tests 8 / pass 6 / fail 2
x keeps the group list right after a rename that lands once its section was replaced, without announcing it
x drops a group a late 404 says is gone, even when the section that asked is already replaced
```

The other six stayed green, so the two new tests bite exactly this defect and nothing else. The
source was restored from the byte copy and the full suite re-run green.

### New tests added this round

| Test | What it pins |
| --- | --- |
| `access-groups.test.mjs` - rename that lands after its section was replaced | a 2.5 s-late successful `PATCH`, group switched meanwhile: **no** "Renamed group to" toast, and the group select now offers `Org owners` and no longer `Org admins` - the list refresh happened even though the sentence did not. The operator's own switch is still the selection. |
| `access-groups.test.mjs` - late `404` about the group | a 2.5 s-late `404 group g-org-1 does not exist` with the group really deleted, group switched meanwhile: no refusal text on screen, and the group is off the select. |
| `fixture.test.mjs` (new file, no browser) - four cases of the restore rule | restores when only the generated `DIST_DIR` type imports moved; writes nothing when the build changed nothing; **leaves a concurrent edit alone and warns** instead of overwriting; and refuses to claim a generated import rewritten to some *other* directory. |

## Dependency: `playwright` pinned exactly, installed offline

```
cd frontend
npm i -D --save-exact --offline --no-audit --no-fund playwright@1.63.0
```

- `frontend/package.json`: one line added, `"playwright": "1.63.0"` (exact, no range).
- `frontend/package-lock.json` diff is **exactly three additions and nothing else**: the
  `devDependencies` entry, `node_modules/playwright` and `node_modules/playwright-core`, both
  `1.63.0`, `"dev": true`, with their registry `integrity` hashes. No other package, version or
  resolved URL changed - checked by `diff` of the whole lock against a copy taken first.
- Reproducible offline: both tarballs are already in `~/.npm/_cacache/content-v2/sha512`, located by
  their lock integrity hashes (`playwright` 899 597 bytes, `playwright-core` 3 123 044 bytes), so
  `npm ci --offline` needs no network for them. The published `playwright` tarball has no install
  script, so nothing tried to download a browser.
- `frontend` is **not** a workspace of the CRM root, so the root `package.json` /
  `package-lock.json` were untouched by this install (confirmed: still only the other worker's
  changes).
- Browsers: `playwright-core@1.63.0`'s `browsers.json` wants `chromium-1243`,
  `chromium-headless-shell-1243`, `firefox-1543`, `webkit-2359`, `ffmpeg-1011`. The fixture uses
  `chromium` only, and `~/.cache/ms-playwright` already has `chromium-1243`,
  `chromium_headless_shell-1243` and `ffmpeg-1011`. **Firefox and WebKit are absent**, so a bare
  `npx playwright install` (all browsers) would need the network; `npx playwright install chromium`
  is already satisfied and the suite needs nothing more.

## Files touched in this final round

- `frontend/src/hooks/use-group-members.ts` - the unmount guard moved to the return of all three
  writes; `settle` splits parent refresh from this section's refetch; doc comment states the rule.
- `frontend/e2e/ui/fixture.mjs` - `QWBE_TSCONFIG` throwaway copy instead of restoring
  `tsconfig.json`; `restoreGeneratedTypeDeclarations` (exported for its test) for `next-env.d.ts`;
  `next start` gets its own env; the Playwright-is-undeclared message replaced.
- `frontend/e2e/ui/access-groups.test.mjs` - two tests for finding A, plus the header's list of what
  the fixture pins.
- `frontend/e2e/ui/fixture.test.mjs` - **new**, four cases for the restore rule.
- `frontend/next.config.ts` - fixture-only `QWBE_TSCONFIG` → `typescript.tsconfigPath`.
- `frontend/.gitignore` - `/tsconfig.ui-fixture.json`.
- `frontend/package.json`, `frontend/package-lock.json` - `playwright@1.63.0` devDependency.

## Fix round 3 - the two LOWs of the PASS review

Both were fixture robustness, not product behaviour; the verdict of the round before was already
PASS. Nothing in `src/` was touched.

### LOW 1 - `next-env.d.ts` did not exist yet

`readFileSync(nextEnvPath)` ran before the build, outside the `try`, with no existence check. The
file is generated and **gitignored**, so on a fresh clone (or after `rm -rf`) `npm run test:ui` died
with a bare `ENOENT` before the build even started.

- `fixture.mjs`: the snapshot is now `existsSync(path) ? readFileSync(path) : null` - `existsSync`
  rather than a caught `ENOENT`, so a real read failure is still a failure.
- `null` means *this build created the file*, so the `finally` **removes** it again through a new
  `discardGeneratedTypeDeclarations(path)` instead of restoring bytes that never existed: leaving it
  behind would plant a `next-env.d.ts` whose type imports name `.next-ui-fixture`, a directory the
  fixture deletes on the way out.
- The removal is as conditional as the restore: the file goes **only** when every generated import in
  it names `DIST_DIR` **and** every other line is one Next's generator writes (blank, a
  `/// <reference types="next..." />`, or its two-line "should not be edited" notice - `generatedBoilerplate`).
  A concurrent edit of any other shape - somebody else's `/// <reference types="my-own" />`, a
  hand-written `declare module`, a generated import naming another build directory - keeps the file
  and prints why. **No concurrent edit is ever deleted, and no file is deleted that this build did
  not write.** A build that failed before writing anything is a silent no-op.
- The real `next-env.d.ts` of `next@16.3.3` on this tree is exactly that shape (2 references, 2
  imports, blank, 2 comment lines), so the normal fresh-clone run cleans up silently.
- `fixture.test.mjs` grew from four cases to **nine**: the four restore cases are unchanged, plus
  five for the removal - removes what only this build wrote; no-op when the build wrote nothing;
  keeps a file whose imports name another directory; keeps an added reference line; keeps a
  hand-written declaration. Each of the last three also asserts the warning.

### LOW 2 - `waitForTimeout(4000)` over a `delayMs: 2500` answer

A 1.5 s margin on a loaded machine could have asserted silence on a screen whose answer was still in
flight - a pass for the wrong reason. Both late-answer tests now synchronize on the **answers and the
state they produce**, and sleep for nothing:

- a small helper, `answered(page, method, path)`, wraps `page.waitForResponse` on the mocked path,
  and is registered **before** the click, so a fast answer cannot be missed.
- the rename test awaits its `PATCH /permissions/groups/g-org-1` **and** the
  `GET /permissions/groups` that `onChanged` asks for, then waits for the select to offer
  `Org owners` and for `Org admins` to be **detached**.
- the late-404 test awaits its `POST .../members` and the same list re-read, then waits for
  `Org admins` to be detached from the select.
- the negative assertions (no `Renamed group to`, no `does not exist`) now run **after** those state
  waits, not before: reaching a refreshed list proves the panel rendered after the write resolved,
  which is what makes the silence evidence instead of a coincidence. The old order also read the body
  at exactly the 4 s mark, where a sonner toast may already have expired - so it could have missed a
  toast that really was shown.
- The remaining `waitForTimeout(4000)` in test 5 (answer after a whole-panel scope switch) was
  **not** in this scope and is untouched; it has the same shape of margin.

Both tests dropped from ~6.5 s to ~3.2 s as a side effect.

### Verification of this round

| Check | Result |
| --- | --- |
| `node --test e2e/ui/fixture.test.mjs` | `tests 9 / pass 9 / fail 0` |
| `npm run test:ui` (whole suite: 8 browser + 9 file-rule) | `tests 17 / suites 3 / pass 17 / fail 0`, 24.5 s |
| `npx tsc -p e2e --noEmit` | exit 0 |
| `npx eslint e2e/ui/fixture.mjs e2e/ui/fixture.test.mjs e2e/ui/access-groups.test.mjs` | exit 0 |
| `md5sum -c` on `tsconfig.json` + `next-env.d.ts`, taken before the run | both **OK** |
| leftovers | no `.next-ui-fixture/`, no `tsconfig.ui-fixture.json`, no `tsconfig.ui-fixture.tsbuildinfo` |
| the live `.next` | mtime unchanged (12:40, before the run): the fixture built into `QWBE_DIST_DIR` only, and `npm run build` was never run bare |

`npx tsc -p e2e` writes `frontend/e2e/tsconfig.tsbuildinfo` (`incremental` is inherited from the root
config); it is covered by the existing `*.tsbuildinfo` ignore, like the root one.

### Files touched in fix round 3

- `frontend/e2e/ui/fixture.mjs` - `existsSync` snapshot, `discardGeneratedTypeDeclarations`,
  `generatedBoilerplate`, header/doc comments.
- `frontend/e2e/ui/fixture.test.mjs` - five new cases for the removal rule; `temp()` accepts no
  content; `quietly()` shared by both helpers.
- `frontend/e2e/ui/access-groups.test.mjs` - the `answered()` helper; two tests re-synchronized.
- `frontend/docs/t1452-access-groups-report.md` - this section.

## What is still NOT verified after this round

- `npm run e2e` / `scenarioGroups` still **not run** (it copies the kernel, starts real servers and
  needs the Orca CLI, and the `qwbe` backend is being changed by another worker in the same window).
  Reviewed and type-checked only.
- No live CRM stack was driven: the browser evidence is the fixture's mocked world. The live check on
  the installed instance remains outstanding.
- `npm ci --offline` was **not executed** (it would delete and rebuild an 810 MB `node_modules`
  shared with a running dev server); its reproducibility is evidenced by the cached tarballs above,
  not by a run.
- Firefox/WebKit Playwright browsers are absent; only the Chromium path is proven.
- The fresh-clone path of fix round 3 (no `next-env.d.ts` before the build) was proven by the five
  unit cases of the rule, **not** by a real build with the file moved away: removing that file while a
  foreign `next dev` on 4520 is running belongs to nobody in this scope.
- The reviewer's baseline items are unchanged and out of scope: `useEffect` fetching in
  `use-permission-groups.ts` / `use-group-members.ts` (pre-existing code, relocated), the second
  parser over `/settings/cubes`, and `requireCubeAccess` not checking `enabled` (backend, other
  owner).
