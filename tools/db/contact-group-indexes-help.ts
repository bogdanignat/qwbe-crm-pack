// The operator's text for tools/db/ensure-contact-group-indexes.ts --help: when the tool is needed at
// all (the kernel installs both indexes itself), what it may change, and what each exit code means.

export const DEFAULT_LIMIT = 50

export const HELP = `ensure-contact-group-indexes -- report and repair the unique indexes crm/contact-groups declares

  Scope       the two indexes the cube declares in \`manifest.uniqueIndexes\`, in its own schema:
                contact_groups.contact_groups_name_key
                  UNIQUE ((lower(btrim(body->>'name')))) WHERE deleted = false
                contact_group_members.contact_group_members_pair_key
                  UNIQUE ((body->>'groupId'), (body->>'contactId')) WHERE deleted = false
              Both are PARTIAL on live rows: a soft-deleted group frees its name and a removed
              membership can be added again. The specs are READ from the cube's declaration and
              the SQL is rendered from them, so this tool and the running cube cannot disagree.
  When you need it
              The KERNEL installs both indexes itself, as the table's owner, the first time it
              touches each table -- an ordinary install needs nothing here and a dry run will say
              "nothing to do". You need this tool when that installer could not finish or its
              result was undone, because it runs once per table per process and never retries:
                * live rows already duplicated the key, so CREATE UNIQUE INDEX failed. The cube
                  then serves reads and REFUSES writes, and nothing retries until a restart.
                  Reconcile the duplicates this reports, then --apply: the cube's gate re-reads
                  the catalog on every write, so the next request succeeds with no restart.
                * an index was dropped or replaced on a live system.
                * an interrupted CREATE INDEX CONCURRENTLY left an INVALID index behind. It
                  renders identically to the real one and enforces nothing; this reports it as
                  invalid and never touches it -- dropping it is the operator's deliberate act.
  Side effects  with --apply: CREATE UNIQUE INDEX, nothing else. No row is created, updated or
              deleted; no index is ever dropped or rebuilt. Each target is its own transaction,
              behind SHARE ROW EXCLUSIVE with the duplicates re-counted inside the lock; reads
              are never blocked.
  Guards      the cube's declaration is checked BEFORE anything is rendered: a normalization or a
              predicate this tool cannot render is refused with exit 2, never guessed (guessing
              would create an index the kernel's gate then refuses forever).
              Dry run by default. --apply is refused without --i-understand. Duplicate rows are
              reported and block their own target -- they are never repaired here. An index
              carrying the right name with the wrong definition, or the right definition while
              the catalog marks it invalid, is reported and never accepted.
  Order on a fresh install
              1. install the pack (settings:install-from) and restart the kernel
              2. ordinary use: the first request that touches a table creates it AND its index
              3. this tool, dry run, to VERIFY:  node tools/db/ensure-contact-group-indexes.ts
                 (exit 0 and "nothing to do" is the healthy answer)
              4. only if step 3 reports work to do: reconcile what it names, then
                   node tools/db/ensure-contact-group-indexes.ts --apply --i-understand
              Until both indexes are ready the cube REFUSES writes (loudly, 500) and serves
              reads, so the repair is always possible while the gate is shut.

  --apply            create the missing indexes (default: report only)
  --i-understand     required with --apply
  --limit=N          examine at most N duplicate sets per target (default ${DEFAULT_LIMIT})
  --csv              machine-readable rows on stdout instead of prose
  --help             this text

  Connection  QWBE_DATABASE_URL, or QWBE_PG_PASSWORD (plus optional QWBE_PG_HOST/PORT/USER),
              as the database owner -- creating an index needs it. No password default, nothing
              is guessed, and the connection string is never printed.

  Safe first step:
    QWBE_DATABASE_URL=... node tools/db/ensure-contact-group-indexes.ts

  Exit codes  0 both indexes enforcing (created or already matching and valid)
              1 anything less: missing, blocked by duplicates, same name with a different
                definition, present but invalid, table not created yet, or an execution failure
                -- a dry run over a missing index exits 1 as well, so a preflight script cannot
                mistake "ran" for "installed"
              2 bad input: an unknown flag, a bad --limit, no connection in the environment, or a
                cube DECLARATION this tool cannot render (an unknown normalization, a predicate
                other than the active-rows one, an unsafe identifier). Nothing is inspected in
                that case -- teach the renderer the new shape first`
