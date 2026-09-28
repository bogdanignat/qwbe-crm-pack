import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as Config from "effect/Config"
import type * as ConfigError from "effect/ConfigError"
import * as Effect from "effect/Effect"

// Where the kernel checkout lives. Unlike qwbe's own layers, a pack cannot assume it runs inside
// the kernel repo: QWBE_REPO names the checkout, and the default is the sibling qwbe this pack
// sits next to (../../.. is the repo root, ../../../../ its parent Projects directory).
export const QWBE_REPO: Effect.Effect<string, ConfigError.ConfigError> = Config.string("QWBE_REPO").pipe(
  Config.withDefault(fileURLToPath(new URL("../../../../qwbe", import.meta.url))),
)

/** CORE: the kernel's core directory -- where src/main.ts boots and core/plugins lives. */
export const CORE: Effect.Effect<string, ConfigError.ConfigError> = Effect.map(QWBE_REPO, (repo) => join(repo, "core"))
