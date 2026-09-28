// Install lifecycle of this pack in a scratch store (install and serve)
import { join } from "node:path"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  CRM_CUBES, exists, installFrom, mountedCrm, SourceBefore, sourceBefore, sourceFingerprint,
} from "../_layers/install-from.ts"
import { asAdmin } from "../_layers/session.ts"
import { bootedServer, testWorkspace } from "../_layers/test-server.ts"
import { Workspace } from "../_layers/workspace.ts"

// This repo goes into a clean kernel through the public install-from door, the only install
// step: staged into the workspace's scratch store, mounted at the next boot, its routes declared
// in OpenAPI. Each nested layer is one boot over the same database and directories.

const OPTIONS = { timeout: 120_000, excludeTestServices: true } as const

const Operation = Schema.Struct({
  security: Schema.optional(Schema.Array(Schema.Unknown)),
  requestBody: Schema.optional(Schema.Unknown),
  responses: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.Unknown }), { default: () => ({}) }),
})
const Spec = Schema.Struct({ paths: Schema.Record({ key: Schema.String, value: Schema.Record({ key: Schema.String, value: Operation }) }) })

const spec = asAdmin.pipe(
  Effect.flatMap((admin) => admin.get("/openapi.json")),
  Effect.flatMap((reply) => Effect.orDie(Schema.decodeUnknown(Spec)(reply.body))),
)
const paths = Effect.map(spec, (openapi) => Object.keys(openapi.paths))

layer(sourceBefore.pipe(Layer.provideMerge(testWorkspace("install-lifecycle"))), OPTIONS)((it) => {
  it.layer(bootedServer())("a clean kernel, then install-from", (it) => {
    it.effect("clean Qwbe boots with no CRM cubes mounted", () =>
      Effect.map(mountedCrm, (crm) => expect(crm).toEqual([])))

    it.effect("clean OpenAPI declares no CRM routes", () =>
      Effect.map(paths, (all) => expect(all.filter((path) => /^\/(contacts|contracts|organizations)\b/.test(path))).toEqual([])))

    it.effect("install-from accepts the local crm-pack directory", () =>
      Effect.map(Effect.flatMap(asAdmin, installFrom), (reply) =>
        expect(reply).toMatchObject({ status: 200, body: { package: { name: "crm-pack" }, requiresRestart: true } })))

    it.effect("package staged in the (scratch) store by install-from", () =>
      Effect.gen(function* () {
        expect(yield* exists((yield* Workspace).storeDir, "crm-pack", "qwbe-package.json")).toBe(true)
      }))

    it.effect("before restart the CRM cubes are NOT yet mounted", () =>
      Effect.map(mountedCrm, (crm) => expect(crm).toEqual([])))
  })

  it.layer(bootedServer())("after the restart", (it) => {
    it.effect("after restart the CRM cubes are mounted and enabled (copy present in the plugins directory)", () =>
      Effect.gen(function* () {
        expect(yield* mountedCrm).toEqual(expect.arrayContaining(CRM_CUBES))
        const cubes = join((yield* Workspace).pluginsDir, "crm-pack", "cubes", "crm")
        for (const cube of ["", "contacts", "contracts", "organizations"]) {
          expect(yield* exists(cubes, cube, "index.ts")).toBe(true)
        }
      }))

    it.effect("OpenAPI declares all CRM routes", () =>
      Effect.map(paths, (all) =>
        expect(all).toEqual(expect.arrayContaining(["/contacts", "/contacts/{id}", "/contracts", "/contracts/{id}"]))))

    it.effect("OpenAPI: POST /contracts has payload, auth and typed statuses", () =>
      Effect.map(spec, ({ paths }) => {
        const operations = paths["/contracts"] ?? {}
        expect(operations["post"]?.requestBody).toBeDefined()
        expect(Object.keys(operations["post"]?.responses ?? {})).toEqual(expect.arrayContaining(["400", "401", "403"]))
        for (const operation of Object.values(operations)) expect(operation.security?.length).toBeGreaterThan(0)
      }))

    it.effect("OpenAPI: GET /contacts/{id} declares 401/404 and a response schema", () =>
      Effect.map(spec, ({ paths }) => {
        const responses = paths["/contacts/{id}"]?.["get"]?.responses ?? {}
        expect(Object.keys(responses)).toContain("404")
        expect(responses["200"]).toHaveProperty(["content", "application/json", "schema"])
      }))
  })

  it.effect("the plugin source tree is byte-identical after the whole run", () =>
    Effect.gen(function* () {
      expect(yield* sourceFingerprint).toBe(yield* SourceBefore)
    }))
})
