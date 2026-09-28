// Import chain end-to-end (synthetic fixture, throwaway kernel)
import * as FileSystem from "@effect/platform/FileSystem"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { plantCrmPack } from "../_layers/pack-copy.ts"
import { testServer } from "../_layers/test-server.ts"
import { count, fixture, MAPPING, type Row, run, writeJsonl } from "../_layers/vtiger-cli.ts"

// The refusal paths of the import chain, over their own server: a row the cube rejects, the
// --max-rejects threshold, and the staging chunk cap. Output never carries a row value.

const SERVER = { timeout: 120_000, excludeTestServices: true } as const
const work = Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix: "qwb50-" }))
const lastLine = (out: string) => out.trim().split("\n").at(-1)

const account = (base: Row, id: number, accountNo: string, name: string, extra: Row = {}) => ({
  ...base, vtigerId: id, accountid: id, account_no: accountNo, accountname: name, ...extra,
})

layer(testServer("import-rejects", {}, plantCrmPack), SERVER)((it) => {
  it.scoped("prints status and field name, never row values, exits non-zero, when the cube rejects a row", () =>
    Effect.gen(function* () {
      const [first] = yield* fixture("accounts")
      const file = yield* writeJsonl(yield* work, "accounts-reject.jsonl", [
        account(first, 940001, "FIX-ACC-G", "Gamma Proof SRL"),
        account(first, 940002, "FIX-ACC-B", "Delta Proof SRL", { employees: -7 }),
      ])
      // One rejected row and the default threshold of zero: the run FAILS (QWB-54, ticket 13).
      const { out, status } = yield* run("vtiger-map", [file, MAPPING.accounts])
      expect(status).toBe(1)
      expect(out).toMatch(/HTTP 400/)
      expect(out).toMatch(/employees/)
      expect(out).toMatch(/errors:\s+1/)
      // the count is in the LAST line, so a wrapper script can read it
      expect(lastLine(out)).toMatch(/rejected:\s+1 of 2 row\(s\) \(max accepted: 0\)/)
      // nothing from the rejected row (nor the good one) may appear in the output
      for (const value of ["Delta Proof", "Gamma Proof", "FIX-ACC-B", "-7"]) expect(out).not.toContain(value)
    }))

  it.scoped("accepts rejections up to an explicit --max-rejects threshold and exits zero", () =>
    Effect.gen(function* () {
      const [first] = yield* fixture("accounts")
      const file = yield* writeJsonl(yield* work, "accounts-threshold.jsonl", [
        account(first, 940003, "FIX-ACC-T", "Threshold Proof SRL"),
        account(first, 940004, "FIX-ACC-U", "Threshold Bad SRL", { employees: -7 }),
      ])
      const before = yield* count("organizations")
      const { out, status } = yield* run("vtiger-map", [file, MAPPING.accounts, "--max-rejects", "1"])
      expect(status).toBe(0)
      expect(out).toMatch(/errors:\s+1/)
      expect(lastLine(out)).toMatch(/rejected:\s+1 of 2 row\(s\) \(max accepted: 1\)/)
      // the good row landed, the rejected one did not
      expect(yield* count("organizations")).toBe(before + 1)
      expect(out).toMatch(/created:\s+1/)
    }))

  it.scoped("respects a forced small chunk cap: boundaries on line edges, oversize lines refused", () =>
    Effect.gen(function* () {
      const [first] = yield* fixture("accounts")
      const dir = yield* work
      // rows must be smaller than the forced cap, and the cap must be exceeded by two rows plus
      // their separators, so the chunk boundary provably falls BETWEEN lines
      const small = Array.from({ length: 5 }, (_, i) => account(first, 960001 + i, `FIX-ACC-C${i}`, `Chunk small ${i} SRL `))
      const cap = JSON.stringify(small[0]).length * 2 + 10
      const up = yield* run("vtiger-to-staging", [yield* writeJsonl(dir, "accounts-chunk.jsonl", small), "chunk-boundary"], {
        QWB50_MAX_CHARS: String(cap),
      })
      expect(up.status).toBe(0)
      expect(up.out).toMatch(/rows:\s+5/)
      expect(up.out).toMatch(/malformed:\s+0/)

      // one line larger than the cap: refused and counted, never posted
      const big = account(first, 970001, "FIX-ACC-BIG", `Oversized ${"y".repeat(80)}`)
      const { out, status } = yield* run("vtiger-to-staging", [yield* writeJsonl(dir, "accounts-big.jsonl", [big]), "oversized"], {
        QWB50_MAX_CHARS: String(JSON.stringify(big).length - 1),
      })
      expect(status).toBe(1)
      expect(out).toMatch(/oversized:\s+1/)
      expect(out).not.toContain("Oversized")
    }))
})
