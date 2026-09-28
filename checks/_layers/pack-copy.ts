import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Effect from "effect/Effect"

// This pack as it sits in its own repo, under its manifest name. No rename logic: the pack ships
// exactly what the repo carries, and its qwbe-package.json already names it crm-pack.
export const PACK = fileURLToPath(new URL("../..", import.meta.url))

/**
 * Puts the pack into `pluginsDir/crm-pack`: cubes/ and qwbe-package.json, nothing else. It
 * resolves `qwbe-core` only once mounted under core/plugins, which the workspace plugins
 * directory is.
 */
export const plantCrmPack = (pluginsDir: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.copy(join(PACK, "cubes"), join(pluginsDir, "crm-pack", "cubes")).pipe(
      Effect.zipRight(fs.copy(join(PACK, "qwbe-package.json"), join(pluginsDir, "crm-pack", "qwbe-package.json"))),
    ))
