// The environment the checker is given and what reaches the terminal (T-1452, B4). The whitelist is
// the whole contract: no inherited QWBE_* variable -- the live database, the live paths, QWBE_REPO
// -- reaches the child, and the password never reaches a log line.
import { describe, expect, it } from "@effect/vitest"
import * as Either from "effect/Either"
import { CHECK_ENV_KEYS, checkEnv, describeEnv, MIN_REDACTABLE_SECRET, redactSecrets } from "./sdk-check-env.ts"
import { LEGACY_MIGRATIONS } from "./sdk-check-pure.ts"
import { BuildFailed } from "./sdk-check-run.ts"

const derived = (env: Record<string, string>): Readonly<Record<string, string | undefined>> => Either.getOrThrow(checkEnv(env))

const refusal = (env: Record<string, string>) =>
  Either.match(checkEnv(env), { onLeft: (error) => error.message, onRight: () => "accepted" })

describe("the database the checker is pointed at", () => {
  it("derives the admin coordinates and strips every variable naming the live instance", () => {
    const env = derived({
      PATH: "/usr/bin",
      QWBE_DATABASE_URL: "postgres://postgres:secret@127.0.0.1:5434/qwbe",
      QWBE_DATA_DIR: "/home/me/.qwbe/data",
      QWBE_STORE_DIR: "/home/me/.qwbe/store",
      QWBE_PLUGINS_DIR: "/home/me/.qwbe/plugins",
      QWBE_PORT: "4500",
      QWBE_URL: "http://127.0.0.1:4500",
    })
    expect(env.QWBE_PG_HOST).toBe("127.0.0.1")
    expect(env.QWBE_PG_PORT).toBe("5434")
    expect(env.QWBE_PG_USER).toBe("postgres")
    expect(env.QWBE_PG_PASSWORD).toBe("secret")
    // The LIVE database URL must not survive: a forwarded URL naming `qwbe` is the one way this
    // runner could touch real data.
    expect(env.QWBE_DATABASE_URL).toBeUndefined()
    for (const key of ["QWBE_DATA_DIR", "QWBE_STORE_DIR", "QWBE_PLUGINS_DIR", "QWBE_PORT", "QWBE_URL"])
      expect(env[key], `${key} must not be forwarded`).toBeUndefined()
    // Unrelated environment is passed through -- the spawned node still needs a PATH.
    expect(env.PATH).toBe("/usr/bin")
  })

  it("gives the child EXACTLY five QWBE_ variables -- the whitelist is the whole contract", () => {
    // A blacklist only covers the names it was written with; adding a sixth variable fails here first.
    const env = derived({ PATH: "/usr/bin", HOME: "/home/me", QWBE_PG_PASSWORD: "pw-1234" })
    expect(Object.keys(env).filter((k) => k.startsWith("QWBE_")).sort()).toEqual([...CHECK_ENV_KEYS].sort())
    expect([...CHECK_ENV_KEYS].sort()).toEqual([
      "QWBE_LEGACY_MIGRATIONS",
      "QWBE_PG_HOST",
      "QWBE_PG_PASSWORD",
      "QWBE_PG_PORT",
      "QWBE_PG_USER",
    ])
    expect(CHECK_ENV_KEYS.length).toBe(5)
    expect(env.HOME).toBe("/home/me")
  })

  it("QWBE_REPO from the PARENT cannot leak to the child, whatever the parent exports", () => {
    // The destructive path this closes: an old probe removed `$QWBE_REPO/core/plugins/crm-pack`, the
    // gitignored LIVE mount in the kernel checkout. Every probe runs as a grandchild of this runner.
    const env = derived({ QWBE_PG_PASSWORD: "pw-1234", QWBE_REPO: "/home/bogdan/projects/qwbe" })
    expect(env.QWBE_REPO, "QWBE_REPO must never be forwarded to the checker").toBeUndefined()
    // Unknown QWBE_* names are dropped by the same rule, not by having been listed.
    const future = derived({
      QWBE_PG_PASSWORD: "pw-1234",
      QWBE_REPO: "/home/bogdan/projects/qwbe",
      QWBE_PACKS_DIR: "/home/bogdan/projects/qwbe-plugins",
      QWBE_ALLOW_DESTRUCTIVE: "1",
      QWBE_SOMETHING_INVENTED_TOMORROW: "x",
    })
    for (const key of ["QWBE_REPO", "QWBE_PACKS_DIR", "QWBE_ALLOW_DESTRUCTIVE", "QWBE_SOMETHING_INVENTED_TOMORROW"])
      expect(future[key], `${key} must not reach the checker`).toBeUndefined()
  })

  it("pins the operator authorization to its exact string, so a widening is a failing diff", () => {
    // The only capability this runner hands the kernel; the package under judgment gets no vote.
    expect(LEGACY_MIGRATIONS).toBe("contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack")
    const env = derived({ QWBE_PG_PASSWORD: "pw-1234" })
    expect(env.QWBE_LEGACY_MIGRATIONS).toBe(LEGACY_MIGRATIONS)
    // Three migrations, each one `<fromCube>:<fromPlugin>`, and crm-pack is the only plugin named.
    const entries = LEGACY_MIGRATIONS.split(",")
    expect(entries.length).toBe(3)
    for (const entry of entries) expect(entry).toMatch(/^[a-z/-]+:crm-pack$/)
    // And it is a LITERAL: the pack's own manifests cannot vote themselves this authorization.
    expect(env.QWBE_LEGACY_MIGRATIONS?.includes("$")).toBe(false)
  })

  it("prefers the explicit QWBE_PG_* spelling over the URL", () => {
    const env = derived({
      QWBE_DATABASE_URL: "postgres://postgres:secret@127.0.0.1:5434/qwbe",
      QWBE_PG_HOST: "localhost",
      QWBE_PG_PORT: "5433",
      QWBE_PG_USER: "checker",
      QWBE_PG_PASSWORD: "other",
    })
    expect({ h: env.QWBE_PG_HOST, p: env.QWBE_PG_PORT, u: env.QWBE_PG_USER, pw: env.QWBE_PG_PASSWORD }).toEqual({
      h: "localhost",
      p: "5433",
      u: "checker",
      pw: "other",
    })
  })

  it("has no password default: an unset password is a refusal", () => {
    expect(refusal({ QWBE_PG_HOST: "127.0.0.1" })).toMatch(/no password default/)
    expect(refusal({})).toMatch(/QWBE_PG_PASSWORD/)
  })

  it("never puts the password in what it prints", () => {
    const line = describeEnv(Either.getOrThrow(checkEnv({ QWBE_PG_PASSWORD: "s3cr3t", QWBE_PG_PORT: "5434" })))
    expect(line).not.toMatch(/s3cr3t/)
    expect(line).toMatch(/postgres@127\.0\.0\.1:5434/)
    expect(line).toMatch(/not logged/)
    // The log names the whole set the child is given, so a widening is visible in the run too.
    expect(line).toMatch(/no QWBE_REPO, no live URL, no live paths/)
    for (const key of CHECK_ENV_KEYS) expect(line.includes(key), `${key} must be named in the log line`).toBe(true)
  })
})

describe("what reaches the terminal", () => {
  it("collapses a scheme://user:password@host credential wherever it appears", () => {
    const out = redactSecrets("connecting to postgres://postgres:s3cr3t-pw@127.0.0.1:5434/qwbe_check_ab", [])
    expect(out).not.toMatch(/s3cr3t-pw/)
    expect(out).toBe("connecting to postgres://postgres:***@127.0.0.1:5434/qwbe_check_ab")
  })

  it("substitutes the password it was given, in every occurrence, on both streams' text", () => {
    expect(redactSecrets("PGPASSWORD=s3cr3t-pw retry with s3cr3t-pw", ["s3cr3t-pw"])).toBe("PGPASSWORD=*** retry with ***")
  })

  it("is a string filter and says so: a short secret is NOT substituted", () => {
    // Redacting a two-character password would mangle the report; a declared gap, asserted here.
    expect(MIN_REDACTABLE_SECRET).toBe(4)
    expect(redactSecrets("password ab and a table ab_rows", ["ab"])).toBe("password ab and a table ab_rows")
    // And a secret it was never given is not caught -- there is no logger behind this.
    expect(redactSecrets("token=deadbeef", [])).toBe("token=deadbeef")
  })

  it("covers a failed build's message, which carries npm's whole output", () => {
    const run = { status: 1, signal: undefined, stdout: "PGPASSWORD=s3cr3t-pw\n", stderr: "postgres://u:other-pw@db/x\n" }
    const out = redactSecrets(`\nsdk-check: ${new BuildFailed({ run }).message}`, ["s3cr3t-pw"])
    expect(out).toBe("\nsdk-check: core/dist build failed (exit 1)\nPGPASSWORD=***\npostgres://u:***@db/x\n")
  })

  it("leaves ordinary output, an empty string and a non-string alone", () => {
    expect(redactSecrets("[1/4] source: ok", ["s3cr3t-pw"])).toBe("[1/4] source: ok")
    // A URL with no credentials keeps its shape: http://127.0.0.1:4500 is not a secret.
    expect(redactSecrets("GET http://127.0.0.1:4500/gadgets", [])).toBe("GET http://127.0.0.1:4500/gadgets")
    expect(redactSecrets("", ["x"])).toBe("")
    expect(redactSecrets(undefined as unknown as string, ["x"])).toBeUndefined()
  })
})
