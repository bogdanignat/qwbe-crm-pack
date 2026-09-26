# T-1452 Step B4 — the invocation gate and the reproducible SDK check

Date: 2026-09-26 (revised the same day after review — see "Review resolutions" at the end).
Scope: this pack's root SDK-check tooling only (`test/sdk-check.mjs`, `test/sdk-check-lib.mjs`,
`test/sdk-check-lib.test.mjs`, two `package.json` script entries, this document) plus one narrow
kernel change in `qwbe` (B1 payload support, see `qwbe/docs/t1452-probes-report.md`). No cube,
frontend, kernel-refactor or existing-probe edit. Nothing published, nothing installed, nothing
restarted.

The runner lives under `test/` and not `tools/`: `test/` is a top-level entry that BOTH staging
filters drop, so a script that spawns npm and `child_process` cannot become content of the
installed plugin. `tools/` is package content and would have shipped it.

**Verdict: the sandbox check is NOT green. It fails at stage 3 (runtime) on four
PRE-EXISTING pack probes, none of which is in this step's scope.** Stages 1 and 2 pass, a kernel
boots against a throwaway Postgres, and the generic probes run. Stage 4 (invocation) is never
reached, so the publication shape is staged and proved by unit test but not yet proved by the gate
itself. This is not a release-ready claim and not a partial pass being accepted: the runner
exits 1.

**Which kernel booted, exactly.** Not an installed one. The runner spawns
`<qwbe>/core/bin/qwbe.mjs`, which is outside `node_modules`, so `bin/qwbe.mjs:15` computes
`installed = false`, loads the checker from `src/check-package.ts`, and `check-package.ts:94-101`
boots `src/main.ts` — the same TypeScript source `npm run api` runs, with no `--conditions=qwbe-dist`.
So what stage 3 proves is that the pack mounts and boots under the kernel's SOURCE runtime. The
installed-SDK shape (`node_modules/qwbe-core` as a real directory in the sandbox) is STAGED and is
what stage 4 would judge — and stage 4 is never reached, so that shape was never exercised in this
run. Any earlier wording in this document claiming "the installed kernel booted" was wrong and is
corrected here.

**Where the checker's scratch mount goes.** Also not /tmp. `check-package.ts:181` is
`mkdtemp(join(installed ? tmpdir() : kernelRoot(), ".qwbe-check-"))`, and `installed` is false, so
every run creates `<qwbe>/core/.qwbe-check-*` — inside the qwbe SOURCE checkout, which is not a
temp directory. `check-package.ts:374` removes it in a `finally`, so a clean exit leaves nothing;
a kill at the runner's 300 s timeout does not, and the leftover sits in the other worker's
checkout. This is the runner's fourth side effect and is now declared in `test/sdk-check.mjs`.

## Exact commands

```
# prerequisite (the runner does this itself when dist/ is absent)
cd /home/bogdan/projects/qwbe/core && npm run build

# the runner's own unit tests
cd /home/bogdan/projects/qwbe-plugins/crm-pack && npm run test:sdk-check-unit
#   -> 20 tests, 20 pass, 0 fail  (11 before the review fixes)

# the full check, both invocations
set -a && . /home/bogdan/projects/qwbe/.env && set +a
cd /home/bogdan/projects/qwbe-plugins/crm-pack && npm run test:check
#   -> exit 1  (native FAIL expected, sandbox FAIL at stage runtime)
```

`npm run test:check` is the only entry added to the native `package.json` besides
`test:sdk-check-unit`. Both now point at `test/`. `npm test` and
`dependencies.qwbe-core: file:../../qwbe/core` are UNCHANGED — the developer loop is what the gate
refuses, so it may not be edited to please it, and `git diff package.json` shows exactly those two
script lines and nothing else.

## What the two invocations are for

| invocation | command | expected | observed |
| --- | --- | --- | --- |
| `[native]` | `node <qwbe>/core/bin/qwbe.mjs check <pack checkout>` | FAIL — the checkout is not a publication shape | FAIL, exit 1, stage runtime |
| `[sandbox]` | the same bin against a publication-shaped copy in `/tmp/qwbe-crm-sdk-check-*` | PASS, 4/4 stages | FAIL, exit 1, stage runtime |

The native invocation's expected failure is stage **invocation** (`scripts.test` is a
`node --test` line and `qwbe-core` is a `file:` specifier). It never gets there: stage runtime
comes first and fails on the same four probes as the sandbox. So the native gate's strictness is
still ASSERTED only by the kernel's own `probes/check-command.mjs` unit fixtures, not by this
run. Recorded as an outstanding gate below, not as a pass.

## Stage results, both invocations

| stage | native | sandbox |
| --- | --- | --- |
| `[1/4] source` | pass | pass |
| `[2/4] caps` | pass | pass |
| `[3/4] runtime` | **FAIL** — 4 probes exit 1 | **FAIL** — 4 probes exit 1 |
| `[4/4] invocation` | not reached | not reached |

Inside stage 3 the parts that DID work, in both invocations:

- a kernel booted with this pack mounted, on its own `qwbe_check_<hex>` database — the CHECKOUT's
  `src/main.ts`, not an install; see the verdict section;
- the kernel's generic probes ran and reported
  `generic probes: crm publishes no metadata -- route, searchable and required families do not
  apply` for the parent cube (the child cubes publish metadata and were probed silently);
- `probes/crm.mjs` reached **27 pass, 6 fail** — but see the reclassification below: it was NOT
  running against the kernel the checker booted.

## The four blockers, each with its exact reason

1. **`probes/crm.mjs` — 27 pass, 6 fail.** Every failure is a list/filter or reader-visibility
   expectation, identical in both invocations:
   - `reader lists contacts — http=200 total=0`
   - `company stays free text on the contact (no organization entity folded in) — http=403`
   - `reader lists contracts — http=200`
   - `organizations list pages and sorts — http=200 sortedBy=name`
   - `filtering organizations by name returns exactly the matching one — http=200 total=0`
   - `an organization's contacts are derived by filtering on organizationId — http=200 total=0`

   Authentication, permissions, 404s, creates, schema-edge 400s and the cube-independence
   checks all pass.

   **UNCLASSIFIED — these six failures are NOT demonstrated to be about the package under
   judgment, and the earlier label "pack-behaviour-versus-kernel" is withdrawn.** `probes/crm.mjs`
   is a CHECKOUT probe. It never reads `QWBE_URL` and never talks to the kernel the checker
   booted: `probes/crm.mjs:24-42` imports `$QWBE_REPO/probes/lib.mjs` and calls its own
   `startServer`, which (`qwbe/probes/lib.mjs:135-143`) spawns `src/main.ts` with
   `cwd = <qwbe>/core` and sets only `QWBE_PORT`, `QWBE_DATA_DIR` and `QWBE_LEGACY_MIGRATIONS` —
   so `QWBE_STORE_DIR` and `QWBE_PLUGINS_DIR` fall back to that checkout's own
   `core/store` and `core/plugins`. What those 27/6 numbers describe is therefore the copy
   installed at `<qwbe>/core/plugins/crm-pack` (older than this working tree) mounted on whatever
   kernel branch the qwbe checkout is sitting on (`fix/group-domain-separation`, another worker's
   uncommitted work) — not the sandbox, and not the staged publication shape. `probes/crm-sharing.mjs:19-34`
   does the same thing. It also explains the one result that looked like corroboration: native and
   sandbox produced IDENTICAL failures because both were measuring the same external copy.

   So the honest statement is: unclassified. It may be a real reader/list defect, it may be
   staleness of the installed copy, it may be the other worker's kernel branch. Nothing in this run
   separates the three, and no claim of a pack regression is made from it. It stays an owner
   decision. Deciding it needs the probe migration described below (a probe that reads `QWBE_URL`),
   not a rerun of this one.

2. **`probes/crm-sharing.mjs` — cannot pass in a publication sandbox, structurally.**
   - native: `TypeError: sharing.searchUsers is not a function` at `probes/crm-sharing.mjs:123`
     — the dirty T-1450 work in `frontend/src/lib/sharing.ts` no longer exports that name.
   - sandbox: `Cannot find module '/tmp/qwbe-crm-sdk-check-*/frontend/src/lib/sharing.ts'` —
     the probe imports the pack's FRONTEND source, and `frontend/` is authoring tooling that
     both this runner's copy filter and the kernel's own staging filter
     (`core/src/package-source.ts`, `LOCAL_SOURCE_DIRECTORIES`) strip from a package. A probe
     that imports `frontend/` can never run inside the shape `qwbe check` judges.

3. **`probes/qwb31-install-lifecycle.mjs` — `refused: CRM source not found at
   /home/bogdan/Projects/qwbe-packs/plugins/crm-pack`.** A hard-coded legacy path from before
   this checkout moved to `~/projects/qwbe-plugins/crm-pack`.

   **Safety note, and the reason the runner no longer forwards `QWBE_REPO`.** Past its early
   refusal this probe calls `rmSync` on `$QWBE_REPO/core/plugins/crm-pack`
   (`probes/qwb31-install-lifecycle.mjs:316-319`) — the LIVE mounted copy in the kernel checkout,
   which is gitignored, so a deletion would leave no trace in git. Today only the stale path at
   `:47` (exiting at `:51`) stands between the probe and that call. Whoever fixes the path must
   read this paragraph first: with `QWBE_REPO` forwarded, `npm run test:check` would have armed
   that deletion against another worker's checkout. The forward is gone (see the environment
   section) and there is a unit test pinning its absence.

4. **`probes/source-drift.mjs` — 2 RED.**
   - `store/crm-pack  the source changed after staging - the copy is behind its source`
   - `plugins/crm-pack  behind the repo - reinstall from this directory`

   Both are TRUE and both are correct probe behaviour: the working tree is dirty and the
   installed copies are older. Clearing them needs an `install-from` plus a restart of the live
   instance, which this step is explicitly forbidden to do.

Blockers 2, 3 and 4 are properties of the existing probes, and blocker 1 of existing cube
behaviour. All four are outside "CRM root SDK sandbox tooling", so none was touched. **Decision
needed from the owner:** whether the pack's probes get a `qwbe check`-contract probe (reading
`QWBE_URL`, importing nothing under `frontend/`) with the four checkout probes moved out of
`probes/` into a directory `qwbe check` does not run — that is the only route to a 4/4 sandbox
pass, and it is a change to existing pack files.

## What the runner does, and every side effect it has

`test/sdk-check.mjs`, with its decisions factored into `test/sdk-check-lib.mjs` so they can be
unit-tested without a kernel or a database.

1. **`core/dist` first.** An installed kernel boots from `dist/` (node refuses type stripping
   under `node_modules`) and the mounted pack resolves `qwbe-core/*` through the `qwbe-dist`
   export condition. The runner builds it when `core/dist/cube-contract.js` is absent and says
   which of the two happened.

   In THIS run `dist/` is needed only for the stage-4 fixture (`installKernel` copies it into the
   sandbox's `node_modules/qwbe-core`), because the checker that actually ran is the checkout's and
   boots `src/main.ts`. Note the side effect: the build compiles whatever state the qwbe checkout
   is in, uncommitted work included — and on this machine that checkout belongs to another worker.
2. **The installed-SDK fixture, reused from `qwbe/probes/check-command.mjs` — STAGED, not yet
   exercised.** `node_modules/qwbe-core` in the sandbox is a REAL DIRECTORY holding exactly the
   kernel package.json's `files` list (`bin`, `src`, `dist`, `package.json`, `qwbe.config.json`),
   with a symlink to the kernel's own `node_modules` for its runtime dependencies. The package
   itself is never a symlink — that is the `npm link` shape stage invocation exists to refuse.

   What this fixture is FOR is stage 4, and stage 4 was never reached. The checker that actually
   ran was invoked as `<qwbe>/core/bin/qwbe.mjs`, a CHECKOUT, so the kernel that booted the pack in
   stage 3 was `src/main.ts` from the checkout and not this directory. The fixture's correctness is
   asserted by the kernel's own `probes/check-command.mjs` unit fixtures, not by this run.
3. **The copy.** `cpSync` with a filter that drops every foreign TOP-LEVEL entry: `node_modules`,
   `frontend`, `docs`, `test`, `package-lock.json`, `dist`, `build`, `coverage`, anything dotted
   (`.git`, `.playwright-mcp`, `.t1450-baseline`, `.local`, `.githooks`) and any
   `*.png/jpg/zip/log/...`. Nested paths are NOT filtered, so real package content named
   `docs/` or `*.png` below the root still ships.

   `test` is on that list, and that is why the runner lives there. Under `tools/` it was PACKAGE
   CONTENT: `tools/` is kept by this filter and by the kernel's own staging filter
   (`core/src/package-source.ts:14`, `LOCAL_SOURCE_DIRECTORIES`), so the next `install-from` would
   have copied a script that spawns `npm` and imports `node:child_process` into the installed
   plugin. Measured before the move: `npm --prefix core run boundaries` reports 13 errors, ALL of
   them from `core/plugins/crm-pack/tools/*` — exactly that class, for the pack's pre-existing
   tools. Those 13 are pre-existing and still there; the point is that the runner does not join
   them. Checked: `core/plugins/crm-pack/tools/` contains no `sdk-check*` file, because no
   reinstall happened during this step. Two unit tests hold the move in place — one on this
   filter, one reading `LOCAL_SOURCE_DIRECTORIES` out of the kernel source rather than assuming
   it.
4. **The publication `package.json`, written in the SANDBOX only.** `scripts` reduced to the one
   canonical entry `qwbe check .`; `dependencies.qwbe-core` set to the REAL SDK version read from
   `<qwbe>/core/package.json` (`0.0.0`); `devDependencies` dropped. It THROWS rather than stages
   if any `dependencies`/`peerDependencies`/`optionalDependencies` entry still starts with
   `file:`, `link:`, `workspace:` or `portal:`, or if the kernel declares no version. The
   checkout's own `package.json` is read and never written.
5. **The database, and the whole environment the child is given.** The CHECKER creates and drops
   `qwbe_check_<hex>` itself (`core/src/check-package.ts`, `runtimeStage`); the runner only
   supplies admin coordinates. Verified against this machine: Postgres **16.14** in
   `qwbe-postgres-1` on **port 5434** (`QWBE_PG_PORT=5434` in `qwbe/.env`; 5433 is permanently
   taken by ltraceDB). There is NO password default — an unset password is a refusal.

   The environment is now a **WHITELIST, not a filter**, and it is the same for BOTH invocations.
   `checkEnv` drops every inherited `QWBE_*` variable and writes back exactly five, which is the
   whole list (`CHECK_ENV_KEYS`):

   ```
   QWBE_PG_HOST  QWBE_PG_PORT  QWBE_PG_USER  QWBE_PG_PASSWORD  QWBE_LEGACY_MIGRATIONS
   ```

   Non-`QWBE_` variables pass through untouched — the spawned node still needs `PATH` and `HOME`.
   Host, port and user are taken from `QWBE_DATABASE_URL` only when the explicit `QWBE_PG_*`
   spelling is absent, never its database name. The reason it is a whitelist and not the previous
   blacklist: a blacklist covers only the names it was written with, so a variable invented later —
   another path, another operator capability — would be forwarded by default. Three unit tests pin
   this: the exact five-key set, that a parent-exported `QWBE_REPO` (and three invented names) do
   not reach the child, and that `describeEnv` prints the whole set so a widening shows up in the
   run log as well as in the diff.

   What is therefore NOT forwarded: `QWBE_DATABASE_URL` (in this checkout it names the LIVE `qwbe`
   database), `QWBE_DATA_DIR`, `QWBE_STORE_DIR`, `QWBE_PLUGINS_DIR`, `QWBE_PORT`, `QWBE_URL`, and
   **`QWBE_REPO`** — see blocker 3 for the `rmSync` this last one would arm. `QWBE_REPO` remains an
   INPUT to the runner itself (it is how the runner finds `core/bin/qwbe.mjs` and builds
   `core/dist`); it stops at the runner.

6. **`QWBE_LEGACY_MIGRATIONS`, written out as a literal.** Without it the kernel refuses to
   boot this pack on ANY fresh database:

   ```
   Data migration refused by the ownership rules: "crm/contacts" declares contacts -> crm/contacts,
   but the ledger has no record of "contacts". Pre-ledger history is migrated only with the
   operator's explicit authorization: QWBE_LEGACY_MIGRATIONS="contacts:crm-pack".
   ```

   The kernel is explicit that the package under judgment does not get that vote
   (`core/src/kernel/migrate-ownership.ts`), so the three names are TYPED OUT in
   `sdk-check-lib.mjs` (`contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack`) and never
   read out of the cubes' manifests. On the empty throwaway database it authorizes nothing real.
   A unit test now pins the exact string, so widening it to a fourth name or another plugin is a
   failing test and a visible diff, not a quiet edit.
   **A live install still needs the operator to set this deliberately — that is a remaining
   native gate, not something this runner discharges.**

7. **Dependencies: what was and was NOT proved.** The runner installs nothing. `dependencies` is
   proved only as far as (a) no entry still names a checkout (`file:`/`link:`/`workspace:`/`portal:`
   is a refusal to stage, unit-tested) and (b) `qwbe-core` resolves, through the staged
   install-shaped directory, at the point stage 4 would read it. It is **not** proved as a complete
   dependency closure: the mounted pack resolves `effect` and `@effect/platform` through the
   symlink to `<qwbe>/core/node_modules`, so a version or a package missing from the pack's own
   `dependencies` would still resolve here and would still break a real install. Proving closure
   needs a real `npm install` into the sandbox from a registry or a packed tarball, which this step
   does not do.

8. **Output relay, with credential redaction.** The checker's stdout and stderr are relayed
   verbatim so nothing is summarised away, but through `redactSecrets`: any
   `scheme://user:password@host` collapses to `scheme://user:***@host`, and the password this
   runner derived is substituted wherever it appears. **This is a string filter over the relay, not
   a logging subsystem, and its limits are the gap:** it cannot catch a secret it was not given, and
   it does not substitute secrets shorter than `MIN_REDACTABLE_SECRET` (4) because a one- or
   two-character password matches half the output and redacting it would mangle the report instead
   of protecting anything. Both limits are asserted by unit test so they cannot drift silently. It
   is worth noting there was no observed leak to fix: `pg/db.ts:75-78` does not echo the URL with
   its password. This is a guard, not a repair.

9. **Cleanup, guarded — and only the paths actually audited.** `isOwnSandbox(path)` allows a
   removal only when the resolved path sits under the OS temp directory AND its first segment
   carries the `qwbe-crm-sdk-check-` prefix. Anything else is printed as a refusal and left alone.

   **What the earlier "nothing remains" claim actually covered, and what it did not.** Audited: no
   `/tmp/qwbe-crm-sdk-check-*` directory and no `qwbe_check_*` database remain. NOT audited, and so
   not claimed: the pack's own probes create their own resources through
   `qwbe/probes/lib.mjs:105-113` — a `qwbe_probe_<hex>` database per `startServer` call (`crm.mjs`
   starts three servers) plus a scratch data dir each — and the runner kills the checker at its
   300 s timeout, which leaves those behind. Also not audited: `<qwbe>/core/.qwbe-check-*`, the
   checker's own scratch mount, which lands in the qwbe source checkout (see the verdict section)
   and survives a kill. The 13 `qwbe_ticket05_*` databases on the server are FOREIGN artifacts of
   another worker and were deliberately left untouched.

## Verifications actually run

First run (before review):

| command | result |
| --- | --- |
| `crm-pack$ npm run test:sdk-check-unit` | 11 tests, **11 pass, 0 fail** |
| `crm-pack$ npm test` (with `QWBE_PG_PASSWORD` set) | 124 tests, 26 suites, **124 pass, 0 fail** — the native loop is preserved |
| `crm-pack$ npm run typecheck` | exit 0 |
| `crm-pack$ npm run lint` | 2 errors, both inside `.t1450-baseline/untracked/` — a FOREIGN artifact of another worker, pre-existing, deliberately not touched. `npx eslint test/sdk-check*.mjs` is clean (`.mjs` is eslint-ignored in this pack). |
| `crm-pack$ npm run test:check` | **exit 1** — native FAIL (expected), sandbox FAIL at stage runtime |
| `qwbe$ node --test --experimental-strip-types core/src/check-probes.test.ts` | 59 tests, **59 pass, 0 fail** (B1) |
| `qwbe$ npx tsc --noEmit -p core/tsconfig.json` | exit 0 |
| `qwbe$ npx biome check core/src/openapi-payload.ts core/src/check-probes.test.ts` | clean |
| `qwbe$ node probes/check-command.mjs` (PG env set, `QWBE_DATABASE_URL` unset) | **10 pass, 0 fail** |

Second run (after the review fixes below). Deliberately narrow: no `qwbe check` run and no pack
probe run, because the four blockers still need an owner decision and rerunning them would spend
another kernel boot to reproduce a known answer.

| command | result |
| --- | --- |
| `crm-pack$ npm run test:sdk-check-unit` | 20 tests, 5 suites, **20 pass, 0 fail** (was 11) |
| `crm-pack$ node --check test/sdk-check.mjs test/sdk-check-lib.mjs` | exit 0 |
| `crm-pack$ npm run lint` | **exit 1, the same 2 pre-existing errors**, both parsing errors inside `.t1450-baseline/untracked/` — another worker's FOREIGN artifact, deliberately untouched. Nothing from `test/`: `npx eslint test/` exits 2 with "all matched files are ignored", because this pack's config ignores `**/*.mjs`, so no ESLint rule covers the runner in either location |
| `crm-pack$ npm run typecheck` | exit 0 |
| `crm-pack$ diff` of `package.json` against its pre-edit copy | exactly two lines: `test:check` and `test:sdk-check-unit` retargeted to `test/`. `test`, `dependencies`, `devDependencies` byte-identical. (`git diff package.json` shows MORE than that, because the working tree already carried another worker's additions to `scripts.test` before this step started — those are not this step's) |
| `qwbe$ node --test --experimental-strip-types core/src/check-probes.test.ts` | 62 tests, 7 suites, **62 pass, 0 fail** (was 59; +3 DELETE cases) |
| `qwbe$ npx tsc --noEmit -p core/tsconfig.json` | exit 0 |
| `qwbe$ npx biome check core/src/check-probes.ts core/src/check-probes.test.ts` | clean |
| `qwbe$ git diff --stat` | 20 files. Only `core/src/check-probes.ts` and `core/src/check-probes.test.ts` are B1's; the other 18 (`pg/*`, `web/*`, `cubes/permissions/groups.ts`, `.dependency-cruiser.cjs`, `probes/size-lib.mjs`, ...) are other workers' uncommitted work in a shared checkout and were not touched |
| `qwbe$ npm run ascii` | exit 1, and **none of it from B1**: the flagged lines are in `web/next.config.mjs` and `web/tsconfig.json`, pre-existing, another worker's. `check-probes.ts` / `check-probes.test.ts` / `openapi-payload.ts` are clean |
| `qwbe$ node probes/sizecaps.mjs` | exit 0, **no NEW violation** (kernel unit 90258 code / 27 files, cap 100000/30; `check-probes.ts` 17258 code, cap 50000) |
| `qwbe$ ls core/plugins/crm-pack/tools/sdk-check*` | no such file — the runner never reached the installed copy |

NOT rerun, on purpose: `npm run test:check`, `npm test`, `probes/check-command.mjs`,
and every pack probe. The first-run numbers above stand as recorded for those; they are not
re-asserted for the current tree.

The last line is the one that matters for the gate: the kernel's own fixture package still passes
**all four stages** (`[1/4] source: ok`, `[2/4] caps: ok`, `[3/4] runtime: kernel booted ...`,
`[4/4] invocation: ok`) and every refusal still fires — a non-canonical `scripts.test`, a `file:`
dependency, an `npm link` symlink, a failing probe. **The strict invocation gate was not
relaxed.** Note that this probe needs `QWBE_PG_PORT=5434` / `QWBE_PG_PASSWORD` from `qwbe/.env`
and needs `QWBE_DATABASE_URL` UNSET; without them all six boot-dependent checks report exit 2,
which is an environment artefact and not a kernel defect.

## Remaining native gates (none of them discharged here)

- `npm test` (pack root), `npm run typecheck`, `npm run lint` — the native loop, unchanged.
- The frontend suites and the live browser check — a different worker, still outstanding.
- Stage 4 (invocation) of `qwbe check` — never reached in either invocation.
- The four stage-3 blockers above, and the owner decision they need.
- An `install-from` plus restart for the two `source-drift` REDs — deliberately not done.
- A real dependency-closure proof (`npm install` from a tarball into the sandbox) — never attempted.

## Review resolutions (2026-09-26, Opus review of B1 + B4)

Eight findings. Verdict on the implementation was REVISE; acceptance was BLOCKED and **stays
BLOCKED** — see the next section. One finding per row, with what was actually done.

| # | finding | severity | resolution |
| --- | --- | --- | --- |
| 1 | `QWBE_REPO` forwarded to the checker armed the `rmSync($QWBE_REPO/core/plugins/crm-pack)` in `probes/qwb31-install-lifecycle.mjs:316-319` | MEDIUM-HIGH, safety | **FIXED, and further than asked.** The forward is removed from the env used by BOTH invocations. `checkEnv` is now a whitelist: every inherited `QWBE_*` is scrubbed and exactly `CHECK_ENV_KEYS` (5 names) is written back, so a variable invented later is dropped by rule rather than by having been listed. Three unit tests: the exact key set, a parent-exported `QWBE_REPO` plus three invented names not reaching the child, and `describeEnv` printing the whole set. `QWBE_REPO` remains an input to the RUNNER (kernel bin, `core/dist`) only |
| 2 | the four probes never judge the package under judgment; the "pack-behaviour-versus-kernel" label is not demonstrated | MEDIUM, integrity | **FIXED in the document.** Blocker 1 is relabelled **UNCLASSIFIED**, with the mechanism spelled out (`probes/crm.mjs:24-42` + `qwbe/probes/lib.mjs:135-143`: own kernel, `cwd=<qwbe>/core`, default store/plugins) and with the native/sandbox identity explained as both measuring the same external copy. No pack-regression claim is made from those six failures |
| 3 | no INSTALLED kernel ever ran; the scratch mount lands in the qwbe checkout, not /tmp | MEDIUM, report honesty | **FIXED.** The verdict section now states which kernel booted (`bin/qwbe.mjs:15` → `installed=false` → `src/main.ts`, no `--conditions=qwbe-dist`) and where the scratch mount goes (`check-package.ts:181`, removed at `:374` on a clean exit only). The installed-SDK fixture is described as staged-for-stage-4 and never exercised. The runner's side-effect list gained the fourth effect |
| 4 | `dependencies` proved only as a specifier, never as a closure | MINOR-MEDIUM | **FIXED.** New item 7 states exactly what is and is not proved, and names the reason: the mounted pack resolves `effect` / `@effect/platform` through the symlink to `<qwbe>/core/node_modules` |
| 5 | `tools/sdk-check*.mjs` becomes package content; `boundaries` already reports 13 errors of that class from `tools/*` | MINOR-MEDIUM, published surface | **FIXED by moving, not by noting.** The three files are now `test/sdk-check.mjs`, `test/sdk-check-lib.mjs`, `test/sdk-check-lib.test.mjs`. `test` is dropped by this runner's filter AND by `core/src/package-source.ts:14`. `package.json` retargeted (two lines; `test` and `dependencies` untouched). Two unit tests pin it, the second by reading `LOCAL_SOURCE_DIRECTORIES` out of the kernel source instead of assuming it. The 13 pre-existing `boundaries` errors are NOT fixed — they belong to the pack's other tools and to another decision |
| 6 | neither `LEGACY_MIGRATIONS` nor the `QWBE_REPO` forward was pinned by a test | MINOR, tests | **FIXED.** The exact string is asserted, plus its shape (three entries, `crm-pack` the only plugin named) and that it is a literal. The forward's absence is asserted as part of finding 1's tests. Unit suite 11 → 20 tests |
| 7 | the cleanup claim covered only `/tmp/qwbe-crm-sdk-check-*` and `qwbe_check_*` | MINOR, cleanliness | **FIXED in the document.** Item 9 now separates audited from not-audited and names what is left behind: `qwbe_probe_<hex>` databases and data dirs from `qwbe/probes/lib.mjs:105-113` (`crm.mjs` starts three servers), and `<qwbe>/core/.qwbe-check-*`, all of which survive the 300 s kill. No sweep was performed — the leftovers are not this step's to delete |
| 8 | `check-probes.ts:331` builds a body only for POST/PUT/PATCH; Effect allows a DELETE payload | MINOR, B1 gap | **FIXED.** `"DELETE"` added to the method list. A DELETE with no `requestBody` yields `{ kind: "none" }` (`openapi-payload.ts:607`), so bodyless DELETE routes are probed exactly as before; a DELETE that DOES declare a payload now gets one, so its 403 is really asserted instead of being answered 400 by the decode. The 401 assertion is untouched and still runs without a body. Three integration cases (body honoured → 9 checks and silent; unenforced permission → still caught; spec publishes no `delete` → neutral `route-payload` finding, 401 kept, 8 checks) plus two unit assertions. 59 → 62 tests |

Two things the review asked for that were deliberately NOT done, and why:

- **No rerun of `npm run test:check` or of any pack probe.** The four blockers need an owner
  decision, not another measurement, and a rerun would boot a kernel and create databases to
  reproduce a known answer. It also means the post-fix runner is proved by unit test and static
  check only — stated here rather than implied.
- **No attempt to fix the four blockers.** Out of scope, and three of them are edits to existing
  pack files.

One item was optional and was done because it was cheap: stdout/stderr credential redaction
(item 8 of the side-effect list). Its two limits — secrets it was not given, and secrets shorter
than 4 characters — are gaps, are asserted by test, and are stated above rather than glossed.

## Acceptance: BLOCKED

Unchanged by these fixes, and not weakened by them. `npm run test:check` exits 1 and the reason is
the four pre-existing stage-3 blockers. Nothing was disabled, relaxed or skipped to move that
number, and no partial pass is being offered as a pass.

What stands between here and a 4/4 sandbox run is one owner decision: whether the pack gets a
`qwbe check`-contract probe (reading `QWBE_URL`, importing nothing under `frontend/`) with the four
CHECKOUT probes moved out of `probes/` into a directory `qwbe check` does not run. That is a change
to existing pack files, which this step is not allowed to make. Until it is taken, stage 4 stays
unreached and the publication shape stays proved by unit test rather than by the gate.

## Probe migration (2026-09-26, after the checkpoint)

The owner decision above was taken: the pack gets one `qwbe check`-contract probe and the three
checkout-only scripts leave `probes/`. Every command below ran with `QWBE_PG_*` derived from
`qwbe/.env` and `QWBE_DATABASE_URL` unset (otherwise `qwbe/probes/lib.mjs:126` reuses the live
database instead of creating a scratch one).

### What moved, and why

| before | after | nature | run by |
| --- | --- | --- | --- |
| `probes/crm.mjs` | stays, now two modes | the pack's runtime probe | `qwbe check` (QWBE_URL) and `QWBE_REPO=<qwbe> node probes/crm.mjs` |
| `probes/crm-sharing.mjs` | `frontend/e2e/sharing-adapter-check.mjs` | proof of the frontend adapter `frontend/src/lib/sharing.ts` | `cd frontend && npm run check:sharing` |
| `probes/qwb31-install-lifecycle.mjs` | `test/install-lifecycle.mjs` | operator proof: install-from, four restarts, uninstall | `npm run test:lifecycle` |
| `probes/source-drift.mjs` | `test/source-drift.mjs` | operator proof: checkout copies vs this repo | `npm run test:drift` |

Moves were plain `mv` (no `git mv`, the index of this dirty tree is untouched). `test/` is dropped
by both staging filters (`test/sdk-check-lib.mjs` `FOREIGN_ENTRIES`, `core/src/package-source.ts:14`),
so none of the moved scripts can reach a staged package.

- **`probes/crm.mjs`, check mode** (`QWBE_URL` set): no import from a kernel checkout, no server of
  its own, an inline JSON client and score; passwords from `QWBE_ADMIN_PASSWORD` /
  `QWBE_READER_PASSWORD`. It refuses (exit 2) a `QWBE_URL` that is not `127.0.0.1`/`localhost` or
  that names port 4500/4510/4520. The independence section (three `QWBE_MOUNTED` boots) is skipped
  with a printed line and is not counted as a pass. **Checkout mode** (no `QWBE_URL`) is the old
  behaviour, independence included, and imports only `startServer/stopServer/freePort` from
  `<qwbe>/probes/lib.mjs`. No helper `.mjs` sits in `probes/` (the checker would run it as a probe).
- **Explicit grants.** The six reader-visibility failures were the kernel's entity-level
  permissions doing their job: an unshared GET is 403 and the list counts only visible rows
  (`core/src/entity-enforcement.ts:73-86`, `:102-158`; the reader role does not bypass it,
  `cubes/permissions/foundation.ts:20-34`). The probe now shares each record through
  `POST /permissions/entities/:cube/:entityType/:entityId/grants/user` with
  `{ username: "reader", actions: ["read"] }` before the reader reads it (Ada; contracts c1, c2;
  organizations org and secondOrg; Dan Pop), asserts first that an unshared record is hidden
  (list total 0, GET 403), asserts "reader lists 2 organizations unfiltered" so the name filter
  cannot pass vacuously, and at the end revokes Ada's grant (`DELETE /permissions/grants/:id`)
  and asserts the GET is 403 again. No original assertion was changed.
- **`test/install-lifecycle.mjs`** runs entirely under one `mkdtemp(<tmp>/qwb31-)` root:
  `plugins/`, `store/`, `data/`, `source/crm-pack` (a clean copy made with `copyFilter`, so the
  before/after fingerprint never walks `node_modules` or `.git`), and ONE scratch database shared by
  all four boots (created with `lib.scratchDatabase("qwb31")`, dropped in `finally`, together with
  the root). The old `finally` block that could `rmSync` `<qwbe>/core/plugins/crm-pack` is gone, and
  early refusals now throw instead of `process.exit`, so the cleanup always runs.
- **`frontend/e2e/sharing-adapter-check.mjs`** uses `sharing.searchAccounts` (the adapter no longer
  exports `searchUsers`) and resolves the adapter at `../src/lib/sharing.ts`.

### Declared deviation

`qwbe/docs/t1452-checkpoint.md` ("Remaining gaps") marked moving probes "where `qwbe check` does
not look" as not recommended. It is done anyway for three of the four, on purpose: the lifecycle
check needs kernel restarts and install-from/uninstall, which one booted kernel behind `QWBE_URL`
cannot express; the drift check judges copies installed in a checkout, which the sandbox does not
have; the sharing check proves frontend code that no package ships. The grant/revoke boundary on the
pack's own cubes stays under the gate, in `probes/crm.mjs`. Coverage is not dropped: each moved
script has its own `npm run` entry and was run below.

Two further deviations from the migration plan, found at run time:

- `test/install-lifecycle.mjs` gets `<root>/node_modules` with LINKS (`qwbe-core` -> `<qwbe>/core`,
  plus every top-level entry of `<qwbe>/core/node_modules`). Without them the second boot refused
  with `Cube "crm" failed to load: Cannot find package '@effect/platform' imported from
  /tmp/qwb31-*/plugins/crm-pack/cubes/crm/index.ts`: under `<qwbe>/core/plugins` the pack resolves
  its imports through the checkout, a temp plugins root has nothing to resolve through. Same idea as
  the checker's install sandbox (`check-package.ts` `stageSandbox`). Links only; `rmSync` of the root
  removes the links, not their targets.
- The same script needed two fixes that the old stale path had hidden: the OpenAPI spec is behind
  authentication, so its three `/openapi.json` calls now send the admin token (without it the first
  one threw `(intermediate value) is not iterable`), and its E2E step shares the contact and the
  contract with the reader (the same explicit grants as above, asserted 200) before the reader reads
  them back. The E2E assertion itself is unchanged.

The full `QWBE_LEGACY_MIGRATIONS` list (including `bookmarks/tags:example-plugin`) was accepted on
the scratch plugins root; nothing had to be trimmed. `install-from` accepted the `copyFilter` copy.

### Results

- Before the grants (transport migrated, assertions untouched), `npm run test:check`:
  `probes/crm.mjs` **24 pass, 6 fail** in both invocations, the same six as blocker 1 but now on
  the pack the CHECKER mounted: `reader lists contacts — http=200 total=0`;
  `company stays free text … — http=403`; `reader lists contracts — http=200`;
  `organizations list pages and sorts — http=200 sortedBy=name`;
  `filtering organizations by name … — http=200 total=0`;
  `an organization's contacts … — http=200 total=0`. Blocker 1 is therefore classified: entity
  permissions, not a pack defect, not staleness. Native failed at stage runtime, sandbox exit 1.
- After the grants and the moves, `npm run test:check`: `probes/crm.mjs` **40 pass, 0 fail** (39 before the diff review added the Maria Radu grant) in both
  invocations; `[native]` **FAIL at stage invocation** (expected: `scripts.test` is not
  `qwbe check .`, `qwbe-core` is `file:`, and resolves outside the package's `node_modules`);
  `[sandbox]` `source ok, caps ok, runtime ok (generic probes: 48 checks, 0 findings; probes:
  crm.mjs exit 0), invocation ok` — `sdk-check: native FAIL (expected), sandbox PASS (4/4 stages)`,
  exit 0. "4/4" counts STAGES; stage 3 now runs exactly one pack probe.
- `QWBE_REPO=<qwbe> node probes/crm.mjs` (checkout mode): **43 pass, 0 fail** (42 before the diff review; also passes with an invalid QWBE_DATABASE_URL exported, which checkout mode now deletes), independence
  included. It judges the INSTALLED copy `<qwbe>/core/plugins/crm-pack`, not this working tree.
- `npm run test:lifecycle`: **19 pass, 0 fail**, all on scratch.
- `npm run test:drift`: **RED (2)** as expected — `store/crm-pack` "the source changed after
  staging", `plugins/crm-pack` "behind the repo". It stays red until a reinstall in the checkout,
  which is a separate action for the owner to approve.
- `cd frontend && npm run check:sharing`: **28 pass, 0 fail**. It judges the INSTALLED copy.

What this does not change: the remaining native gates listed above (except stage 4, now reached
and passing in the sandbox) and the reinstall for the drift REDs are still outstanding; a sandbox
pass is still not a release-ready claim.
