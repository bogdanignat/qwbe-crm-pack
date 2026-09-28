// Error output carries no customer values (review items 1-3, 8).
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const here = new URL(".", import.meta.url)
const accountsFixture = JSON.parse(
  readFileSync(new URL("../_fixtures/vtiger/accounts.fixture.json", here).pathname, "utf8"),
) as ReadonlyArray<Record<string, unknown>>

const tool = new URL("../../tools/vtiger/vtiger-to-staging.ts", here).pathname

// The mock server must live in its own process: execFileSync blocks this process's
// event loop, so an in-process server could never answer the tool. It answers the
// login and set creation, then rejects every chunk with a 400 that echoes the chunk
// text back -- the tool must print the status, not the chunk.
const MOCK = `const http = require("node:http")
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.url === "/auth/login") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ token: "test-token", expiresAt: 9 })) }
    else if (req.url === "/staging/sets") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id: "set-mock-1" })) }
    else { res.statusCode = 400; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "chunk rejected: " + b })) }
  })
})
srv.listen(0, "127.0.0.1", () => console.log(srv.address().port))`

const portOf = (mock: ChildProcess) =>
  new Promise<string>((resolve, reject) => {
    mock.stdout!.setEncoding("utf8")
    mock.stdout!.on("data", (d: string) => resolve(d.trim()))
    mock.on("exit", (c: number | null) => reject(new Error(`mock died: ${c}`)))
    setTimeout(() => reject(new Error("mock did not start")), 5000).unref()
  })

// Runs the tool and collects stdout+stderr; resolves with the exit status.
const runTool = (args: ReadonlyArray<string>, env: Record<string, string>) =>
  new Promise<{ out: string; status: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        QWB50_TEST_UNSAFE_INPUT: "1",
        QWBE_USER: "admin",
        QWBE_PASSWORD: "admin",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    child.stdout!.setEncoding("utf8")
    child.stdout!.on("data", (d: string) => (out += d))
    child.stderr!.setEncoding("utf8")
    child.stderr!.on("data", (d: string) => (out += d))
    child.on("error", reject)
    child.on("exit", (status) => resolve({ out, status }))
  })

it.effect(
  "a staging chunk rejected by a 400 prints status, range and set id, never the chunk text",
  () =>
    Effect.tryPromise(async () => {
      const mock = spawn(process.execPath, ["-e", MOCK], { stdio: ["ignore", "pipe", "ignore"] })
      try {
        const port = await portOf(mock)
        const file = join(mkdtempSync(join(tmpdir(), "qwb50-")), "accounts.jsonl")
        writeFileSync(file, accountsFixture.map((r) => JSON.stringify(r)).join("\n") + "\n")
        const { out, status } = await runTool([tool, file, "mock-reject"], {
          QWBE_URL: `http://127.0.0.1:${port}`,
        })
        expect(status).toBe(1)
        expect(out).toMatch(/HTTP 400/)
        expect(out).toMatch(/lines 1-3/)
        expect(out).toMatch(/set-mock-1/)
        // No row value may appear anywhere in the output.
        for (const row of accountsFixture) {
          expect(out.includes(String(row.accountname))).toBe(false)
          expect(out.includes(String(row.account_no))).toBe(false)
          expect(out.includes(String(row.email1))).toBe(false)
        }
        expect(out.includes("Alpha Trading")).toBe(false)
      } finally {
        mock.kill("SIGKILL")
      }
    }),
  { timeout: 30_000 },
)