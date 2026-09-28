// Where the vtiger export files live and how they are read. No customer-derived file may land
// inside the repository: the default directory is <repo>/.local/vtiger-export (git-ignored),
// QWB50_EXPORT_DIR overrides it (portable default, QWB-68).
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"

export const exportDir = Effect.gen(function* () {
  const path = yield* Path.Path
  const dir = yield* Effect.orDie(Config.option(Config.string("QWB50_EXPORT_DIR")))
  const repoRoot = yield* Effect.orDie(path.fromFileUrl(new URL("../../", import.meta.url)))
  return Option.getOrElse(dir, () => path.join(repoRoot, ".local", "vtiger-export"))
})

/** The lines of a text file, streamed: never the whole file in memory. */
export const fileLines = (file: string) =>
  Stream.unwrap(Effect.map(FileSystem.FileSystem, (fs) => fs.stream(file).pipe(Stream.decodeText(), Stream.splitLines)))

/** `<export dir>/<name>`; the directory is created when missing. */
export const exportFile = (name: string) =>
  Effect.gen(function* () {
    const dir = yield* exportDir
    yield* (yield* FileSystem.FileSystem).makeDirectory(dir, { recursive: true })
    return (yield* Path.Path).join(dir, name)
  })
