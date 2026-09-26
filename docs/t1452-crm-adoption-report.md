# T1452 Step B3 — crm/contact-groups adopts the kernel's index lifecycle

Date: 2026-09-26. Scope: this pack only (`cubes/crm/contact-groups`, its tests, the
retained operator tool, `source-contract.test.mjs`). The kernel (Step B2) is already
merged in `qwbe`; the full SDK surface is Step B4 and is NOT part of this work.

## What the cube now declares, and what it stopped doing

`cubes/crm/contact-groups/invariant.ts` holds the invariant itself, typed by the
kernel's public contract (`import type { UniqueIndexSpec } from "qwbe-core/cube"`).
It is a **type-only leaf** -- `import type` and nothing else, so the operator CLI can
read it with no kernel in the process (F3 below); `service.ts` re-exports `CUBE`,
`SCHEMA`, `GROUPS`, `MEMBERS`, `NAME_INDEX`, `PAIR_INDEX` and `UNIQUE_INDEXES` for
the cube's own use, so there is still one statement of the invariant:

```ts
export const UNIQUE_INDEXES = [
  { table: GROUPS,  index: NAME_INDEX, keys: [{ body: "name", normalize: "lower-btrim" }], rows: "active" },
  { table: MEMBERS, index: PAIR_INDEX, keys: [{ body: "groupId" }, { body: "contactId" }], rows: "active" },
] as const satisfies ReadonlyArray<UniqueIndexSpec>
```

The manifest carries `uniqueIndexes: UNIQUE_INDEXES`. Both index names, the key
order, the normalization and the single `rows: "active"` predicate are unchanged
from the hand-rolled version — the names are matcher keys a 23505 reports, so a
rename would silently change behaviour.

Removed from the pack, because the kernel now owns each of them:

- `requireIndexes(store)` at every write site, and the `warmTables` call that
  existed only to make that check possible. Readiness is enforced by the store's
  own write gate, on `insert` and on `update` (a soft delete IS an update), i.e.
  on every write this cube performs.
- the handwritten expected index definition and its normalizer in the cube.
- `usesBatch: true`. This is not cosmetic: the raw batch path calls neither
  `ensureTable` nor the write gate, so it would write around the very indexes the
  manifest now declares. The kernel refuses a manifest holding both; the pack's
  side of that contract is pinned by `source-contract.test.mjs`
  (`usesBatch === undefined` plus a string check on the serialized manifest).

Error mapping now goes through the public helper, with no private imports.

> **SUPERSEDED (second round, F6).** The snippet this section originally showed was
> the one-argument mapping, kept here as history:
>
> ```ts
> // historical, no longer the code:
> export const onNameTaken = onUniqueIndex(NAME_INDEX, (message) => new Conflict({ message }))
> ```
>
> `onUniqueIndex`'s `fail` now receives a **second** argument, the structured
> `UniqueIndexRefusal` (`{ reason: "duplicate" | "notReady", index }`), and the pack
> maps through one seam that hands that tag to a recovery. Current shape
> (`cubes/crm/contact-groups/service.ts`):
>
> ```ts
> const onIndexRefusal =
>   (index: string) =>
>   <A2, E2>(recover: (reason: string, refusal: UniqueIndexRefusal) => Effect.Effect<A2, E2, never>) =>
>   /* ... */
> export const onNameTaken = onIndexRefusal(NAME_INDEX)
> export const onPairTaken = onIndexRefusal(PAIR_INDEX)
> ```
>
> The one-argument callback remains assignable, so other cubes are unaffected; see
> "Second round" below.

`onUniqueIndex` matches exactly two conditions for the named index — a 23505 whose
`constraint` equals it, and `UniqueIndexNotReady` for it — and re-dies everything
else. Pinned in `cubes/crm/contact-groups/index.test.ts`: another index's gate,
another constraint's 23505 and a 23503 all stay defects.

Membership keeps its idempotence and gets honest about the other case.

> **SUPERSEDED (second round, F6).** As first written, this read: "`onPairTaken`
> recovers by re-reading the live pair. A live row means a concurrent duplicate ->
> return it (200, same id for both callers). No live row means the index is absent,
> differently defined or invalid -> `Effect.die`." That made the re-read the
> CLASSIFIER. It no longer is. Current behaviour
> (`cubes/crm/contact-groups/index.ts`, the `reread` recovery):
>
> - `refusal.reason === "notReady"` -> `Effect.die(indexNotReady(PAIR_INDEX, ...))`,
>   decided **before** any re-read, so a live pair found while the index is not
>   installed can never be answered as an idempotent success;
> - `refusal.reason === "duplicate"` -> re-read the live pair, and the re-read is
>   asked only WHICH row won (the idempotent 200, same id for both callers). If that
>   winner is gone, `lostRaceVanished(PAIR_INDEX, ...)` -- the invariant is intact,
>   retry -- not an operator alarm.

## API upgrade order (what a pack must do, in this order)

1. Declare `uniqueIndexes` on the manifest with the EXACT existing index names.
2. Remove `usesBatch` in the SAME change — the kernel rejects the pair at mount,
   and leaving it would also leave an unguarded write path.
3. Only then delete the pack's own readiness checks, table warming and expected
   definitions — and only after confirming the store gates cover every write the
   cube makes (`insert`/`update`; `batch` is NOT covered).
4. Replace hand-rolled 23505 matching with `onUniqueIndex(index, fail)` from
   `qwbe-core/errors`.
5. Keep the operator tool reading the declaration, not a copy of it.

## Behaviour change, deliberate and visible

**Current behaviour (after the review rounds; this is what the code and the tests do
today).** A name-index refusal is classified by the kernel's TAG:

- `duplicate` -> **409**, unconditionally. The index is the arbiter and it has spoken;
  no re-read can overrule it. Body names only the name the caller sent.
- `notReady` (the gate is shut: index dropped, forged, or invalid) -> **defect**:
  `500` with an **empty, sanitized body** (no index name, no schema, no SQL, no
  SQLSTATE, no repair command) plus one operator log line that does carry those.
  Asserted in step 5 of the HTTP test (`tools/contact-groups-http.test.mjs`), which
  asserts `500`.

The ordinary duplicate caught before the write is unchanged: the handler's pre-check
still answers `a contact group named "X" already exists`.

> **SUPERSEDED (first round).** This section originally claimed the shut-gate case
> "is now a **409** carrying the kernel's sentence, 'names cannot be changed until
> duplicate names have been reconciled' ... Asserted in step 5 of the HTTP test."
> That was true only of the first-round code. F1 made the shut gate a `500`, and F6
> made the classification come from the tag rather than from a re-read; the kernel's
> sentence is never handed to the caller. Step 5 asserts `500` and a body free of the
> index name, the schema and the words `invalid` / `reconciled`.

## Why the CLI is retained (the report's earlier "delete it" recommendation is superseded)

`tools/ensure-contact-group-indexes.mjs` stays, and stays transactional. The kernel's
installer runs inside `ensureTable`, swallows per-index failures and is memoized per
table per database: if the install cannot finish (lock timeout, a duplicate already
in the data, a crash mid-create), or if its result is later undone, **nothing retries
until the process restarts** while the write gate keeps refusing writes. The tool is
the only thing that closes that gap without a restart.

It no longer holds a copy of the invariant: it imports `SCHEMA` and `UNIQUE_INDEXES`
from the cube and renders `on` / `where` / `def` locally (`resolveSpec` → `TARGETS`).
No `qwbe-core/pg` import, no new runtime subpath, nothing weakened:

- dry run by default; `--apply` requires `--i-understand`; `--limit`, `--csv`,
  stats (`scanned/created/exists/skipped/failed`), exit codes 0/1/2;
- one transaction per target, `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` with the
  duplicate recheck taken INSIDE the lock, plus a post-create read-back;
- it never drops or rebuilds an index — a mismatch and an invalid leftover are both
  reported for an operator to resolve deliberately;
- no credentials in output; the connection string is never printed.

Hardening found while adopting: the tool read the `pg_indexes` view, which has no
validity column. The leftover of a failed `CREATE INDEX CONCURRENTLY`
(`indisvalid = false`, `indisready = false`) renders character-for-character like a
healthy index and enforces nothing — the tool would have reported `ready` while the
kernel's gate (which reads `pg_index`) refused every write. It now reads `pg_index`
and reports a fourth state, `invalid`. Reproduced end to end against a real server in
`tools/ensure-contact-group-indexes.test.mjs`.

Second finding, from the HTTP test: the kernel installs each table's index on THAT
table's first touch. A `GET /contact-groups` creates `contact_groups` + its name
index; `contact_group_members` and the pair index appear at the first member request.
With `warmTables` gone this is the honest lifecycle, and the tool reports the
not-yet-created table as `absent-table` with the exact request that creates it.

## Commands and results (all on throwaway databases; no active database touched)

Environment: `QWBE_DATABASE_URL` from `/home/bogdan/projects/qwbe/.env`
(PostgreSQL 16.14, host 127.0.0.1, port 5434 — credentials not reproduced here),
`QWBE_REPO=/home/bogdan/projects/qwbe`. `QWBE_PG_HOST/PORT/USER/PASSWORD` were
derived from that URL for the pre-existing tests that require the split spelling.
Databases: `qwbe_cgidx_*`, `qwbe_cghttp_*`, `qwbe_qwb50_*`, each created and dropped
by the test files themselves. No service was started or stopped, no reconciliation,
rename or delete was executed against real data.

| Command | Result |
| --- | --- |
| `node --test cubes/crm/contact-groups/index.test.ts source-contract.test.mjs` | 33/33 pass |
| `node --test tools/ensure-contact-group-indexes.test.mjs` | 19/19 pass |
| `QWBE_REPO=... node --test tools/contact-groups-http.test.mjs` | 8/8 pass |
| `npm test` (script unchanged) | 124 tests, 124 pass, 0 fail |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 2 pre-existing parse errors, both in `.t1450-baseline/untracked/frontend/**` (a foreign worker's baseline copy, untouched here); no finding in this change's files |

Baseline before the change, for comparison: 40/40 (source-contract + cube + tool)
and 8/8 (HTTP), both green.

## Tests added or adapted

- `source-contract.test.mjs`: exact `deepEqual` of both declared specs; `usesBatch`
  absent, twice.
- `cubes/crm/contact-groups/index.test.ts`: the store double now has a real gate
  that throws `UniqueIndexNotReady` from `insert`/`update` (a throw inside
  `Effect.sync` is a defect, like the real store); `batch`/`setReady` removed; new
  tests for the declaration, for `validateManifest` accepting it, for the read path
  touching no table, for the sanitized 409, for the lost-index re-shut, for the
  MEMBERS defect message, and for both mappings' matched/unmatched conditions.
- `tools/ensure-contact-group-indexes.test.mjs`: targets resolved from the
  declaration (`TARGETS` / `resolveSpec`), a new real-server test for the INVALID
  leftover, and the wrong-key/mismatch/idempotence/CSV/guard tests kept as they were.
- `tools/contact-groups-http.test.mjs`: steps 1–2 rewritten for the B2 lifecycle
  (kernel provisioning at first touch, catalog definition compared against the
  tool's rendering of the same declaration); step 5 asserts the DEFECT and its
  sanitization (see the review-fix section below); steps 3, 4, 6, 7, 8 unchanged,
  including the sharing boundary.


---

# Review fixes (B3 review round, 2026-09-26)

The review of this change returned APPROVE WITH FINDINGS: no blocker, five findings.
All five are applied and covered by tests. Nothing below changed the declared
invariant, the index names, the renderer's output, or any grant or identifier.

## The public invariants, restated

1. **409 means a name is really taken.** A unique-index refusal is classified by the
   kernel's structured tag (`UniqueIndexRefusal.reason`), never by inference: a
   `duplicate` is a `409` unconditionally, because the index is the arbiter; a
   `notReady` means nothing is enforcing the invariant, and that is a **defect** --
   `500` with an empty body for the caller, and one log line naming the index and the
   command that inspects it, **even when a live row happens to hold the name**. The
   membership pair index has the same two branches, with idempotent success in place
   of the 409; its re-read runs only in the `duplicate` branch and only to find WHICH
   row won.

   > **SUPERSEDED (first-round wording, second round F6).** This invariant was first
   > written as "Both write paths re-read the table and answer on what is actually
   > there: a live row holding the normalized name (and not the row being renamed) is
   > a `409`; no such row means the index is not enforcing anything". That re-read
   > classification is exactly what F6 removed: it compared the cube's JavaScript
   > `normalizedName` against a key Postgres computes with `lower(btrim(...))`, and
   > the two functions diverge (final sigma). `selfId` / "not the row being renamed"
   > is gone too -- an UPDATE that keeps its own index key does not violate a unique
   > index, so a `duplicate` on rename is by construction somebody else's row.
2. **A `500` from this cube carries nothing.** No index name, no schema, no SQL, no
   reason, no repair command. Those are the operator's and live in the log.
3. **The CLI refuses a declaration it cannot render.** `rows` other than `"active"`,
   an unknown `normalize`, an unsafe identifier or JSON key → exit `2`, before
   anything is rendered and before a connection is opened. It never guesses a shape
   into DDL and then reports `created`.
4. **The CLI has no kernel in its import graph.** It reads the invariant from a
   type-only leaf, so it still starts in an installed layout — which is the only
   layout the incident it exists for happens in.
5. **NULL keys are not duplicates.** The conflict scan filters them out, because a
   unique index treats them as distinct.

## What changed, per finding

- **F1 (MEDIUM) — a shut NAME gate could masquerade as a duplicate.**
  `cubes/crm/contact-groups/service.ts`: one seam, `onIndexRefusal`, carries the
  kernel's reason to a recovery instead of mapping straight to an error; a typed
  failure of the write itself passes through untouched. `index.ts`'s `nameRefused`
  re-reads `namedSame` and chooses `Conflict` or `Effect.die(indexRefusal(...))`.
  Previously a dropped/forged/invalid index answered the same `409` as a real
  duplicate, and the UI rendered "Another group already uses this name" while no
  name was obtainable at all.
- **F2 (MEDIUM) — the CLI rendered specs it did not understand.**
  `tools/ensure-contact-group-indexes.mjs`: `specProblem` / `SPEC_PROBLEMS` /
  `specGateError` validate every declared spec; `main` exits `2` before connecting,
  and `resolveSpec` throws at the render boundary for a caller that skipped the gate.
- **F3 (MEDIUM) — the CLI pulled the cube's runtime in.**
  `cubes/crm/contact-groups/invariant.ts` is a leaf with `import type` only;
  `service.ts` re-exports it, the CLI imports it directly.
- **F4 (LOW) — NULL keys reported as blocking.** The conflict scan adds
  `AND (body ->> '<key>') IS NOT NULL` per key.
- **F5 (LOW) — untruthful race diagnostic.** `indexRefusal` named the third
  possibility too: the winning row may have been soft-deleted between the 23505 and
  the re-read, which frees a partial-index key. Superseded by F6 below, which gives
  that case its own sentence instead of a hedge in a shared one.

## Second round (2026-09-26): classifying the refusal by TAG, not by re-read

The final review of the first round left one MEDIUM standing, and it was in F1's own
fix. `nameRefused` decided duplicate-vs-gate by **re-reading `normalizedName`**, the
field the cube denormalizes with JavaScript's `trim().toLowerCase()`. The index is
built on Postgres's `lower(btrim(...))`, and the two are not the same function.

Measured on the server this pack is tested against (**PostgreSQL 16.14, datcollate
`en_US.utf8`**):

```
lower('ΟΔΟΣ')          -> οδοσ     U+03C3          (the index key)
'ΟΔΟΣ'.toLowerCase()   -> οδος     U+03C2          (normalizedName)
```

So for a group named `ΟΔΟΣ`, `POST /contact-groups {"name":"οδοσ"}` passed the
pre-check, was refused by the index as a **real duplicate**, and then failed the
re-read for exactly the same reason the pre-check missed — so the cube concluded the
index was gone and answered **500 plus an operator alarm naming a healthy index**.
Baseline was 409.

- **F6 (MEDIUM) — duplicate-vs-gate was inferred, now it is told.**
  `qwbe/core/src/pg/errors.ts` gained `UniqueIndexRefusal`
  (`{ reason: "duplicate" | "notReady", index }`), passed to `onUniqueIndex`'s `fail`
  as a **second** argument. Backwards compatible by construction: a one-parameter
  callback is assignable to the two-parameter signature, so
  `core/src/cubes/permissions/groups.ts` — the only other caller — is untouched and its
  suite still passes 8/8. Re-exported from `qwbe-core/errors` as a type.
  `service.ts`'s `onIndexRefusal` hands the tag to the recovery; `index.ts` branches
  on it:
  - **name, `duplicate`** → `409` unconditionally. The index is the arbiter and it has
    spoken, so no re-read can overrule it. `selfId` is gone: an UPDATE that keeps its
    own index key does not violate a unique index, so a `duplicate` on rename is by
    construction somebody else's row.
  - **name, `notReady`** → defect (`500`, no details) + `indexNotReady(...)` in the log.
    Now definite about the three states instead of hedging, because the tag rules the
    race out. A shut gate stays a defect **even when a live row happens to hold the
    name**: nothing is enforcing the invariant, so `409` would send the caller away
    while the incident goes unreported.
  - **pair, `notReady`** → defect, decided **before** the re-read, so a live pair found
    while the index is absent can never be answered as an idempotent success.
  - **pair, `duplicate`** → re-read as before, and the re-read is now only asked *which
    row won* (idempotence), not *what happened*. A winner removed in between gets its
    own sentence, `lostRaceVanished(...)`: "the invariant is intact; retry the
    request" — no index named, no operator command, because there is no incident.
- **F7 (LOW) — the CLI printed driver messages.** `applyOn`'s catch and `main`'s catch
  printed `e.message`. For *these two indexes* that message is business data:
  PostgreSQL quotes the colliding key in a 23505
  (`Key (lower(btrim((body->>'name'))))=(acme holdings) is duplicated`), so the tool's
  own header promise — "no row values are printed" — was false on the failure path.
  Both now print `fault(e)`: the error's constructor name plus a shape-checked
  5-character SQLSTATE, or `unknown`. Same rule and same regex as the kernel's
  `sqlstate` (`core/src/pg/setup.ts`), so the two diagnostics an operator reads about
  these indexes sanitize identically. The `--csv` and normal report paths were already
  counts and row ids only.
- **F8 (LOW) — pure CLI tests were unreachable without a database.**
  `tools/ensure-contact-group-indexes.test.mjs` calls `requireDbUrl()` at module scope
  (deliberately: a suite that silently passed without a server would be worse). A
  top-level throw is an *import* failure, so the four suites that need no server were
  not skipped — they were never collected. They moved to
  `tools/ensure-contact-group-indexes.spec.test.mjs`, which has nothing at module scope
  that can refuse to load, and it is registered in `npm test`. 11 tests, and they run
  with `QWBE_DATABASE_URL` and `QWBE_PG_PASSWORD` both unset.
- **Generic `NOT_READY` wording (LOW) left as it is.** `onUniqueIndex`'s sentence is
  still the name-flavoured one for every index, so the pack's log line for a membership
  refusal still carries it — but only as `kernel reason: ...` inside a sentence this
  pack writes, which names the index, the real condition and the tool. Changing the
  kernel's public sentence would be a contract change for every cube; the structured
  tag makes the pack's own diagnostic accurate without one.
- **Source drift stays RED, deliberately.** `probes/source-drift.mjs` still reports
  `store/crm-pack` and `plugins/crm-pack` behind this repo. The authorized plan
  prohibits syncing the installed plugin or restarting services, so this is reported,
  not fixed.

## The distinction, as two examples

**Index healthy, pre-check blind** (the 409 only the database can raise). A group
named `ΟΔΟΣ` exists:

```
POST /contact-groups {"name":"οδοσ"}             -> 409 "a contact group named
                                                    "οδοσ" already exists"
```

The pre-check misses (`normalizedName` is `οδος`), the index refuses, and the kernel
tags the refusal `duplicate` — so the index exists and the answer is the ordinary
conflict. Before the tag this was a `500` and a false operator alarm.

**Index dropped** (`contact_groups_name_key` gone, same running process):

```
POST /contact-groups {"name":"After the drop"}   -> 500, body carries no detail
POST /contact-groups {"name":"  HELD NAME  "}    -> 409 (from the PRE-CHECK, which is
                                                    a read and is not gated)
```

Any write that reaches the *gate* while the index is absent is a `500`, whatever the
table holds: nothing is enforcing the invariant and no name is obtainable. The `409`
above never touches the gate. Repair, unchanged:

```
node tools/ensure-contact-group-indexes.mjs                      # dry run, exit 1 while broken
node tools/ensure-contact-group-indexes.mjs --apply --i-understand
```

## Tests added in this round

- `tools/ensure-contact-group-indexes.test.mjs`
  - *the declaration it refuses to render* (4 tests): the shipped declaration is
    accepted; every refusable shape is named; `resolveSpec` refuses at the render
    boundary; and end-to-end exit `2` against a deliberately unreachable URL, which
    proves the gate runs before any connection.
  - *in an INSTALLED layout* (1 test): builds a layout with a **copy** of
    `qwbe-core` under `node_modules` (a symlink resolves to its real path outside
    `node_modules` and would not reproduce the bug), asserts the counterfactual —
    importing `service.ts` there still fails with
    `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — and that the tool itself loads,
    prints `--help` (exit 0) and still refuses a missing URL (exit 2).
- `tools/contact-groups-http.test.mjs` step 5: the dropped-index write is now
  asserted as `500` with a body containing none of the index name, the schema, the
  tool name, `invalid` or `reconciled`; and, still with the index gone, a name a
  live row really holds answers `409`.
- Step 6 additionally asserts the `500` body leaks no private detail.
- `cubes/crm/contact-groups/index.test.ts` already carried the unit-level gate
  tests for rename and for `removeMember`.

### Second round

- `qwbe/core/src/pg/unique-index-refusal.test.ts` (new, **no database**, 6 tests): the
  tag for each of the two conditions, the sentences unchanged, the two re-die cases
  still re-dying, and a one-argument `fail` still working — the compatibility this
  change rests on.
- `cubes/crm/contact-groups/index.test.ts` (34 tests): the store double's name index
  now takes an `indexKey`, and `pgNameKey` reproduces the measured server behaviour
  (final `ς` → `σ`). New: **CREATE** and **RENAME** answer `409` across the divergence
  with no `blind` crutch; a shut gate stays a defect even when a live row holds the
  name; and a lost race whose winner vanished says so instead of blaming the index.
- `tools/contact-groups-http.test.mjs` step **3b** (new, real HTTP, real kernel, real
  PostgreSQL): asserts the divergence against *that* server first (`lower('ΟΔΟΣ') =
  'οδοσ'` and `'ΟΔΟΣ'.toLowerCase() !== 'οδοσ'`), then `POST` → `409` and `PATCH` →
  `409`, the renamed row unchanged, exactly one live row holding the key, and no index
  name / schema / SQLSTATE / `lower(` in either body. Both groups are soft-deleted at
  the end, so no data outside the test is involved.
- `tools/ensure-contact-group-indexes.spec.test.mjs` (new, no database, 11 tests): the
  four suites moved out of the DB file, plus a `fault` suite asserting that a realistic
  driver 23505 — key text, `detail`, `table`, `severity` and all — is reduced to
  `Error, SQLSTATE 23505` and leaks none of it, and that an unshaped `code` becomes
  `unknown` rather than being interpolated.

## Verification (2026-09-26, first round)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint cubes/crm/contact-groups/` | clean (one `no-unnecessary-type-assertion` in `service.ts` fixed here) |
| `node --test cubes/crm/contact-groups/index.test.ts source-contract.test.mjs` | 33/33 pass |
| `node --test tools/ensure-contact-group-indexes.test.mjs` | 19/19 pass |
| `QWBE_REPO=... node --test tools/contact-groups-http.test.mjs` | 8/8 pass |
| `npm test` | 124 tests, 124 pass, 0 fail |

## Verification (2026-09-26, second round)

Bounded and focused, by instruction; `npm test` was **not** re-run in full.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (crm-pack) | clean |
| `npx eslint cubes/ tools/` | clean |
| `npx tsc --noEmit -p core/tsconfig.json` (qwbe) | clean |
| `npx biome check .` (qwbe) | 374 files, no fixes applied |
| `node --test core/src/pg/unique-index-refusal.test.ts core/src/unique-index-http.test.ts core/src/pg-index/unique-index-spec.test.ts` | 28/28 pass (no DB) |
| `node --test core/src/pg/unique-index.test.ts` | 12/12 pass (throwaway DB) |
| `node --test core/src/cubes/permissions/groups-unique.test.ts` | 8/8 pass — the one-argument caller is unaffected |
| `node --test cubes/crm/contact-groups/index.test.ts` | 34/34 pass |
| `node --test source-contract.test.mjs` | 2/2 pass |
| `node --test tools/ensure-contact-group-indexes.spec.test.mjs` | 11/11 pass, and 11/11 again with `QWBE_DATABASE_URL`/`QWBE_PG_PASSWORD` **unset** |
| `node --test tools/ensure-contact-group-indexes.test.mjs` | 11/11 pass (19 total across the split, unchanged) |
| `QWBE_REPO=... node --test tools/contact-groups-http.test.mjs` | 9/9 pass, including the new **3b** |
| `node probes/sizecaps.mjs` | no NEW violation (1 inherited: kernel 90258) |
| `node probes/testgate.mjs` | every unit has tests |
| `node probes/untracked.mjs` | 0 units |
| `node probes/source-drift.mjs` | **FAIL (2 red)** — expected, see F8's note; no sync was authorized |

The Unicode divergence was **measured, not derived**: `lower('ΟΔΟΣ')` was read back
from the live server (PostgreSQL 16.14, `datcollate en_US.utf8`) in a read-only
`SELECT`, and step 3b re-asserts it inside the suite so the case cannot silently stop
reproducing.

All against throwaway databases (`qwbe_cgidx_*`, `qwbe_cghttp_*`, `qwbe_qwb50_*`)
created and dropped by the test files on the existing PostgreSQL 16.14 at
127.0.0.1:5434. No active database was modified, no service started or restarted,
no plugin synced into the qwbe checkout.

## Final review (2026-09-26): PASS, and the open non-blocking items

An independent read-only review of the tag round returned **PASS** -- 0 critical,
0 high, 0 medium, 4 low. It confirmed on the code, not on this report:

- the discriminator is additive: `core/src/pg/errors.ts:97-109` calls
  `fail(message, { reason, index })`, the only other caller
  (`core/src/cubes/permissions/groups.ts:41`) is a one-parameter function and is
  untouched, `error-contracts.ts:21` exports `UniqueIndexRefusal` as a **type only**
  (erasable, the emitted JS is unchanged), and a foreign `constraint` or a foreign
  index still re-dies;
- a 23505 on the named index is a `409` **unconditionally**, independent of what
  JavaScript's `toLowerCase` would have produced (`index.ts:261`);
- `notReady` is exclusively `Effect.die` (`index.ts:263`, `:358-359`), and the cube
  receives only the generic `NOT_READY`, never the kernel's `detail` with the schema
  or the index definition (`errors.ts:102`) -- the operator log line is sanitized;
- the pair re-read is reached only in the `duplicate` branch and answers only which
  row won; it no longer takes part in the readiness classification
  (`index.ts:356-364`).

Open, **non-blocking**, deliberately not changed in the documentation round:

- **Asymmetric default branch (LOW, future-proofing).** `index.ts:261` treats every
  reason other than `"duplicate"` as a defect, while `index.ts:358` treats every
  reason other than `"notReady"` as an idempotent duplicate success. The union is
  closed today (`"duplicate" | "notReady"`), so there is no live defect; if the
  kernel ever adds a third tag, the membership path would fail **open** -- it would
  answer 200 on a refusal nobody has classified. The fix is to make the membership
  branch match explicitly on `"duplicate"` and die on anything else. It is a
  production-code change and is left as a follow-up, not made here.
- **Generic `NOT_READY` wording (LOW)** -- already recorded above; changing the
  kernel's public sentence is a contract change for every cube.
- **`probes/source-drift.mjs` stays RED (2 red).** The installed plugin still serves
  the pre-round code. Syncing it is a separately approved action and was not part of
  this work.

## Documentation round (2026-09-26, doc only)

No production code was edited. This report's first-round statements that the second
round overtook are now marked **SUPERSEDED** in place, with the historical wording
quoted so the trail survives: the `service.ts` location of the invariant (it is
`invariant.ts`, a type-only leaf, re-exported by `service.ts`), the one-argument
`onUniqueIndex` snippet, the re-read-as-classifier description of `onPairTaken`, the
"shut gate is now a 409" behaviour-change paragraph (it is a sanitized `500`, and
step 5 of the HTTP test asserts `500`), and invariant 1 of "The public invariants,
restated". All historical verification tables and their results are left untouched.
One stale comment was corrected in `tools/contact-groups-http.test.mjs` (step 5): it
still said the caller's answer is decided by re-reading the table. Comment only, no
assertion and no behaviour changed.

## Not verified / limits

- `tools/import.test.mjs` requires the split `QWBE_PG_PASSWORD` spelling and will
  not run from `QWBE_DATABASE_URL` alone; that requirement is pre-existing and was
  not changed here. Both spellings were supplied for the `npm test` run above.
- The installed-layout test asserts node's current behaviour
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, node v24.19.0). If a future node
  strips types under `node_modules`, that counterfactual assertion becomes the thing
  that fails — deliberately, since the reason for the leaf would have changed.
- `qwbe/core` was under concurrent edit by another task while the HTTP and import
  suites ran; both copy the kernel into a scratch directory, so the results above
  reflect the kernel as of those runs.
- Second round: `npm test` (124 tests), `tools/import.test.mjs`,
  `core/src/pg/index-lifecycle.test.ts` and the rest of the core suite were **not**
  re-run — the round was bounded to the files it touched plus the contracts they cross.
  Nothing outside `qwbe/core/src/pg/errors.ts`, `qwbe/core/src/error-contracts.ts`, the
  contact-groups cube and its tools was edited, and the one cross-cube contract
  (`onUniqueIndex`'s `fail` arity) was verified on its only other caller.
- `dependency-cruiser` is still not installed in this checkout, so
  `cubes-may-not-reach-into-the-store` remains read statically, not run — unchanged from
  the first round and not affected by these edits.
- The divergence is reproduced in the unit tests as a single codepoint substitution
  (`ς` → `σ`), not a port of ICU. That is the whole gap this cube can hit for a Greek
  name; other collations may diverge elsewhere, and the fix does not depend on knowing
  where — that is the point of taking the tag from the server instead of guessing.
