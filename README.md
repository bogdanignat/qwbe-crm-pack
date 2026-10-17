# crm-pack — CRM rebuilt as an external plugin (QWB-30)

Rebuilt on 2026-08-12 from the verified historical copy (this directory before the rewrite —
SHA-256 recorded in `../MANIFEST.sha256` and in `qwbe/docs/crm-history-research.md`). Not a Git
history rewrite: the old files were the source material, adapted onto the current public cube
contract (`qwbe-core/cube`, `defineCube`).

## Installing: the official path (QWB-54, ticket 22)

No manual copy anywhere: the kernel installs a package FROM its repository directory. Against
a running kernel with the settings cube mounted:

    settings:install-from <path-to>/plugins/crm-pack

(or `POST /settings/packages/install-from` pointing at this directory). Staging runs the
source contract the kernel enforces at boot and refuses a package that breaks it; the store
copy records where it came from and when (`qwbe-source.json`). Freshness is provable, not
assumed - both checks exit 1 on drift:

    node tools/check/source-drift.ts          # this pack: store shelf and installed copy
    node ../../qwbe/core/bin/qwbe.mjs drift   # every shelf in the kernel's store

`start-crm-local.sh` is gone (QWB-54, ticket 22): it installed the pack by hand-copying into
`core/plugins`, the exact path this ticket removes. Install with the command above, then
start the kernel the qwbe way; the frontend runs from `frontend/` with `npm run dev`.

## Domain model — the decided vocabulary

| Term | Meaning here |
| --- | --- |
| **CRM** | Sidebar hierarchy and lifecycle parent. Owns no domain table. |
| **Contact** | A person the business deals with. Owned by the `crm/contacts` cube. |
| **Organization** | The company a business deals with — the vtiger Accounts module, rebuilt (QWB-47). Owned by the `crm/organizations` cube. One concept, one name (QWB-54, ticket 12): cube, table, route, permissions, command, event and the relation field all say Organization; "Account" survives only as the source system's own module name in the vtiger import mapping. |
| **Contract** | A deal signed with a party. Owned by the `crm/contracts` cube. |
| **party** | The other side of a contract, by id only (`Contract.partyId`, nullable). The cube that holds the party is NOT named: no import, no copied field, no join. |
| **company** | Free text on a contact (`Contact.company`, nullable string). Kept even now that Organization exists: it is historical data, not a reference. |

## One name: Organization (QWB-54, ticket 12)

The same thing used to be named five ways: cube `crm/accounts`, entity `Organization`, table
`organizations`, permissions `crm/accounts:*`, relation field `Contact.accountId`. Since the
rename it is one name everywhere:

- Cube, route, table, permissions (`crm/organizations:read|write`), command
  (`crm/organizations:count`), event (`crm/organizations.created`) and the id prefix (`org_`)
  all carry `organization`.
- The relation field is **`Contact.organizationId`**. The contacts cube's schema version was
  bumped to 1.1.0 for it (see "Versions" below).
- The import mapping keeps the source-system names (`mappings/accounts.json`, vtiger columns
  `account_no`, `account_type`): there the names come from vtiger, and the mapping is the one
  place "account" legitimately remains. Our side of that mapping targets
  `organizationNo` / `organizationType`.

## The predecessor, declared honestly (QWB-54, tickets 08, 12 and 14)

The organizations cube IS the old `crm/accounts`, renamed — so its manifest declares exactly
that `dataMigration` (`fromCube: "crm/accounts"`, `fromPlugin: "crm-pack"`). Postgres schemas
are named after the cube (`crm--accounts` → `crm--organizations`), so the kernel moves the
schema at mount instead of booting the renamed cube on an empty one. The provenance ledger,
not the manifest's claim, decides whether `crm/accounts` really belonged to crm-pack. (The
manifest once invented a migration from a cube called "organizations" that never existed, to
satisfy a hierarchy gate; the invented source is gone, the honest one is declared, and the
kernel side that refuses an unattributable source is ticket 08.) Rows migrated from the old
cube still carry the pre-rename field names `accountNo`/`accountType` in their body; the
one-shot backfill (`tools/db/backfill-contact-organizationid.ts`) renames those keys once, in
the data. Operator note: `migrateDataSchemas` refuses when the destination schema already
exists — a system that already booted with the new cube name must drop the empty
`crm--organizations` schema first.

## The relation to the Organization (decided QWB-47, replacing the old limit)

The original restore had **no Organization entity** on purpose. That limit was lifted by
decision (QWB-47): vtiger's Organizations — the object the users worked in all day, about 60
thousand rows — are now the `crm/organizations` cube, entity `Organization`.

The relation has ONE truth: **`Contact.organizationId`**.

- It lives on the contact. Nullable, opaque, set by the caller at create time and correctable
  by `PATCH /contacts/:id` (move to another organization, or unlink with
  `organizationId: null`).
- An organization's contacts are DERIVED: the contacts list takes an `organizationId` filter
  (`GET /contacts?organizationId=...`). There is no related-list endpoint and no contactIds field.
- The contacts manifest DECLARES the relation
  (`relations: { organizationId: { target: "crm/organizations" } }`): a declared target is
  metadata, not an import, and is what lets the metadata endpoint resolve ids to names without
  coupling the cubes' code.
- The id is checked for shape only. Refusing a well-formed id that does not exist needs a
  kernel-enforced relation, which does not exist yet (the kernel offers cubes no cross-cube
  read); until it lands, such a create is accepted and the probe pins that behaviour, to be
  flipped to 400 when the enforcement arrives.
- The `crm/organizations` fields are a photograph of the vtiger standard fields of the Accounts
  module that actually carry data — not a one-to-one copy. Left out: what is empty or
  vtiger-internal (`notify_owner`, `parentid` — an organization-to-organization hierarchy is
  out of scope), the custom fields (`cf_*` — a separate system, not this pack), and
  `annualrevenue` (a bare integer with no currency; money comes back only in minor units with
  a currency, as in contracts).

What stayed deliberate from the old limit: `Contact.company` is still text and references
nothing, and `Contract.partyId` is still opaque. History is data, not a foreign key.

## Deletion (decision recorded for the ticket that adds it)

There is no delete endpoint on `crm/organizations` in this ticket. When deletion comes, the
rule is: an organization is refused deletion while any contact still references its id — the
contact's `organizationId` is the one truth, so deleting under it would leave
`GET /contacts?organizationId=X` returning rows whose `GET /organizations/X` is 404. The patch
schema already refuses `deleted`, so the back door of `PATCH {"deleted": true}` is closed.
Reconciliation (cascade, unlink, or refuse) is the decision of that ticket, made here explicit
in advance.

## The minimal relation (version one, stated and tested)

One direction only: a contract **holds** a party id. Nothing resolves it inside this plugin.
If `contacts` is absent or switched off, `contracts` starts and serves anyway, with ids that
resolve to nothing — and vice versa. Showing a contract next to its contact is declared one
level up, in a space, by a third party, so neither cube ever learns the other exists. The
live checks (`checks/live/crm-one-cube.test.ts`) boot the kernel with each cube alone to prove the
independence, and exercise the party id as data (set, nullable, opaque).

## Money

`Contract.amount` is an integer in **minor units** (bani, cents) — `Schema.Int` rejects
fractions at the boundary. Totals are rendered **per currency**, never summed across
currencies: `contracts:value` and the summary both follow that rule.

## Demo data (generated, never committed)

The sandbox is populated by a generator, not by data: 50 organizations, 50 contacts and 5
contracts, linked (contact → organization, contract → organization via `partyId`), plus the
custom fields they carry — field STRUCTURE mirrored from the source system's custom fields
(names, types, required flags), with synthetic values and synthetic picklist options. No row
from the source system is ever read, and nothing generated is committed: the seed script is
the only artifact, the data lives in the local database.

```sh
node tools/demo/seed-demo.ts        # create what is missing (defs first, then rows)
node tools/demo/seed-demo.ts --wipe # wipe demo rows + demo defs, then rebuild
```

The same seed always produces the same rows (deterministic, index-derived — no faker), and a
rerun fills only what is missing: it never rewrites a row that is already there, so edits
made through the UI survive a rerun. `--wipe` needs `QWBE_DATABASE_URL` (the same connection
the kernel runs with): the cubes have no DELETE endpoints, so demo rows are removed directly
in Postgres. Demo rows mark themselves with `externalId: demo:*` (and the demo contracts
with their deterministic titles); anything created by hand or by the vtiger import is never
touched and is reported as left in place.

## The external identity and the idempotent import (QWB-54, ticket 13)

Every IMPORTABLE cube carries **`externalId`** — the row's own identity from its source
system, spelled `vtiger:<crmid>` by the vtiger import. `crm/contracts` is not importable (no
mapping, no import writes it), so it declares no external identity. The rules:

- **Uniqueness lives in the DATABASE, not in the application.** Each importable table holds a
  partial unique index on `body->>'externalId'` (live rows, non-null values only — a row
  created by hand has no source system, and a soft-deleted row does not block its identity
  from being imported again). The index is ensured by `tools/db/ensure-external-id-index.ts`,
  which the import tool runs before its first write; it can also be run standalone for both
  cubes. A plugin cube cannot create the index itself: the kernel's per-cube role holds DML
  only, and Postgres refuses `CREATE INDEX` to anyone but the table's owner.
- **The import asks before it creates.** The map tool looks each row up through the generic
  list's `?externalId=` filter (the ticket-06 list contract; the field is declared in the
  cubes' `searchable`) and POSTs only when the row is missing. The old
  `<entity>-idmap.json` ledger files are GONE — there is no file left to lose: a run killed
  at half and rerun ends with exactly one row per external identity.
- **A run with rejected rows fails.** Rows the tool refuses (cube rejections, mapping errors,
  rows without their external key) make the exit code 1, with the rejected count in the last
  output line. `--max-rejects <n>` sets the explicit threshold for runs where rejections are
  accepted. No row value is ever printed — counts, HTTP statuses and field names only.

The map tool needs a database connection (`QWBE_DATABASE_URL`, or `QWBE_PG_PASSWORD` plus
optional `QWBE_PG_HOST/PORT/USER`) alongside the API credentials, because of the index. Rows
stored before this ticket lack the `externalId` KEY; the one-shot backfill
(`tools/db/backfill-contact-organizationid.ts`) fills it with null on both cubes, the same way
it fills `organizationId` on contacts, and renames the pre-ticket-12 field keys inside
organizations (`accountNo` → `organizationNo`, `accountType` → `organizationType`).

## Versions

Cubes that declare a `version` in their manifest are tracked by the kernel's metadata drift
gate: the same version with a different schema hash refuses to boot. Bump the version on any
schema change (QWB-54, ticket 20). History: `crm/contacts` is at 1.3.0 (1.1.0: the relation
field was renamed `accountId` → `organizationId`, ticket 12; 1.2.0: `externalId` added,
ticket 13; 1.3.0: searchable widened to name/email, ticket 14); `crm/organizations` is at
1.1.0 (1.0.0 at the rename — the old `crm/accounts` data moves with the declared
`dataMigration`, ticket 14; 1.1.0: `externalId` added, ticket 13); `crm/contracts` is at
1.0.0.

## Layout

```
qwbe-package.json                  package manifest — CRM parent and three children
cubes/crm/index.ts                 hierarchy parent and `/crm` child catalogue
cubes/crm/organizations/index.ts   Organization: table, API, permissions, commands
cubes/crm/organizations/schema.ts  Organization: the domain schemas (split for the size cap)
cubes/crm/contacts/index.ts        Contact: table, API, schemas, permissions, commands
cubes/crm/contracts/index.ts       Contract: table, API, schemas, permissions, commands
cubes/crm/*/index.test.ts          source-local contract tests
checks/unit/, checks/integration/  vitest checks without a server (source contract, vtiger)
checks/live/                       runtime proof against a live kernel (scratch QWBE_DATA_DIR)
probes/crm.mjs                     the kernel's probe entry: runs checks/live/
tools/check/                       `npm run check` gates; source-drift.ts = copy freshness
```

The cubes do not import each other. All use only exported `qwbe-core/*` package subpaths.

## Running the tests

Unit tests and typechecking run from this source directory. Live checks use a Qwbe checkout
and scratch data:

```sh
npm install --ignore-scripts
npm run check                  # typecheck, lint, test, secrets
npm run check -- --live        # plus checks/live (starts its own servers on scratch data)
npm run check -- --drift       # plus tools/check/source-drift.ts

# live checks alone, as the kernel runs them
QWBE_REPO=<qwbe> node probes/crm.mjs
```

This pack is not yet gated by `qwbe check`; tracked as follow-up.
