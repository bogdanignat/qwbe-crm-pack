# Jev scores under 70 after the move to Effect (documented exceptions)

Measured 2026-09-27 between 17:00 and 21:15 with the owner's Jev scorer after each agent run
that wrote code, on three rubrics: ponytail (lean code), unslop (plain prose) and srp (single
responsibility). Latest score per file and rubric. 77 files scored; 33 have at least one score
under 70. No unslop score is under 70.

The owner allowed exceptions (2026-09-27: every file above 70, exceptions where needed). These
are to fix in a later refactor. Jev varies between runs of the same file: the Jev refactor
round measured `tools/vtiger/vtiger-map.ts` at 62.6 in its own session while the recorded score
of the same file is 35.9; treat single numbers as noisy and rescore before acting on one.

Patterns on this branch (the same as the kernel's stage 2-5 exceptions):
- Entry files of the CLI tools score low on srp: the entry wires argv, config, the API session
  and the stages. They are already split into `-pure.ts` decisions and one-domain I/O modules
  (`-api.ts`, `-prepare.ts`, `-db.ts`, `-counts.ts`); splitting further raises srp and lowers
  depth.
- Scenario tests and live checks score low on srp: one file holds setup, the scenario and its
  assertions, by design (one purpose: one scenario).
- ponytail under 70 is `lean` / `every_part_needed` on files between 60 and 130 lines.
- `tools/demo/seed-demo-wipe.ts` and `seed-demo.ts`, `tools/vtiger/vtiger-export.ts`: ponytail
  `loses_data_on_error`. The wipe deletes only `demo:*` rows and a rerun of the seed rebuilds
  them; the export writes to `.local/vtiger-export` and a rerun overwrites. No customer data is
  lost; left as is.

| file | scores under 70 |
|---|---|
| `tools/vtiger/vtiger-map.ts` | srp 35.9, ponytail 64.4 |
| `tools/vtiger/vtiger-to-staging.ts` | srp 42.5, ponytail 63.5 |
| `tools/vtiger/vtiger-verify.ts` | srp 44.1, ponytail 64.9 |
| `tools/demo/seed-demo.ts` | srp 57.5, ponytail 61.7 |
| `tools/vtiger/vtiger-map-rows.ts` | srp 58.1 |
| `tools/vtiger/vtiger-map-api.ts` | srp 61.9 |
| `checks/_layers/install-from.ts` | srp 62.7 |
| `tools/vtiger/vtiger-map-prepare.ts` | srp 63.0 |
| `tools/vtiger/vtiger-to-staging-pure.ts` | ponytail 63.3 |
| `tools/demo/seed-demo-ensure.ts` | srp 63.7, ponytail 69.3 |
| `tools/demo/seed-demo.test.ts` | srp 63.8 |
| `tools/vtiger/vtiger-export.ts` | srp 64.5, ponytail 69.2 |
| `tools/demo/seed-demo-wipe.ts` | ponytail 64.9, srp 67.6 |
| `checks/live/import-chain.test.ts` | srp 65.2 |
| `checks/live/install-lifecycle.test.ts` | srp 65.2 |
| `tools/db/ensure-external-id-index.test.ts` | srp 65.6 |
| `checks/live/install-lifecycle-remove.test.ts` | srp 65.7 |
| `tools/vtiger/vtiger-map-pure.ts` | ponytail 65.9, srp 68.8 |
| `checks/integration/vtiger-export-stream.test.ts` | ponytail 66.2, srp 67.5 |
| `checks/_layers/sharing.ts` | srp 66.3 |
| `checks/unit/vtiger-error-output.test.ts` | srp 66.5, ponytail 67.1 |
| `tools/db/ensure-external-id-index.ts` | srp 66.7 |
| `checks/_layers/vtiger-cli.ts` | ponytail 66.8, srp 69.5 |
| `tools/shared/run-tool.ts` | srp 66.9 |
| `tools/check/steps.ts` | ponytail 67.1 |
| `checks/live/crm-sharing-revoke.test.ts` | srp 67.5 |
| `tools/db/backfill-contact-organizationid.test.ts` | srp 67.5 |
| `checks/unit/source-contract.test.ts` | srp 67.8 |
| `checks/live/crm-crud.test.ts` | srp 68.2 |
| `tools/vtiger/vtiger-verify-pure.ts` | ponytail 68.5 |
| `checks/_layers/boot.ts` | srp 68.6 |
| `tools/vtiger/vtiger-export-pure.ts` | ponytail 69.3 |
| `tools/db/backfill-contact-organizationid.ts` | ponytail 69.8 |

## The T-1450 layer (2026-09-28, not yet scored)

Ported on the branch after the table above was measured; Jev scores are still to be taken. Known
deviations from the rules, kept on purpose:
- Scenario files over ~100 lines, one purpose each: `tools/db/ensure-contact-group-indexes.test.ts`
  (11 database scenarios), `ensure-contact-group-indexes-spawn.test.ts`, `contact-group-indexes-pure.test.ts`,
  `checks/live/contact-groups-{unique,repair,sharing}.test.ts`, `test/sdk-check-{pure,env,sandbox}.test.ts`.
- `tools/db/contact-group-indexes-spec.ts` (107 lines), `test/sdk-check-run.ts` (102) and
  `test/sdk-check-sandbox.ts` (114, the sibling layout and the links added on 2026-09-28) sit just over
  the line.
