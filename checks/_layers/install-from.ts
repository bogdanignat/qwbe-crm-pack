import { createHash } from "node:crypto"
import { join } from "node:path"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { PACK } from "./pack-copy.ts"
import { asAdmin, type Session } from "./session.ts"

// What the install-lifecycle checks share: this repo installed through the public install-from
// door, the mounted cube names, and a fingerprint of the tree the installer reads.

/** The cubes this repo's qwbe-package.json declares. */
export const CRM_CUBES = ["crm", "crm/contacts", "crm/contracts", "crm/organizations"]

// The kernel's top-level rule for what install-from leaves out (core/src/package-source.ts,
// isLocalSourceEntry): authoring tooling, hidden entries, local package files, JS test files.
const LOCAL_DIRECTORIES = new Set(["node_modules", "docs", "probes", "test", "frontend", "dist", "build"])
const LOCAL_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json"])
const isLocal = (name: string) =>
  name.startsWith(".") || LOCAL_DIRECTORIES.has(name) || LOCAL_FILES.has(name) || /\.(test|spec)\.(mjs|js|jsx)$/.test(name)

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")

/** sha256 over the sorted (path, file hash) list of every file install-from reads from this repo. */
export const sourceFingerprint = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const top = (yield* fs.readDirectory(PACK)).filter((name) => !isLocal(name))
  const isType = (type: FileSystem.File.Type) => (path: string) =>
    Effect.map(fs.stat(join(PACK, path)), (info) => info.type === type)
  const below = yield* Effect.forEach(yield* Effect.filter(top, isType("Directory")), (name) =>
    Effect.map(fs.readDirectory(join(PACK, name), { recursive: true }), (paths) => paths.map((path) => join(name, path))))
  const files = yield* Effect.filter([...top, ...below.flat()], isType("File"))
  const entries = yield* Effect.forEach(files.sort(), (path) => Effect.map(fs.readFile(join(PACK, path)), (bytes) => [path, sha256(bytes)]))
  return sha256(JSON.stringify(entries))
})

/** The fingerprint taken before the file's first install. */
export class SourceBefore extends Context.Tag("SourceBefore")<SourceBefore, string>() {}

export const sourceBefore = Layer.effect(SourceBefore, sourceFingerprint)

const Cubes = Schema.Array(Schema.Struct({ name: Schema.String }))

/** The CRM cubes /settings/cubes lists, as admin. */
export const mountedCrm = asAdmin.pipe(
  Effect.flatMap((admin) => admin.get("/settings/cubes")),
  Effect.flatMap((reply) => Effect.orDie(Schema.decodeUnknown(Cubes)(reply.body))),
  Effect.map((cubes) => cubes.map(({ name }) => name).filter((name) => CRM_CUBES.includes(name))),
)

export const exists = (...segments: ReadonlyArray<string>) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(join(...segments)))

/** POST /settings/packages/install-from with this repo. */
export const installFrom = (admin: Session) => admin.send("POST", "/settings/packages/install-from", { path: PACK })
