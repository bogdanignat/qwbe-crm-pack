// crm/contact-groups' declared unique indexes, checked and rendered: the DDL, and the catalog form
// `pg_get_indexdef` must read back. A second renderer of the kernel's (core/src/pg-index/unique-index.ts),
// so the declaration is INPUT: a shape this file cannot render is refused (exit 2), never guessed --
// an unknown `normalize` once fell into `plain` and a green tool reported `created` over a cube whose
// gate then refused every write.
import * as Data from "effect/Data"
import * as Either from "effect/Either"
// The DECLARATION only, from the cube's runtime-neutral leaf: it imports nothing but TYPES, so nothing
// of `effect` or `qwbe-core` is loaded through it. A hard requirement, not tidiness: in an installed
// layout `qwbe-core` resolves inside `node_modules`, where node refuses to strip types from a `.ts`
// file, so importing the cube's service module made this tool die on its import line in precisely the
// incident it exists for (see cubes/crm/contact-groups/invariant.ts).
import { SCHEMA, UNIQUE_INDEXES } from "../../cubes/crm/contact-groups/invariant.ts"

export interface IndexKey { readonly body: string; readonly normalize?: "plain" | "lower-btrim" }
interface Declared { readonly table: string; readonly index: string; readonly keys: ReadonlyArray<IndexKey> }
/** One declaration resolved for this pack's schema, both SQL strings rendered from its keys. */
export interface Target extends Declared { readonly schema: string; readonly on: string; readonly where: string; readonly def: string }

export class SpecUnrenderable extends Data.TaggedError("SpecUnrenderable")<{ readonly message: string }> {}

export const qi = (identifier: string): string => `"` + identifier.replace(/"/g, `""`) + `"`

/** The only predicate a declaration may carry (`rows: "active"`). */
const ACTIVE_ROWS = "deleted = false"
// The kernel's `assertRenderable`, restated (it cannot be imported, see above); also the interpolation
// guard: every identifier and quoted literal that reaches the DDL has passed these.
const SAFE_RELATION = /^[a-z][a-z0-9_]{0,62}$/
/** Letters, digits, underscore: the rendered literal holds no quote. CASE IS PART OF THE KEY. */
const SAFE_BODY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,62}$/
/** The schema is DERIVED from the cube name, so it is that alphabet plus `-`. */
const SAFE_SCHEMA = /^[a-z][a-z0-9-]{0,62}$/
const MAX_KEYS = 8
const RENDERABLE: ReadonlyArray<unknown> = [undefined, "plain", "lower-btrim"]

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null
const safe = (value: unknown, shape: RegExp) => typeof value === "string" && shape.test(value)

/** What this tool cannot render about one declared spec, as a sentence, or `null` when it can. */
export const specProblem = (spec: unknown): string | null => {
  if (!isRecord(spec)) return `a declaration is not an object`
  const where = `${String(spec.index ?? "?")} on ${String(spec.table ?? "?")}`
  if (!safe(spec.index, SAFE_RELATION)) return `${where}: the index name is not a safe identifier`
  if (!safe(spec.table, SAFE_RELATION)) return `${where}: the table name is not a safe identifier`
  if (!SAFE_SCHEMA.test(SCHEMA)) return `${where}: the derived schema ${JSON.stringify(SCHEMA)} is not a cube schema`
  if (spec.rows !== "active") {
    return `${where}: rows ${JSON.stringify(spec.rows)} -- this tool renders only "active" (WHERE ${ACTIVE_ROWS})`
  }
  if (!Array.isArray(spec.keys) || spec.keys.length === 0 || spec.keys.length > MAX_KEYS) {
    return `${where}: the key list must hold between 1 and ${MAX_KEYS} entries`
  }
  for (const key of spec.keys as ReadonlyArray<unknown>) {
    if (!isRecord(key) || !safe(key.body, SAFE_BODY_KEY)) return `${where}: a key's \`body\` field is not a safe JSON key`
    if (!RENDERABLE.includes(key.normalize)) {
      return `${where}: key ${JSON.stringify(key.body)} declares normalize ${JSON.stringify(key.normalize)}, ` +
        `which this tool cannot render (known: plain, lower-btrim)`
    }
  }
  return null
}

/** Everything the declaration asks for that this file cannot render; empty is the healthy state. */
export const SPEC_PROBLEMS: ReadonlyArray<string> = UNIQUE_INDEXES.map(specProblem).filter((p): p is string => p !== null)

/** The operator's sentence for a declaration this tool does not understand, or `null`. */
export const specGateError = (problems: ReadonlyArray<string> = SPEC_PROBLEMS): string | null =>
  problems.length === 0
    ? null
    : `refusing to render the cube's declaration: ${problems.join("; ")}. ` +
      `This tool renders the SQL for crm/contact-groups' declared unique indexes itself and the ` +
      `declaration has moved past it -- teach it the new shape (and test it against a real ` +
      `server) before running it; nothing was inspected.`

const keySql = (key: IndexKey) => (key.normalize === "lower-btrim" ? `lower(btrim(body->>'${key.body}'))` : `(body->>'${key.body}')`)
// As `pg_get_indexdef` renders it, normalized: an expression key gets its own parentheses, a function
// call does not (PostgreSQL 16; the DB test asserts it on a real server every run).
const keyDef = (key: IndexKey) => (key.normalize === "lower-btrim" ? `lower(btrim((body->>'${key.body}')))` : `((body->>'${key.body}'))`)

/** Resolves one declaration; refuses at the render boundary too, for a caller that skipped the gate. */
export const resolveSpec = (spec: unknown): Either.Either<Target, SpecUnrenderable> => {
  const problem = specProblem(spec)
  if (problem !== null) return Either.left(new SpecUnrenderable({ message: `cannot render a unique index declaration: ${problem}` }))
  const { table, index, keys } = spec as Declared
  return Either.right({
    schema: SCHEMA, table, index, keys,
    on: `(${keys.map(keySql).join(", ")})`,
    where: ACTIVE_ROWS,
    def: `createuniqueindex${index}on${SCHEMA}.${table}usingbtree(${keys.map(keyDef).join(",")})where(deleted=false)`,
  })
}

/** The declaration, resolved, in declaration order. EMPTY when `SPEC_PROBLEMS` is not: importing this
 *  module never throws, and the entry refuses with exit 2 before a target is used. */
export const TARGETS: ReadonlyArray<Target> =
  SPEC_PROBLEMS.length === 0 ? Either.getOrElse(Either.all(UNIQUE_INDEXES.map(resolveSpec)), () => []) : []

/** Whitespace, quoting and `::text` are formatting; SINGLE-QUOTED LITERALS are the definition and stay
 *  as the catalog renders them -- `'groupid'` for `'groupId'` is an index that enforces nothing. */
export const normalizeIndexDef = (def: string): string =>
  def
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/::text/g, "").replace(/[\s"]/g, "").toLowerCase()))
    .join("")

/** The DDL for one target. `IF NOT EXISTS` is NAME-based, which is why the definition is checked apart. */
export const indexSql = (s: Target): string =>
  `CREATE UNIQUE INDEX IF NOT EXISTS ${qi(s.index)} ON ${qi(s.schema)}.${qi(s.table)} ${s.on} WHERE ${s.where}`
