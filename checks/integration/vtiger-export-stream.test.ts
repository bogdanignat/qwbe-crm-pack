// vtiger exporter streams rows through query().stream() (fixture DB).
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const here = new URL(".", import.meta.url)
// The mock MariaDB is spawned from the repo root: mysql2 must resolve from THIS
// checkout's node_modules, not from wherever vitest happens to run.
const repoRoot = new URL("../..", import.meta.url).pathname
const tool = new URL("../../tools/vtiger/vtiger-export.ts", here).pathname

const rows = [
  { vtigerId: 980001, accountid: 980001, account_no: "FIX-DB-1", accountname: "Fixture Db One SRL", employees: 4 },
  { vtigerId: 980002, accountid: 980002, account_no: "FIX-DB-2", accountname: "Fixture Db Two SRL", employees: null },
  { vtigerId: 980003, accountid: 980003, account_no: "FIX-DB-3", accountname: "Fixture Db Three SRL", employees: 9 },
]

// The mock MariaDB lives in its own process (execFileSync blocks this one's event loop).
const MOCK = `const mysql = require("mysql2")
const rows = ${JSON.stringify(rows)}
const srv = mysql.createServer((conn) => {
  conn.serverHandshake({
    protocolVersion: 10,
    serverVersion: "5.7.10-mock",
    connectionId: 1,
    statusFlags: 2,
    capabilityFlags: 0xffffff,
    characterSet: 8,
    authPluginDataLength: 0,
    authPluginName: "mysql_native_password",
  })
  // The server-side mock keeps the handshake sequence number across the command phase,
  // which desyncs the client; real MariaDB resets to 0 after every command.
  const handlePacket = conn.handlePacket.bind(conn)
  conn.handlePacket = (packet) => {
    handlePacket(packet)
    conn._resetSequenceId()
  }
  conn.on("query", (query) => {
    const col = (n) => ({ name: n, orgName: n, catalog: "def", schema: "fixture", table: "t", orgTable: "t", characterSet: 45, columnLength: 64, columnType: 253, flags: 0, decimals: 0 })
    if (query.startsWith("SHOW COLUMNS")) {
      conn.writeTextResult([{ Field: "accountid" }, { Field: "cf_638" }], [col("Field"), col("Type")])
    } else if (query.startsWith("SELECT COUNT")) {
      conn.writeTextResult([{ n: String(rows.length) }], [col("n")])
    } else {
      conn.writeTextResult(rows, [col("vtigerId"), col("accountid"), col("account_no"), col("accountname"), col("employees")])
    }
  })
})
srv.listen(0, "127.0.0.1", () => console.log(srv._server.address().port))`

/** The mock server, killed when the scope ends. */
const mockDb = Effect.acquireRelease(
  Effect.sync(() => spawn(process.execPath, ["-e", MOCK], { stdio: ["ignore", "pipe", "ignore"], cwd: repoRoot })),
  (mock) => Effect.sync(() => mock.kill("SIGKILL")),
)

/** A fresh export directory, removed when the scope ends. */
const exportDir = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "qwb50-export-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
)

/** The port the mock prints once it listens. */
const portOf = (mock: ChildProcess) =>
  Effect.tryPromise(() =>
    new Promise<string>((resolve, reject) => {
      mock.stdout!.setEncoding("utf8")
      mock.stdout!.on("data", (d: string) => resolve(d.trim()))
      mock.on("exit", (c: number | null) => reject(new Error(`mock db died: ${c}`)))
      setTimeout(() => reject(new Error("mock db did not start")), 5000).unref()
    }))

/** `vtiger-export.ts accounts --write` against the mock: exit status and stdout+stderr. */
const exportAccounts = (port: string, outDir: string) =>
  Effect.tryPromise(() =>
    new Promise<{ status: number | null; out: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [tool, "accounts", "--write"], {
        env: {
          ...process.env,
          VTIGER_DB_HOST: "127.0.0.1",
          VTIGER_DB_PORT: port,
          VTIGER_DB_USER: "fixture",
          VTIGER_DB_PASSWORD: "fixture",
          VTIGER_DB_NAME: "fixture",
          QWB50_EXPORT_DIR: outDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let out = ""
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (d: string) => (out += d))
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (d: string) => (out += d))
      child.on("error", reject)
      child.on("exit", (status) => resolve({ status, out }))
    }))

it.scoped(
  "writes one JSONL line per row and never buffers the result set",
  () =>
    Effect.gen(function* () {
      const mock = yield* mockDb
      const outDir = yield* exportDir
      const { status, out } = yield* exportAccounts(yield* portOf(mock), outDir)
      expect(status).toBe(0)
      expect(out).toMatch(/rows:\s+3/)
      const lines = readFileSync(join(outDir, "accounts.jsonl"), "utf8").trim().split("\n")
      expect(lines).toHaveLength(3)
      // the text protocol returns every column as a string -- the shape, not the types,
      // is what this test proves
      const third: unknown = JSON.parse(lines[2]!)
      expect(third).toEqual({
        vtigerId: "980003", accountid: "980003", account_no: "FIX-DB-3", accountname: "Fixture Db Three SRL", employees: "9",
      })
    }),
  { timeout: 30_000 },
)
