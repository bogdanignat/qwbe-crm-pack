// The environment the `qwbe check` child gets, and what the runner may print about it (T-1452, B4).
//
// A WHITELIST, not a filter. The child is a kernel that boots the pack and runs its probes; probes
// once read QWBE_REPO and removed paths under it (the gitignored LIVE mount in the kernel checkout).
// A blacklist only covers the names it was written with, so every inherited QWBE_* variable is
// dropped -- QWBE_DATABASE_URL naming the live database, data/store/plugins dirs, ports, QWBE_REPO --
// and exactly CHECK_ENV_KEYS are written back. QWBE_REPO stays an input of the runner itself.
// Non-QWBE_ variables pass through: the spawned node still needs PATH and HOME.
import * as Data from "effect/Data"
import * as Either from "effect/Either"
import { LEGACY_MIGRATIONS } from "./sdk-check-pure.ts"

/** The whole list: the four admin coordinates the checker needs to CREATE its own throwaway
 *  database (check-package.ts, adminUrl) and the one operator authorization. */
export const CHECK_ENV_KEYS = Object.freeze([
  "QWBE_PG_HOST",
  "QWBE_PG_PORT",
  "QWBE_PG_USER",
  "QWBE_PG_PASSWORD",
  "QWBE_LEGACY_MIGRATIONS",
] as const)

export type CheckEnv = Readonly<Record<string, string>> & { readonly [K in (typeof CHECK_ENV_KEYS)[number]]: string }

export class CheckEnvRefused extends Data.TaggedError("CheckEnvRefused")<{ readonly message: string }> {}

const refused = (message: string) => Either.left(new CheckEnvRefused({ message }))

const parseUrl = (text: string | undefined): Either.Either<URL | undefined, CheckEnvRefused> => {
  if (!text) return Either.right(undefined)
  // The URL itself is never quoted back: it carries the password.
  return URL.canParse(text) ? Either.right(new URL(text)) : refused("QWBE_DATABASE_URL is not a valid URL")
}

/**
 * The admin coordinates come from the explicit QWBE_PG_* spelling first, else from
 * QWBE_DATABASE_URL (its host, port and user, never its database name; the password only as a
 * fallback). No password default: an unset password is a refusal, never a guess.
 */
export const checkEnv = (env: Readonly<Record<string, string | undefined>>): Either.Either<CheckEnv, CheckEnvRefused> =>
  Either.flatMap(parseUrl(env.QWBE_DATABASE_URL), (url) => {
    const password = env.QWBE_PG_PASSWORD ?? url?.password
    if (!password)
      return refused("set QWBE_PG_PASSWORD (or QWBE_DATABASE_URL) for the throwaway check database -- there is no password default")
    const inherited = Object.entries(env).filter(
      (entry): entry is [string, string] => !entry[0].startsWith("QWBE_") && entry[1] !== undefined,
    )
    return Either.right({
      ...Object.fromEntries(inherited),
      QWBE_PG_HOST: env.QWBE_PG_HOST ?? url?.hostname ?? "127.0.0.1",
      QWBE_PG_PORT: env.QWBE_PG_PORT ?? (url?.port || "5433"),
      QWBE_PG_USER: env.QWBE_PG_USER ?? (url?.username || "postgres"),
      QWBE_PG_PASSWORD: password,
      QWBE_LEGACY_MIGRATIONS: LEGACY_MIGRATIONS,
    })
  })

/** A `scheme://user:password@host` credential in any text the runner relays. */
const CREDENTIAL_URL = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]*@/gi

/** Secrets shorter than this are NOT substituted: a one- or two-character password matches half the
 *  output and redacting it would mangle the report. A documented gap (docs/t1452-sdk-check-report.md). */
export const MIN_REDACTABLE_SECRET = 4

/**
 * The filter between the checker's output and the terminal: any credential URL collapses to
 * `scheme://user:***@host` and each given secret is substituted. A string filter, not a logger: it
 * cannot catch a secret it was not given. Apply it to the WHOLE captured text, never per chunk --
 * a secret split across two chunks would pass both.
 */
export const redactSecrets = (text: string, secrets: ReadonlyArray<string> = []) => {
  if (typeof text !== "string" || text.length === 0) return text
  return secrets
    .filter((secret) => typeof secret === "string" && secret.length >= MIN_REDACTABLE_SECRET)
    .reduce((out, secret) => out.split(secret).join("***"), text.replace(CREDENTIAL_URL, "$1:***@"))
}

/** What may be printed about the connection: everything but the password, and the names the child gets. */
export const describeEnv = (env: CheckEnv) =>
  `postgres ${env.QWBE_PG_USER}@${env.QWBE_PG_HOST}:${env.QWBE_PG_PORT} (password from the environment, not logged); ` +
  `QWBE_LEGACY_MIGRATIONS=${env.QWBE_LEGACY_MIGRATIONS} (operator authorization for the EMPTY throwaway database only); ` +
  `the child's QWBE_* environment is exactly ${CHECK_ENV_KEYS.join(", ")} -- no QWBE_REPO, no live URL, no live paths`
