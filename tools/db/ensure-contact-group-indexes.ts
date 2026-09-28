// The two unique indexes crm/contact-groups DECLARES, from the operator's side: what the database holds,
// what blocks the invariant, and a bounded, transactional way to install it on a running system.
//
// The kernel installs both itself on the first touch of each table, but once per table per process and
// swallowing a failure per index: live duplicates, an index dropped or replaced, or an INVALID leftover of
// CREATE INDEX CONCURRENTLY leave the cube reading and refusing writes until a restart. This tool closes
// those states without one: dry run by default, `--apply --i-understand` to write, exit 0 only when both
// indexes enforce, 1 for anything less, 2 for bad input (see --help). Nothing of a server error but its
// SQLSTATE and class is ever printed: a 23505 quotes the colliding key, a group name.
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { pathToFileURL } from "node:url"
import type pg from "pg"
import { printLines, Refused, runTool } from "../shared/run-tool.ts"
import { applyOn, connectClient } from "./contact-group-indexes-apply.ts"
import { planOn } from "./contact-group-indexes-db.ts"
import { HELP } from "./contact-group-indexes-help.ts"
import { allReady, fault, type Options, parseArgs, planCsv, planProse } from "./contact-group-indexes-report.ts"
import { specGateError } from "./contact-group-indexes-spec.ts"
import { withDatabase } from "./query.ts"

const report = (client: pg.PoolClient, opts: Options) =>
  Effect.gen(function* () {
    const targets = yield* planOn(client, opts.limit)
    yield* opts.csv ? Console.log(planCsv(targets)) : printLines(planProse(targets))
    if (!opts.apply) {
      // The state, not the fact that the tool ran, decides the code: a scripted preflight must not read
      // a dry run over a missing index as healthy.
      if (targets.every((t) => t.indexState === "ready")) {
        yield* Console.log("nothing to do -- both indexes are ready")
        return 0
      }
      yield* Console.log("dry run -- rerun with --apply --i-understand")
      return 1
    }
    const { stats, details } = yield* applyOn(client, opts.limit)
    for (const d of details) if (d.detail !== undefined) yield* Console.error(`${d.spec.schema}.${d.spec.table}: ${d.detail}`)
    yield* Console.log(
      `scanned ${stats.scanned} created ${stats.created} exists ${stats.exists} skipped ${stats.skipped} failed ${stats.failed}`,
    )
    if (allReady(stats)) {
      yield* Console.log("both unique indexes are installed and match the cube's declaration")
      return 0
    }
    const unready = details.filter((d) => d.result !== "created" && d.result !== "exists")
    yield* Console.error(
      `NOT enforced: ${unready.map((d) => `${d.spec.schema}.${d.spec.index} (${d.result})`).join(", ")}. ` +
        `crm/contact-groups keeps refusing writes until this run reports created/exists for both.`,
    )
    return 1
  })

// Arguments, then the DECLARATION -- before any URL is read or connection opened: a renderer that does
// not match the running kernel's would inspect with confidence and report wrong -- then the database.
const main = Effect.gen(function* () {
  const opts = yield* parseArgs(process.argv.slice(2))
  if (opts.help) return yield* Effect.as(Console.log(HELP), 0)
  const unrenderable = specGateError()
  if (unrenderable !== null) return yield* new Refused({ message: unrenderable, code: 2 })
  return yield* withDatabase((pool) => Effect.scoped(Effect.flatMap(connectClient(pool), (client) => report(client, opts))))
}).pipe(
  Effect.catchTag("IndexDbFailed", (error) => Effect.as(Console.error(`ensure-contact-group-indexes could not finish (${error.message})`), 1)),
  Effect.catchAllDefect((defect) => Effect.as(Console.error(`ensure-contact-group-indexes could not finish (${fault(defect)})`), 1)),
)

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTool(main)
}
