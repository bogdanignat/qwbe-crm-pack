# Stage 1 map: crm-pack probes, tests and tools to Effect checks and tools

Date: 2026-09-27. Same method as qwbe's `docs/plan/stage-1-map.md`: every old file gets a
destination (a new check, a tool, or DROP with a reason). Paths are relative to the repo root.
Prefixes: `C/` = `checks/`, `T/` = `tools/`. Out of scope: `frontend/` and `cubes/` (the cubes are
already Effect; their `node:test` files move when the kernel's own runner decision lands).

Rules for every new file (copied from qwbe): Effect (`Effect.gen`, Layers, `Data.TaggedError`,
Schema at the edges, `Command` from `@effect/platform`), tests on `@effect/vitest` with `expect`,
no new `.mjs`, one purpose per file, around 100 lines or less, Jev score above 70 or a written
exception in `docs/plan/jev-exceptions.md`. No check writes to the git tree: data, plugins and
store live in scoped temp directories and throwaway databases.

The layers are this pack's own, adapted from qwbe's `core/checks/_layers`: qwbe does not export
them through `qwbe-core`, and importing kernel internals pins the pack to one checkout.

## 1. probes/ (4 files, 937 lines)

| # | old file | lines | destination | reason / note |
|---|---|---|---|---|
| 1 | (deleted qwbe `probes/lib.mjs`, imported by 3 probes and the import test) | 227 | `C/_layers/free-port.ts`, `test-db.ts`, `workspace.ts`, `boot.ts`, `test-server.ts`, `api-client.ts`, `session.ts` | helpers split into Layers; `makeScore` goes away (vitest reports). The interim `probes/src/kernel.ts` is the source for the split and is then deleted |
| 2 | probes/crm.mjs (auth: 401 / 403 / 404 for three cubes) | ~120 of 374 | `C/live/crm-auth.test.ts` | |
| 3 | probes/crm.mjs (create/list/get, schema edge, money in minor units, party relation) | ~170 of 374 | `C/live/crm-crud.test.ts` | |
| 4 | probes/crm.mjs (each cube boots and serves without the other, `QWBE_MOUNTED`) | ~40 of 374 | `C/live/crm-one-cube.test.ts` | |
| 5 | probes/crm-sharing.mjs | 180 | `C/live/crm-sharing.test.ts` | runs `frontend/src/lib/sharing.ts` against the server as today |
| 6 | probes/qwb31-install-lifecycle.mjs | 323 | `C/live/install-lifecycle.test.ts` | the old probe points at `~/Projects/qwbe-packs/plugins/crm-pack`, a path that no longer holds the pack; the check installs THIS repo through install-from into a scratch store |
| 7 | probes/source-drift.mjs | 60 | `T/check/source-drift.ts` (opt-in gate `--drift`) | reads the local kernel checkout's store shelf and installed copy: local state, not a property of the code |

## 2. Tests and tools outside probes/

| # | old file | lines | destination | reason / note |
|---|---|---|---|---|
| 8 | source-contract.test.mjs | 49 | `C/unit/source-contract.test.ts` | |
| 9 | tools/import.test.mjs: query builders + row mapping | ~80 of 626 | `C/unit/vtiger-query.test.ts`, `C/unit/vtiger-mapping.test.ts` | |
| 10 | tools/import.test.mjs: error output carries no customer values | ~45 of 626 | `C/unit/vtiger-error-output.test.ts` | |
| 11 | tools/import.test.mjs: exporter streams through `query().stream()` | ~80 of 626 | `C/integration/vtiger-export-stream.test.ts` | fixture database, no server |
| 12 | tools/import.test.mjs: import chain end to end (6 tests) | ~380 of 626 | `C/live/import-chain.test.ts` (+ `C/live/import-rejects.test.ts` if over ~100 lines per purpose) | boots the kernel through `C/_layers` |
| 13 | tools/ensure-external-id-index.test.mjs | 95 | `T/db/ensure-external-id-index.test.ts` (done) | tests stay beside their tool, as in qwbe `core/tools/db/db.test.ts` |
| 14 | tools/backfill-contact-organizationid.test.mjs | 133 | `T/db/backfill-contact-organizationid.test.ts` (done) | |
| 15 | tools/seed-demo.test.mjs | 153 | `T/demo/seed-demo.test.ts` (done) | |
| 16 | tools/db-url.mjs, drop-throwaway-db.mjs, ensure-external-id-index.mjs, backfill-*.mjs | 217 | `T/db/*.ts` (done) | |
| 17 | tools/seed-demo.mjs | 395 | `T/demo/seed-demo.ts` (done) | over 100 lines: split into a pure module and the I/O in the Jev round |
| 18 | tools/vtiger-*.mjs (6 files) | 832 | `T/vtiger/*.ts` (in progress) | `vtiger-map.ts` split pure / I/O if over ~100 lines |
| 19 | tools/fixtures/*.json | - | `C/_fixtures/vtiger/` | data for rows 9-12 |
| 20 | package.json `test` (a `node --test` list) | - | `T/check/check.ts` gates + `vitest run` | see section 3 |

### 2b. The T-1450 layer (branch `feat/t1450-user-picker-ux`, moved on 2026-09-28)

Written as `node:test` `.mjs` on the branch before main's move; ported to the same layout in one round.

| # | old file | lines | destination | reason / note |
|---|---|---|---|---|
| 21 | tools/ensure-contact-group-indexes.mjs | 620 | `T/db/contact-group-indexes-{spec,help,report,db,apply}.ts` + `T/db/ensure-contact-group-indexes.ts` (entry) | pg errors never reach `DbFailed`/`runTool` (the driver message quotes the duplicate key): only `fault()` (SQLSTATE + class); apply on a dedicated `PoolClient`; spec gate before any connection |
| 22 | tools/ensure-contact-group-indexes.spec.test.mjs | 307 | `T/db/contact-group-indexes-pure.test.ts`, `T/db/ensure-contact-group-indexes-spawn.test.ts` | the spawn file copies the tool's whole import closure into a temp sandbox (INSTALLED layout, qwbe-core as a real copy) |
| 23 | tools/ensure-contact-group-indexes.test.mjs | 411 | `T/db/ensure-contact-group-indexes.test.ts` | throwaway DB through `C/_layers/test-db.ts`, as row 13 |
| 24 | tools/contact-groups-http.test.mjs | 566 | `C/live/contact-groups-{install,unique,repair,sharing}.test.ts` + `C/_layers/contact-groups.ts` | one scenario per file on `testServer` + `plantCrmPack`; the old file imported the kernel's deleted `probes/lib.mjs` |
| 25 | tools/start-local.mjs, stop-local.mjs, launcher-control.mjs | 253 | DROP | the workstation launcher started the mother from inside a plugin; removed on 2026-09-28 (Bogdan): the kernel starts the mother, `frontend/` runs `npm run dev` |
| 26 | tools/start-local.test.mjs | 180 | DROP | with row 25 |
| 27 | test/sdk-check.mjs, sdk-check-lib.mjs | 401 | `test/sdk-check-{pure,env,sandbox,run}.ts` + `test/sdk-check.ts` | stays in `test/`, the pack's own test directory, excluded by the kernel (T-1452); since kernel PR #45 `tools/` and `checks/` are excluded at install too |
| 28 | test/sdk-check-lib.test.mjs | 308 | `test/sdk-check-{pure,env,sandbox}.test.ts` | `test/**` added to vitest, tsconfig.tools and eslint |
| 29 | tools/db-url.mjs, drop-throwaway-db.mjs (bridge copies restored at the merge) | 43 | DROP | row 16 already holds them as `T/db/*.ts` |

## 3. The check tool and the configs

- `T/shared/run-tool.ts`, `T/shared/args.ts`: as in qwbe (entry exit codes, flag decoding).
- `T/check/check.ts` + `gates.ts`: `typecheck` (`tsc` for cubes and for tools/checks), `lint`
  (`eslint .`), `test` (`vitest run`, unit + integration + tools; the cube `node:test` files),
  `secrets` (`gitleaks`), opt-in `--live` (`vitest run --config vitest.live.config.ts`) and
  `--drift`. Runs every gate, exit 1 if any is red.
- `vitest.config.ts`: `T/**/*.test.ts`, `C/unit/**`, `C/integration/**`; `vitest.live.config.ts`:
  `C/live/**`, one file at a time, long timeouts.
- `@effect/vitest` 0.30.0 (the kernel's version) installed by the shepherd.

## 4. Stages

| # | stage | scope | stop condition |
|---|---|---|---|
| 1 | Map | this file | owner reads it |
| 2 | Base | `@effect/vitest`, configs, `T/shared`, `T/check` | `check` green on the new tools |
| 3 | Layers + unit + integration | `C/_layers`, rows 8-11 | those checks green, old probes untouched |
| 4 | Live | rows 2-7, 12 | `check --live` green locally |
| 5 | Switch and delete | delete `probes/*.mjs` bodies, `source-contract.test.mjs`, `tools/*.mjs`, `tools/fixtures`, `probes/src/`; README and cube comments point at the new paths | `check` and `check --live` green |

## 5. Decisions for the owner

Decided 2026-09-27 by the owner: both as proposed below (keep `probes/crm.mjs` as a one-line
launcher; leave `scripts.test` as it is and add `npm run check`).


1. The kernel's `qwbe check .` still requires at least one `probes/*.mjs` and runs it
   (qwbe `core/src/check-package.ts:142`; the stage-6 contract review, row 6, proposes accepting
   `*.ts`). Until the kernel decides: keep `probes/crm.mjs` as a one-line launcher of the live
   checks. Rejecting it means the pack fails the kernel's runtime stage.
2. `package.json` `scripts.test` must be exactly `qwbe check .` for the kernel (qwbe
   `check-package.ts:406`); on `main` it is not, today. Keep the pack's own `check` as
   `npm run check` and set `test` to `qwbe check .`, or leave the drift as it is.
