import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { test } from "node:test"
import { configuration, preflight } from "./start-local.mjs"
import { controlPath, openControl, requestStop } from "./launcher-control.mjs"

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "crm-start-test-"))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const pack = join(base, "plugins/crm-pack")
  const kernel = join(base, "qwbe")
  const put = (path, content = "{}") => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  put(join(kernel, "web/package.json"), JSON.stringify({ scripts: { dev: "next dev -p 4510" } }))
  // The store has a package manifest; the installed copy contains cube entry points only.
  for (const path of ["scripts/start.mjs", "core/node_modules/effect/package.json", "web/node_modules/next/package.json", "core/plugins/crm-pack/cubes/crm/index.ts"]) put(join(kernel, path))
  put(join(pack, "frontend/node_modules/next/package.json"))
  return { base, pack, kernel, put }
}

async function listener(t) {
  const server = createServer((socket) => socket.end())
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => server.close())
  return server
}

async function freePorts(t) {
  const servers = await Promise.all([listener(t), listener(t), listener(t)])
  const ports = servers.map((server) => server.address().port)
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))))
  return { QWBE_PORT: String(ports[0]), QWBE_WEB_PORT: String(ports[1]), CRM_PORT: String(ports[2]) }
}

test("defaults reflect mother scripts, isolate CRM from Personal Hub and wire both proxies", (t) => {
  const { pack, kernel } = fixture(t)
  const config = configuration(pack, {})
  assert.equal(config.kernel, kernel)
  assert.deepEqual([config.api, config.web, config.crm], [4500, 4510, 4520])
  assert.equal(config.env.QWBE_API_URL, "http://127.0.0.1:4500")
  assert.equal(config.env.NEXT_PUBLIC_QWBE_API, config.env.QWBE_API_URL)
  assert.equal(config.urls.CRM, "http://localhost:4520")
})

test("dotenv precedence and shell overrides work, including paths with spaces", (t) => {
  const { pack, kernel, base, put } = fixture(t)
  const other = join(base, "mother with spaces")
  put(join(other, "web/package.json"), readFileSync(join(kernel, "web/package.json"), "utf8"))
  put(join(other, ".env"), "QWBE_PORT=4600\nQWBE_WEB_PORT=4610\nCRM_PORT=4620\n")
  put(join(pack, ".env"), `QWBE_REPO="${other}"\nQWBE_PORT=4700\nCRM_PORT=4720\n`)
  const config = configuration(pack, { QWBE_PORT: "4800", QWBE_API_URL: "http://stale:99" })
  assert.equal(config.kernel, other)
  assert.deepEqual([config.api, config.web, config.crm], [4800, 4610, 4720])
  assert.equal(config.env.QWBE_API_URL, "http://127.0.0.1:4800")
})

test("reject invalid or duplicate ports without starting anything", (t) => {
  const { pack } = fixture(t)
  for (const value of ["0", "65536", "abc", "4.5", ""]) {
    assert.throws(() => configuration(pack, { CRM_PORT: value }), /port invalid/)
  }
  assert.throws(() => configuration(pack, { CRM_PORT: "4500" }), /porturi diferite/)
})

test("missing installed CRM is actionable, never auto-installs", async (t) => {
  const { pack, kernel } = fixture(t)
  rmSync(join(kernel, "core/plugins/crm-pack/cubes/crm/index.ts"))
  await assert.rejects(preflight(configuration(pack, {})), /instalarea oficială CRM/)
})

test("an occupied port is refused and its existing listener survives", async (t) => {
  const { pack } = fixture(t)
  const busy = await listener(t)
  const env = await freePorts(t)
  env.QWBE_PORT = String(busy.address().port)
  await assert.rejects(preflight(configuration(pack, env)), /ocupat sau indisponibil/)
  assert.ok(busy.listening)
})

test("missing DB configuration and malformed URLs fail without disclosing values", async (t) => {
  const { pack } = fixture(t)
  const ports = await freePorts(t)
  await assert.rejects(preflight(configuration(pack, ports)), /Lipsește QWBE_DATABASE_URL/)
  await assert.rejects(preflight(configuration(pack, { ...ports, QWBE_DATABASE_URL: "invalid-secret" })), (error) => {
    assert.match(error.message, /nu este un URL PostgreSQL valid/)
    assert.ok(!error.message.includes("invalid-secret"))
    return true
  })
})

test("preflight succeeds with a TCP stub; refuses unreachable DB without leaking credentials", async (t) => {
  const { pack } = fixture(t)
  const db = await listener(t)
  const dbPort = db.address().port
  const config = configuration(pack, { ...await freePorts(t), QWBE_DATABASE_URL: `postgres://user:hidden@127.0.0.1:${dbPort}/test` })
  await preflight(config)
  await new Promise((done) => db.close(done))
  await assert.rejects(preflight(config), (error) => {
    assert.match(error.message, /nu este accesibilă/)
    assert.ok(!error.message.includes("hidden"))
    return true
  })
})

async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await delay(30)
  }
  throw new Error(`Timed out: ${label}`)
}

for (const failure of [false, true]) {
  test(`supervisor stops owned processes on ${failure ? "child failure" : "SIGTERM"}`, { timeout: 15000 }, async (t) => {
    const { base } = fixture(t)
    const moduleUrl = new URL("./start-local.mjs", import.meta.url).href
    const ready = join(base, "ready")
    const stopped = join(base, "stopped")
    const childCode = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(ready)},'ready'); process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(stopped)},'stopped');process.exit(0)}); setTimeout(()=>process.exit(9),10000);`
    const specs = [{ name: "CRM stub", command: process.execPath, args: ["-e", childCode], group: true }]
    if (failure) specs.push({ name: "kernel failure stub", command: process.execPath, args: ["-e", `const fs=require('node:fs'); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.exit(7)}},20)`] })
    const script = `import {supervise} from ${JSON.stringify(moduleUrl)}; process.exitCode=await supervise(${JSON.stringify(specs)});`
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "pipe" })
    t.after(() => { if (child.exitCode === null) child.kill("SIGTERM") })
    const exited = once(child, "exit")
    await until(() => existsSync(ready), "child ready")
    if (!failure) child.kill("SIGTERM")
    const [code] = await exited
    assert.equal(code, failure ? 7 : 0)
    assert.ok(existsSync(stopped), "owned CRM process received shutdown")
  })
}

test("stop with no launcher is harmless and does not need DB configuration", async (t) => {
  const { pack } = fixture(t)
  assert.equal(await requestStop(pack), false)
})

test("control socket is private and duplicate launcher does not replace it", async (t) => {
  const { pack } = fixture(t)
  let calls = 0
  const close = await openControl(pack, () => { calls++ })
  try {
    assert.equal(statSync(controlPath(pack)).mode & 0o777, 0o600)
    await assert.rejects(openControl(pack, () => {}), /există deja o instanță/)
    const response = requestStop(pack)
    await until(() => calls === 1, "control request")
    await close()
    assert.equal(await response, true)
    assert.equal(existsSync(controlPath(pack)), false)
  } finally {
    if (existsSync(controlPath(pack))) await close()
  }
})

test("stop via control socket waits for child shutdown and is repeatable", { timeout: 15000 }, async (t) => {
  const { pack, base } = fixture(t)
  const ready = join(base, "ready")
  const stopped = join(base, "stopped")
  const childCode = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(ready)},'ready'); process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(stopped)},'stopped');process.exit(0)},150)); setTimeout(()=>process.exit(9),10000);`
  const specs = [{ name: "owned stub", command: process.execPath, args: ["-e", childCode], group: true }]
  const script = `import {supervise} from ${JSON.stringify(new URL("./start-local.mjs", import.meta.url).href)}; import {openControl} from ${JSON.stringify(new URL("./launcher-control.mjs", import.meta.url).href)}; const controller=new AbortController(); const close=await openControl(${JSON.stringify(pack)},()=>controller.abort()); try {process.exitCode=await supervise(${JSON.stringify(specs)},controller.signal)} finally {await close()}`
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "pipe" })
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM") })
  const exited = once(child, "exit")
  await until(() => existsSync(ready), "child ready")
  assert.equal(await requestStop(pack), true)
  assert.ok(existsSync(stopped), "acknowledged only after owned child stopped")
  assert.equal((await exited)[0], 0)
  assert.equal(await requestStop(pack), false)
})
