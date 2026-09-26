// Unit tests for the SDK-check runner's decisions (T-1452, step B4). No Postgres, no kernel, no
// spawn: what is under test is the runner's JUDGMENT -- the shape it stages, the dependency it
// refuses, the environment it derives, and the single path it is allowed to delete.

import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { after, describe, it } from "node:test"

import {
  CANONICAL_TEST,
  CHECK_ENV_KEYS,
  checkEnv,
  copyFilter,
  describeEnv,
  isForeignEntry,
  isOwnSandbox,
  LEGACY_MIGRATIONS,
  MIN_REDACTABLE_SECRET,
  publicationPackageJson,
  redactSecrets,
  SANDBOX_PREFIX,
} from "./sdk-check-lib.mjs"

const NATIVE = {
  name: "qwbe-crm-pack",
  version: "0.0.0",
  private: true,
  type: "module",
  scripts: { test: "node --test cubes/**/*.test.ts", lint: "eslint ." },
  dependencies: { effect: "^3.21.0", "qwbe-core": "file:../../qwbe/core" },
  devDependencies: { typescript: "^5.7.0" },
}

describe("the publication shape the sandbox is given", () => {
  it("replaces the two things the invocation gate judges, and nothing about the checkout", () => {
    const out = publicationPackageJson(NATIVE, "0.0.0")
    assert.equal(out.scripts.test, CANONICAL_TEST)
    assert.equal(out.dependencies["qwbe-core"], "0.0.0")
    // The real SDK version, not a placeholder, and no checkout specifier survives.
    assert.doesNotMatch(JSON.stringify(out.dependencies), /file:|link:|workspace:/)
    // The pack's identity and its other dependencies are untouched.
    assert.equal(out.name, "qwbe-crm-pack")
    assert.equal(out.dependencies.effect, "^3.21.0")
    // The developer scripts are dropped: only the gate's entry remains, so nobody can run the
    // node --test loop against a publication-shaped copy and read the result as either one.
    assert.deepEqual(Object.keys(out.scripts), ["test"])
    assert.equal(out.devDependencies, undefined)
    // The INPUT object is not mutated: the caller reads the checkout's file and must keep it.
    assert.equal(NATIVE.scripts.test, "node --test cubes/**/*.test.ts")
    assert.equal(NATIVE.dependencies["qwbe-core"], "file:../../qwbe/core")
  })

  it("refuses to stage rather than stage something the gate would wrongly pass", () => {
    assert.throws(() => publicationPackageJson(NATIVE, ""), /declares no version/)
    assert.throws(() => publicationPackageJson(NATIVE, undefined), /declares no version/)
    // A second checkout specifier hiding in another field is a refusal, not a silent pass.
    const sneaky = { ...NATIVE, peerDependencies: { "qwbe-core": "link:../../qwbe/core" } }
    assert.throws(() => publicationPackageJson(sneaky, "0.0.0"), /still names a checkout: qwbe-core@link:/)
    const optional = { ...NATIVE, optionalDependencies: { helper: "file:../helper" } }
    assert.throws(() => publicationPackageJson(optional, "0.0.0"), /helper@file:/)
  })
})

describe("what is copied into the sandbox", () => {
  it("treats session artifacts and authoring tooling as foreign", () => {
    for (const foreign of [
      "node_modules",
      "frontend",
      "docs",
      ".git",
      ".playwright-mcp",
      ".t1450-baseline",
      ".local",
      ".githooks",
      "focus-dropdown-admin.png",
      "package-lock.json",
      "trace.zip",
    ])
      assert.equal(isForeignEntry(foreign), true, `${foreign} must not reach the sandbox`)
  })

  it("keeps everything the package actually is", () => {
    for (const own of ["cubes", "probes", "tools", "mappings", "qwbe-package.json", "package.json", "README.md"])
      assert.equal(isForeignEntry(own), false, `${own} must reach the sandbox`)
  })

  it("drops `test/`, which is where THIS runner lives, so it is never package content", () => {
    // The reason the runner moved out of `tools/`. `tools/` reaches the sandbox and, through the
    // kernel's staging filter, an install -- so a script that spawns npm and the kernel bin was
    // becoming part of the installed plugin. `test/` is dropped by both filters.
    assert.equal(isForeignEntry("test"), true)
    const root = `${sep}pack`
    const keep = copyFilter(root)
    for (const file of ["sdk-check.mjs", "sdk-check-lib.mjs", "sdk-check-lib.test.mjs"])
      assert.equal(keep(join(root, "test", file)), false, `test/${file} must not reach the sandbox`)
    // `tools/` genuinely is package content, which is exactly why the runner may not sit there.
    assert.equal(keep(join(root, "tools", "seed-demo.mjs")), true)
  })

  it("the KERNEL's own staging filter drops `test/` too -- checked against its source, not assumed", () => {
    // This runner's filter governs the outer copy only. The predicate that decides what an
    // INSTALL ships is `includePackageSourcePath` in the kernel, via LOCAL_SOURCE_DIRECTORIES.
    // It is not re-exported through `qwbe-core/*`, so the literal is read out of the source: if
    // someone drops `test` from that set, this fails instead of the runner quietly shipping.
    const source = resolve(process.env.QWBE_REPO ?? join(import.meta.dirname, "..", "..", "..", "qwbe"),
      "core", "src", "package-source.ts")
    assert.equal(
      existsSync(source),
      true,
      `cannot verify the kernel staging filter: no ${source} -- set QWBE_REPO to the qwbe checkout`,
    )
    const line = readFileSync(source, "utf8")
      .split("\n")
      .find((l) => l.includes("LOCAL_SOURCE_DIRECTORIES = new Set("))
    assert.ok(line, "package-source.ts no longer declares LOCAL_SOURCE_DIRECTORIES as a literal Set")
    assert.match(line, /"test"/)
  })

  it("filters on the TOP-LEVEL entry only, so a nested docs/ or dotfile still ships", () => {
    const root = `${sep}pack`
    const keep = copyFilter(root)
    assert.equal(keep(root), true)
    assert.equal(keep(join(root, "cubes")), true)
    assert.equal(keep(join(root, "cubes", "crm", "index.ts")), true)
    // A file named like a foreign entry BELOW the root is package content, not session state.
    assert.equal(keep(join(root, "cubes", "crm", "docs", "notes.md")), true)
    assert.equal(keep(join(root, "cubes", "crm", "shot.png")), true)
    assert.equal(keep(join(root, "node_modules")), false)
    assert.equal(keep(join(root, "node_modules", "qwbe-core", "package.json")), false)
    assert.equal(keep(join(root, ".playwright-mcp")), false)
    assert.equal(keep(join(root, "frontend", "src", "app", "page.tsx")), false)
  })
})

describe("the database the checker is pointed at", () => {
  it("derives the admin coordinates and strips every variable naming the live instance", () => {
    const env = checkEnv({
      PATH: "/usr/bin",
      QWBE_DATABASE_URL: "postgres://postgres:secret@127.0.0.1:5434/qwbe",
      QWBE_DATA_DIR: "/home/me/.qwbe/data",
      QWBE_STORE_DIR: "/home/me/.qwbe/store",
      QWBE_PLUGINS_DIR: "/home/me/.qwbe/plugins",
      QWBE_PORT: "4500",
      QWBE_URL: "http://127.0.0.1:4500",
    })
    assert.equal(env.QWBE_PG_HOST, "127.0.0.1")
    assert.equal(env.QWBE_PG_PORT, "5434")
    assert.equal(env.QWBE_PG_USER, "postgres")
    assert.equal(env.QWBE_PG_PASSWORD, "secret")
    // The LIVE database URL must not survive: the checker creates its own qwbe_check_<hex>, and
    // a forwarded URL naming `qwbe` is the one way this runner could touch real data.
    assert.equal(env.QWBE_DATABASE_URL, undefined)
    for (const key of ["QWBE_DATA_DIR", "QWBE_STORE_DIR", "QWBE_PLUGINS_DIR", "QWBE_PORT", "QWBE_URL"])
      assert.equal(env[key], undefined, `${key} must not be forwarded`)
    // Unrelated environment is passed through -- the spawned node still needs a PATH.
    assert.equal(env.PATH, "/usr/bin")
  })

  it("gives the child EXACTLY five QWBE_ variables -- the whitelist is the whole contract", () => {
    // A blacklist only covers the names it was written with. This asserts the set, so adding any
    // sixth variable -- a path, a URL, another operator capability -- fails here first.
    const env = checkEnv({ PATH: "/usr/bin", HOME: "/home/me", QWBE_PG_PASSWORD: "pw-1234" })
    assert.deepEqual(
      Object.keys(env)
        .filter((k) => k.startsWith("QWBE_"))
        .sort(),
      [...CHECK_ENV_KEYS].sort(),
    )
    assert.deepEqual([...CHECK_ENV_KEYS].sort(), [
      "QWBE_LEGACY_MIGRATIONS",
      "QWBE_PG_HOST",
      "QWBE_PG_PASSWORD",
      "QWBE_PG_PORT",
      "QWBE_PG_USER",
    ])
    // No capability, no path, no repo: the four coordinates plus the one authorization.
    assert.equal(CHECK_ENV_KEYS.length, 5)
    assert.equal(env.HOME, "/home/me")
  })

  it("QWBE_REPO from the PARENT cannot leak to the child, whatever the parent exports", () => {
    // The destructive path this closes: the old probes/qwb31-install-lifecycle.mjs (now
    // test/install-lifecycle.mjs, on a scratch root, not run by the checker) called rmSync on
    // `$QWBE_REPO/core/plugins/crm-pack`, the LIVE mounted copy in the kernel checkout, which is
    // gitignored -- a deletion would not even appear in git. Every probes/*.mjs runs as a
    // grandchild of this runner, so the only safe answer is that no QWBE_REPO reaches any of them.
    const env = checkEnv({
      QWBE_PG_PASSWORD: "pw-1234",
      QWBE_REPO: "/home/bogdan/projects/qwbe",
    })
    assert.equal(env.QWBE_REPO, undefined, "QWBE_REPO must never be forwarded to the checker")
    // Unknown QWBE_* names are dropped by the same rule, not by having been listed.
    const future = checkEnv({
      QWBE_PG_PASSWORD: "pw-1234",
      QWBE_REPO: "/home/bogdan/projects/qwbe",
      QWBE_PACKS_DIR: "/home/bogdan/projects/qwbe-plugins",
      QWBE_ALLOW_DESTRUCTIVE: "1",
      QWBE_SOMETHING_INVENTED_TOMORROW: "x",
    })
    for (const key of ["QWBE_REPO", "QWBE_PACKS_DIR", "QWBE_ALLOW_DESTRUCTIVE", "QWBE_SOMETHING_INVENTED_TOMORROW"])
      assert.equal(future[key], undefined, `${key} must not reach the checker`)
  })

  it("pins the operator authorization to its exact string, so a widening is a failing diff", () => {
    // The only capability this runner hands the kernel. It authorizes nothing on the empty
    // throwaway database the CHECKER creates, but it is still an operator vote, and the kernel is
    // explicit that the package under judgment does not get one. Any fourth name, any other
    // plugin, is a deliberate operator decision -- it must break this test to get in.
    assert.equal(LEGACY_MIGRATIONS, "contacts:crm-pack,contracts:crm-pack,crm/accounts:crm-pack")
    const env = checkEnv({ QWBE_PG_PASSWORD: "pw-1234" })
    assert.equal(env.QWBE_LEGACY_MIGRATIONS, LEGACY_MIGRATIONS)
    // Three migrations, each one `<fromCube>:<fromPlugin>`, and crm-pack is the only plugin named.
    const entries = LEGACY_MIGRATIONS.split(",")
    assert.equal(entries.length, 3)
    for (const entry of entries) assert.match(entry, /^[a-z/-]+:crm-pack$/)
    // And it is a LITERAL: the pack's own manifests cannot vote themselves this authorization.
    assert.equal(env.QWBE_LEGACY_MIGRATIONS.includes("$"), false)
  })

  it("prefers the explicit QWBE_PG_* spelling over the URL", () => {
    const env = checkEnv({
      QWBE_DATABASE_URL: "postgres://postgres:secret@127.0.0.1:5434/qwbe",
      QWBE_PG_HOST: "localhost",
      QWBE_PG_PORT: "5433",
      QWBE_PG_USER: "checker",
      QWBE_PG_PASSWORD: "other",
    })
    assert.deepEqual(
      { h: env.QWBE_PG_HOST, p: env.QWBE_PG_PORT, u: env.QWBE_PG_USER, pw: env.QWBE_PG_PASSWORD },
      { h: "localhost", p: "5433", u: "checker", pw: "other" },
    )
  })

  it("has no password default: an unset password is a refusal", () => {
    assert.throws(() => checkEnv({ QWBE_PG_HOST: "127.0.0.1" }), /no password default/)
    assert.throws(() => checkEnv({}), /QWBE_PG_PASSWORD/)
  })

  it("never puts the password in what it prints", () => {
    const env = checkEnv({ QWBE_PG_PASSWORD: "s3cr3t", QWBE_PG_PORT: "5434" })
    const line = describeEnv(env)
    assert.doesNotMatch(line, /s3cr3t/)
    assert.match(line, /postgres@127\.0\.0\.1:5434/)
    assert.match(line, /not logged/)
    // The log names the whole set the child is given, so a widening is visible in the run too.
    assert.match(line, /no QWBE_REPO, no live URL, no live paths/)
    for (const key of CHECK_ENV_KEYS) assert.ok(line.includes(key), `${key} must be named in the log line`)
  })
})

describe("what reaches the terminal", () => {
  it("collapses a scheme://user:password@host credential wherever it appears", () => {
    const out = redactSecrets("connecting to postgres://postgres:s3cr3t-pw@127.0.0.1:5434/qwbe_check_ab", [])
    assert.doesNotMatch(out, /s3cr3t-pw/)
    assert.equal(out, "connecting to postgres://postgres:***@127.0.0.1:5434/qwbe_check_ab")
  })

  it("substitutes the password it was given, in every occurrence, on both streams' text", () => {
    const out = redactSecrets("PGPASSWORD=s3cr3t-pw retry with s3cr3t-pw", ["s3cr3t-pw"])
    assert.equal(out, "PGPASSWORD=*** retry with ***")
  })

  it("is a string filter and says so: a short secret is NOT substituted", () => {
    // A one- or two-character password matches half the output; redacting it would mangle the
    // report rather than protect anything. A declared gap, asserted so it cannot drift silently.
    assert.equal(MIN_REDACTABLE_SECRET, 4)
    assert.equal(redactSecrets("password ab and a table ab_rows", ["ab"]), "password ab and a table ab_rows")
    // And a secret it was never given is not caught -- there is no logger behind this.
    assert.equal(redactSecrets("token=deadbeef", []), "token=deadbeef")
  })

  it("leaves ordinary output, an empty string and a non-string alone", () => {
    assert.equal(redactSecrets("[1/4] source: ok", ["s3cr3t-pw"]), "[1/4] source: ok")
    // A URL with no credentials keeps its shape: http://127.0.0.1:4500 is not a secret.
    assert.equal(redactSecrets("GET http://127.0.0.1:4500/gadgets", []), "GET http://127.0.0.1:4500/gadgets")
    assert.equal(redactSecrets("", ["x"]), "")
    assert.equal(redactSecrets(undefined, ["x"]), undefined)
  })
})

describe("the cleanup guard", () => {
  const made = []
  after(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  })

  it("accepts only a directory carrying this runner's prefix under the OS temp dir", () => {
    const mine = mkdtempSync(join(tmpdir(), SANDBOX_PREFIX))
    made.push(mine)
    assert.equal(isOwnSandbox(mine), true)
    // A file inside it is also inside a sandbox this runner owns.
    assert.equal(isOwnSandbox(join(mine, "cubes")), true)
  })

  it("refuses a foreign temp directory, a checkout, the temp root itself and nonsense", () => {
    const foreign = mkdtempSync(join(tmpdir(), "someone-elses-"))
    made.push(foreign)
    assert.equal(isOwnSandbox(foreign), false)
    assert.equal(isOwnSandbox(tmpdir()), false)
    assert.equal(isOwnSandbox(process.cwd()), false)
    assert.equal(isOwnSandbox(`${sep}`), false)
    assert.equal(isOwnSandbox(join(process.cwd(), SANDBOX_PREFIX + "faked")), false)
    assert.equal(isOwnSandbox(""), false)
    assert.equal(isOwnSandbox(undefined), false)
  })
})
