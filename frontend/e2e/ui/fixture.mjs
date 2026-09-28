// An ISOLATED browser fixture for this frontend: the real app, a real Chromium,
// and NOT ONE real backend call.
//
// Why it exists: the access-groups panel's hard parts are all behaviour that no
// pure test can see -- what survives a scope switch, what a dialog left open
// does when the panel under it is replaced, whether an answer that arrives after
// an unmount still speaks, whether a refusal keeps the server's own words. The
// full `npm run e2e` suite can prove those too, but it copies the kernel, starts
// real servers and needs the Orca CLI, so it is not something a change to a
// message can be gated on.
//
// What this never touches, by construction:
//   - no CRM stack is started or stopped, and no port of it is used: the server
//     here is this frontend alone, on an EPHEMERAL port, and 4500 / 4510 / 4520
//     are refused outright (`isForbiddenPort` plus the fixture's own guard).
//   - no database, no qwbe process, no session: every /api/qwbe/** request is
//     answered INSIDE the browser by a route handler (`mockApi`), so the Next
//     proxy route never runs and no token, host or upstream is ever needed.
//   - no `.next`: the build output goes to QWBE_DIST_DIR (.next-ui-fixture), so
//     a running `next dev` and the output of `npm run build` are left alone.
//   - no tracked source file is written: `next build` rewrites the tsconfig it is
//     configured with, so it is pointed at a throwaway copy (QWBE_TSCONFIG) and
//     tsconfig.json itself is never opened for writing. The one generated file
//     Next insists on writing in place, `next-env.d.ts` (gitignored), is put back
//     only if nothing but this build changed it -- and when the build is what
//     created it (a fresh clone has no such file), it is removed again, again
//     only if nothing but this build wrote it.
//
// Playwright and its Chromium are the ones already installed under
// frontend/node_modules; nothing is downloaded.

import { execFileSync, spawn } from "node:child_process"
import { createServer } from "node:net"
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { frontendDir, isForbiddenPort } from "../lib.mjs"

// `playwright` is a declared devDependency of this frontend, pinned to the exact
// version whose Chromium is already on this machine. Imported lazily so the
// failure of a missing install is one sentence instead of a bare module
// resolution error at the top of the file.
async function browserEngine() {
  try {
    return (await import("playwright")).chromium
  } catch (error) {
    throw new Error(
      "the UI fixture needs the `playwright` devDependency and its Chromium in frontend/node_modules " +
        "(`npm install` in frontend/, then `npx playwright install chromium` if the browser is missing). " +
        `Resolution failed: ${String(error)}`,
    )
  }
}

// The fixture's own build directory, relative to the frontend (Next requires a
// path inside the project). Gitignored.
export const DIST_DIR = ".next-ui-fixture"

// The throwaway tsconfig `next build` is pointed at, so it rewrites THAT and not
// the tracked tsconfig.json. A byte copy of the real one, made per run and
// deleted after, so it cannot drift from it. Gitignored, in case a crash between
// the copy and the delete leaves it behind.
const TSCONFIG_FIXTURE = "tsconfig.ui-fixture.json"

// A line of the generated next-env.d.ts that names a build directory's types.
const generatedTypeImport = /^import "\.\/[^"]*\/types\/[^"]*";$/

// The rest of what Next's generator writes into next-env.d.ts, and nothing else:
// its own `next`/`next/...` triple-slash references, its two-line "should not be
// edited" notice, and blank lines. Anything outside this shape (a reference to
// somebody else's types, a hand-written declaration, any other comment) is
// someone's edit, and an edit is never deleted.
const generatedBoilerplate = (line) =>
  line === "" || /^\/\/\/ <reference types="next(\/[^"]*)?" \/>$/.test(line) || /^\/\/ (NOTE:|see )/.test(line)

/**
 * Put the bytes of `next-env.d.ts` back, but ONLY if the build is the only thing
 * that changed them.
 *
 * `next-env.d.ts` is generated, gitignored and stamped "should not be edited",
 * and its contents follow distDir (next/dist/lib/typescript/
 * writeAppTypeDeclarations.js), so building with DIST_DIR necessarily rewrites
 * its two `import "./<distDir>/types/...";` lines. Restoring the snapshot
 * unconditionally would also overwrite anything else that touched the file while
 * the build was running, so the restore is allowed only when every line that
 * differs is one of those generated imports now naming DIST_DIR. Anything else
 * is left exactly as found, and said out loud -- a stale d.ts a `next dev` will
 * regenerate is a smaller loss than a silently discarded edit.
 *
 * Exported for e2e/ui/fixture.test.mjs: this is the one place the fixture writes
 * over a file it did not create, so the rule it applies is tested directly.
 *
 * @param {string} path
 * @param {Buffer} before
 */
export function restoreGeneratedTypeDeclarations(path, before) {
  const after = readFileSync(path)
  if (after.equals(before)) return
  const was = before.toString("utf8").split("\n")
  const now = after.toString("utf8").split("\n")
  const onlyOurBuild =
    was.length === now.length &&
    was.every(
      (line, i) =>
        line === now[i] ||
        (generatedTypeImport.test(line.trim()) &&
          generatedTypeImport.test(now[i].trim()) &&
          now[i].includes(`./${DIST_DIR}/types/`)),
    )
  if (!onlyOurBuild) {
    console.warn(
      `[ui fixture] ${path} changed in ways this build does not explain; leaving it untouched. ` +
        "Its generated type imports may name the fixture's build directory until the next `next dev`/`next build`.",
    )
    return
  }
  writeFileSync(path, before)
}

/**
 * Remove `next-env.d.ts` again, but ONLY if this build is the only thing that
 * ever wrote it.
 *
 * The file is generated and gitignored, so on a fresh clone (or after an
 * `rm -rf`) it does not exist before the build and `next build` is what creates
 * it -- naming DIST_DIR in its type imports, because that is what it was built
 * with. Leaving that behind would plant a file whose imports point at a build
 * directory this fixture deletes, so it is taken away again; but only when every
 * line in it is one the generator writes and every generated import names
 * DIST_DIR. If anything else is in there, someone wrote to the file while the
 * build was running and their lines are worth more than this cleanup, so the
 * file stays and the reason is said out loud.
 *
 * Exported for e2e/ui/fixture.test.mjs, like the restore beside it.
 *
 * @param {string} path
 */
export function discardGeneratedTypeDeclarations(path) {
  // The build may have failed before writing it, or written nothing at all.
  if (!existsSync(path)) return
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
  const ours = lines.filter((line) => generatedTypeImport.test(line))
  const onlyOurBuild =
    ours.length > 0 &&
    ours.every((line) => line.includes(`./${DIST_DIR}/types/`)) &&
    lines.every((line) => generatedTypeImport.test(line) || generatedBoilerplate(line))
  if (!onlyOurBuild) {
    console.warn(
      `[ui fixture] ${path} did not exist before this build, but what is in it now is not only this build's ` +
        "output; leaving the file in place. Delete it by hand if it is unwanted.",
    )
    return
  }
  rmSync(path, { force: true })
}

// The ports of the live CRM stack. `isForbiddenPort` covers the first two; the CRM
// frontend's local port is 4520, and this fixture must never bind any of them.
const forbidden = (port) => isForbiddenPort(port) || port === 4520

async function freePort() {
  for (let i = 0; i < 60; i++) {
    const port = await new Promise((resolve) => {
      const srv = createServer()
      srv.on("error", () => resolve(0))
      srv.listen(0, "127.0.0.1", () => {
        const address = srv.address()
        const chosen = address !== null && typeof address === "object" ? address.port : 0
        srv.close(() => resolve(chosen))
      })
    })
    if (typeof port === "number" && port > 0 && !forbidden(port)) return port
  }
  throw new Error("no free ephemeral port found")
}

// How to invoke npm: when this file runs UNDER npm, `npm_execpath` points at
// npm's own cli.js and must be run with this node; started by hand, plain `npm`
// from PATH is right. Either way no shell is involved.
const npmInvocation = (args) => {
  const execpath = process.env.npm_execpath ?? ""
  return execpath.endsWith(".js")
    ? { command: process.execPath, args: [execpath, ...args] }
    : { command: "npm", args }
}

const runNpm = (args, env) => {
  const { command, args: argv } = npmInvocation(args)
  return execFileSync(command, argv, {
    cwd: frontendDir,
    env: { ...process.env, ...env },
    stdio: "pipe",
    encoding: "utf8",
  })
}

/**
 * Build this frontend into the fixture's own output directory and serve it on an
 * ephemeral port. A production build, not `next dev`: the assertions below are
 * about what the app renders, and a dev server recompiling under the browser
 * turns a real failure into a timeout.
 *
 * @returns {Promise<{ baseUrl: string, port: number, stop: () => void }>}
 */
export async function startFixtureServer() {
  const port = await freePort()
  // QWBE_TSCONFIG is what keeps the TRACKED tsconfig.json out of this entirely.
  // `next build` rewrites the tsconfig it is pointed at -- it adds its distDir's
  // generated type globs to `include` and reformats the file on the way out -- so
  // it is pointed at a byte copy that is deleted afterwards. The real file is
  // never opened for writing, so there is no snapshot of it to restore and no
  // concurrent edit of it that a restore could clobber.
  //
  // `next-env.d.ts` has no such knob (its path is `join(dir, "next-env.d.ts")`,
  // fixed), so it is the one file still written in place, and it is put back
  // under the conditions in `restoreGeneratedTypeDeclarations` -- or removed
  // under those in `discardGeneratedTypeDeclarations`, when the build is what
  // created it.
  const env = { QWBE_DIST_DIR: DIST_DIR, QWBE_TSCONFIG: TSCONFIG_FIXTURE, NODE_ENV: "production" }
  const fixtureTsconfig = join(frontendDir, TSCONFIG_FIXTURE)
  const nextEnvPath = join(frontendDir, "next-env.d.ts")
  // `null` = there was no such file before this build, which is the normal state
  // of a fresh clone: it is generated and gitignored. Then there is no snapshot
  // to put back and the file this build creates is removed instead
  // (`discardGeneratedTypeDeclarations`). Read with `existsSync` rather than a
  // caught ENOENT so a real read failure is still a failure.
  const nextEnvBefore = existsSync(nextEnvPath) ? readFileSync(nextEnvPath) : null
  try {
    copyFileSync(join(frontendDir, "tsconfig.json"), fixtureTsconfig)
    runNpm(["run", "build"], env)
  } finally {
    rmSync(fixtureTsconfig, { force: true })
    // `incremental: true` is inherited from the copy, so tsc may leave a
    // tsbuildinfo next to it under the same base name.
    rmSync(join(frontendDir, "tsconfig.ui-fixture.tsbuildinfo"), { force: true })
    if (nextEnvBefore === null) discardGeneratedTypeDeclarations(nextEnvPath)
    else restoreGeneratedTypeDeclarations(nextEnvPath, nextEnvBefore)
  }
  // The server needs the same distDir to find the build, but NOT the tsconfig
  // knob: `next start` does not configure TypeScript, and passing it would leave
  // a name pointing at a file that no longer exists.
  const serveEnv = { QWBE_DIST_DIR: DIST_DIR, NODE_ENV: "production" }
  const started = npmInvocation(["run", "start", "--", "--port", String(port)])
  const server = spawn(started.command, started.args, {
    cwd: frontendDir,
    env: { ...process.env, ...serveEnv },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  let log = ""
  server.stdout?.on("data", (chunk) => (log += String(chunk)))
  server.stderr?.on("data", (chunk) => (log += String(chunk)))

  const baseUrl = `http://127.0.0.1:${port}`
  const stop = () => {
    // The whole process group: `npm run start` wraps next-server, and killing
    // the wrapper alone leaves the port held.
    try {
      if (server.pid) process.kill(-server.pid, "SIGKILL")
    } catch {
      /* already gone */
    }
  }

  const deadline = Date.now() + 120_000
  for (;;) {
    if (server.exitCode !== null) throw new Error(`fixture server exited (${server.exitCode}):\n${log}`)
    try {
      // /login is the one page the middleware lets through without a cookie.
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" })
      if (response.status < 500) break
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      stop()
      throw new Error(`fixture server did not answer on ${baseUrl}:\n${log}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return { baseUrl, port, stop }
}

export function removeFixtureBuild() {
  rmSync(join(frontendDir, DIST_DIR), { recursive: true, force: true })
}

/**
 * A browser page pointed at the fixture, already carrying a session cookie and
 * already intercepting every API call.
 *
 * The cookie is a STRING, not a session: the middleware only checks that the
 * cookie exists (src/middleware.ts), and the proxy that would use its value is
 * never reached because `mockApi` fulfills the request in the browser.
 *
 * @param {{ baseUrl: string, port: number }} server
 * @param {(request: { method: string, path: string, query: URLSearchParams, body: unknown }) => { status: number, body?: unknown, delayMs?: number } | undefined} answer
 */
export async function openFixture(server, answer) {
  const chromium = await browserEngine()
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: server.baseUrl, viewport: { width: 1280, height: 1400 } })
  await context.addCookies([
    {
      // Cookies are not scoped by port, so the app names the cookie after the
      // request's port (src/lib/session.ts sessionCookieName).
      name: `qwbe_session_${server.port}`,
      value: "ui-fixture-not-a-token",
      domain: "127.0.0.1",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ])
  const page = await context.newPage()
  const seen = []
  await page.route("**/api/qwbe/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/qwbe/, "")
    let body
    const raw = request.postData()
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    const call = { method: request.method(), path, query: url.searchParams, body }
    seen.push({ method: call.method, path, search: url.search, body })
    const reply = answer(call) ?? { status: 404, body: { message: `ui fixture: ${call.method} ${path} is not mocked` } }
    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body ?? null),
    })
  })
  return { browser, context, page, seen, close: () => browser.close() }
}
