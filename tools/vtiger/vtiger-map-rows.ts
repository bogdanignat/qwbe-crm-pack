// The row loop of the vtiger import: each JSONL line is planned (vtiger-map-plan.ts), then written
// by external identity (vtiger-map-api.ts). Every outcome lands in a Ref'd tally; a per-row
// failure is a RowFailed that counts as an error (the first message kept) and never stops the
// run. A transport failure does stop it.
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import type { Session } from "../shared/api-client.ts"
import { findId, upsert } from "./vtiger-map-api.ts"
import { planRow } from "./vtiger-map-plan.ts"
import { bump, emptyTally, failed, type MapFile, type Tally } from "./vtiger-map-pure.ts"

/** vtiger accountid -> qwbe organization id (none = looked up, not there); this run only. */
type OrgCache = Ref.Ref<HashMap.HashMap<string, Option.Option<string>>>

const organization = (s: Session, orgs: OrgCache, key: string) =>
  Effect.gen(function* () {
    const cached = HashMap.get(yield* Ref.get(orgs), key)
    if (Option.isSome(cached)) return cached.value
    const id = yield* findId(s, "/organizations", `vtiger:${key}`, "resolve organization", "resolve organization")
    yield* Ref.update(orgs, HashMap.set(key, id))
    return id
  })

// A failed lookup is not "missing": the contact is not imported, a rerun decides it again.
const organizationId = (s: Session, orgs: OrgCache, tally: Ref.Ref<Tally>, key: Option.Option<string>) =>
  Option.match(key, {
    onNone: () => Effect.as(Ref.update(tally, bump("noOrg")), null),
    onSome: (k) =>
      Effect.flatMap(organization(s, orgs, k), Option.match({
        // Counted, never quoted: a vtiger id is re-identifiable against the source DB.
        onNone: () => Effect.as(Ref.update(tally, bump("missingOrg")), null),
        onSome: (id) => Effect.succeed<string | null>(id),
      })),
  })

const importRow = (s: Session, m: MapFile, tally: Ref.Ref<Tally>, orgs: OrgCache) => (line: string) => {
  const plan = planRow(line, m)
  switch (plan._tag) {
    case "Blank":
      return Effect.void
    case "Broken":
      return Ref.update(tally, failed())
    case "Skipped":
      return Ref.update(tally, (t) => bump(plan.counter)(bump("seen")(t)))
    case "Write":
      return Effect.gen(function* () {
        yield* Ref.update(tally, bump("seen"))
        const payload = plan.orgKey === undefined
          ? plan.payload
          : { ...plan.payload, organizationId: yield* organizationId(s, orgs, tally, plan.orgKey) }
        yield* Ref.update(tally, bump(yield* upsert(s, m, plan.externalId, payload)))
      }).pipe(Effect.catchTag("RowFailed", (e) => Ref.update(tally, failed(e.message))))
  }
}

export const importRows = <E, R>(s: Session, m: MapFile, lines: Stream.Stream<string, E, R>) =>
  Effect.gen(function* () {
    const tally = yield* Ref.make(emptyTally)
    const orgs: OrgCache = yield* Ref.make(HashMap.empty<string, Option.Option<string>>())
    yield* Stream.runForEach(lines, importRow(s, m, tally, orgs))
    return yield* Ref.get(tally)
  })
