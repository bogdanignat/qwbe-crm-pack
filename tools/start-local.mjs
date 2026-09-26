#!/usr/bin/env node
// Local orchestration only: the mother's runner owns its API/web lifecycle.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"
import { openControl } from "./launcher-control.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const readEnv = (path) => existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}
const readPackage = (path) => JSON.parse(readFileSync(path, "utf8"))

function port(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name}: port invalid (1–65535).`)
  }
  return Number(value)
}

export function configuration(pack = root, inherited = process.env) {
  const local = readEnv(join(pack, ".env"))
  const kernel = resolve(pack, inherited.QWBE_REPO ?? local.QWBE_REPO ?? "../../qwbe")
  const env = { ...readEnv(join(kernel, ".env")), ...local, ...inherited }
  const webDev = readPackage(join(kernel, "web/package.json")).scripts.dev
  const webDefault = webDev.match(/(?:-p|--port)[= ](\d+)/)?.[1]
  const api = port(env.QWBE_PORT ?? 4500, "QWBE_PORT")
  const web = port(env.QWBE_WEB_PORT ?? webDefault, "QWBE_WEB_PORT")
  // 3000 is used by Personal Hub on this workstation. No silent Next port fallback.
  const crm = port(env.CRM_PORT ?? 4520, "CRM_PORT")
  if (new Set([api, web, crm]).size !== 3) throw new Error("API, mamă și CRM trebuie să aibă porturi diferite.")
  const apiUrl = `http://127.0.0.1:${api}`
  return {
    pack, kernel, api, web, crm,
    env: {
      ...env,
      QWBE_PORT: String(api), QWBE_WEB_PORT: String(web),
      NEXT_PUBLIC_QWBE_API: apiUrl, QWBE_API_URL: apiUrl,
    },
    urls: { "Mamă qwbe": `http://localhost:${web}`, CRM: `http://localhost:${crm}`, API: apiUrl, Swagger: `${apiUrl}/docs` },
  }
}

async function assertFree(portNumber) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", () => reject(new Error(`Portul ${portNumber} este ocupat sau indisponibil. Nu am pornit nimic; nu opresc procese existente.`)))
    server.listen(portNumber, "127.0.0.1", () => server.close(resolve))
  })
}

async function assertDatabase(value) {
  if (!value) throw new Error("Lipsește QWBE_DATABASE_URL. Configurează .env în qwbe sau crm-pack (model: qwbe/.env.example), apoi pornește baza qwbe cu npm run db:up din repo-ul mamei.")
  let database
  try {
    database = new URL(value)
    if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error()
  } catch {
    throw new Error("QWBE_DATABASE_URL nu este un URL PostgreSQL valid (valoarea nu este afișată).")
  }
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: database.hostname.replace(/^\[|\]$/g, ""), port: Number(database.port || 5432) })
    const fail = () => {
      socket.destroy()
      reject(new Error("Baza qwbe nu este accesibilă prin TCP. Verifică QWBE_DATABASE_URL și pornește baza; pentru compose-ul local: npm run db:up din repo-ul qwbe."))
    }
    socket.setTimeout(2000, fail)
    socket.once("error", fail)
    socket.once("connect", () => { socket.destroy(); resolve() })
  })
}

export async function preflight(config) {
  if (process.platform === "win32") throw new Error("Launcher-ul local necesită Linux/macOS (process groups).")
  const paths = [
    join(config.kernel, "scripts/start.mjs"),
    join(config.kernel, "core/node_modules/effect/package.json"),
    join(config.kernel, "web/node_modules/next/package.json"),
    join(config.pack, "frontend/node_modules/next/package.json"),
    join(config.kernel, "core/plugins/crm-pack/cubes/crm/index.ts"),
  ]
  for (const path of paths) {
    if (!existsSync(path)) throw new Error(`Lipsește ${path}. Verifică setup-ul și instalarea oficială CRM; launcher-ul nu instalează și nu copiază pachete.`)
  }
  for (const number of [config.api, config.web, config.crm]) await assertFree(number)
  await assertDatabase(config.env.QWBE_DATABASE_URL)
}

export function supervise(specs, abortSignal) {
  return new Promise((resolve) => {
    const children = []
    const listeners = []
    let stopping = false
    const signal = (entry, name) => {
      if (!entry.child.pid) return
      try {
        // The kernel creates its OWN groups; signal its runner, which cleans them up.
        if (entry.group) process.kill(-entry.child.pid, name)
        else if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill(name)
      } catch { /* already stopped */ }
    }
    const stop = async (code) => {
      if (stopping) return
      stopping = true
      console.log("\nOprire mamă + CRM…")
      for (const entry of children) signal(entry, "SIGTERM")
      let timer
      await Promise.race([
        Promise.all(children.map((entry) => entry.closed)),
        new Promise((done) => { timer = setTimeout(done, 7000) }),
      ])
      clearTimeout(timer)
      for (const entry of children) signal(entry, "SIGKILL")
      for (const [name, listener] of listeners) process.off(name, listener)
      abortSignal?.removeEventListener("abort", abortListener)
      resolve(code)
    }
    const abortListener = () => { void stop(0) }
    abortSignal?.addEventListener("abort", abortListener, { once: true })
    if (abortSignal?.aborted) { void stop(0); return }
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const listener = () => { void stop(0) }
      listeners.push([name, listener])
      process.on(name, listener)
    }
    for (const spec of specs) {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd, env: spec.env, detached: spec.group ?? false, stdio: "inherit",
      })
      const entry = { child, group: spec.group, closed: new Promise((done) => child.once("close", done)) }
      children.push(entry)
      child.once("error", () => {
        console.error(`${spec.name}: procesul nu a putut porni.`)
        void stop(1)
      })
      child.once("exit", (code, exitSignal) => {
        if (stopping) return
        console.error(`${spec.name} s-a oprit (${exitSignal ?? code}); opresc și restul.`)
        void stop(code || 1)
      })
    }
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log("npm start | npm stop | npm run start:check\nConfig: QWBE_REPO, QWBE_PORT, QWBE_WEB_PORT, CRM_PORT, QWBE_DATABASE_URL.\nÎncarcă qwbe/.env, apoi crm-pack/.env; mediul shell are prioritate.\nNu instalează pachete, nu pornește/oprește baza și nu rulează comenzi de migrare.")
    return
  }
  if (args.some((arg) => arg !== "--check")) throw new Error("Argument necunoscut. Folosește --help sau --check.")
  const config = configuration()
  console.log("Adrese locale după pornire (pe această mașină):")
  for (const [name, url] of Object.entries(config.urls)) console.log(`  ${name}: ${url}`)
  await preflight(config)
  console.log("Preflight OK: porturi libere, dependințe și pachet CRM prezente, DB accesibilă TCP (autentificarea este verificată de kernel).")
  if (args.includes("--check")) return
  const controller = new AbortController()
  const closeControl = await openControl(config.pack, () => controller.abort())
  try {
    console.log("Pornesc serviciile; așteaptă mesajele Ready din loguri. Ctrl+C sau npm stop oprește mama și CRM, nu baza.\n")
    process.exitCode = await supervise([
      { name: "qwbe", command: process.execPath, args: ["scripts/start.mjs"], cwd: config.kernel, env: config.env },
      { name: "CRM", command: "npm", args: ["run", "dev", "--", "--port", String(config.crm)], cwd: join(config.pack, "frontend"), env: config.env, group: true },
    ], controller.signal)
  } finally {
    await closeControl()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`\nPornire refuzată: ${error.message}`); process.exitCode = 1 })
}
