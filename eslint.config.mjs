// The kernel's lint layer, mirrored for this pack (QWB-54, ticket 23).
//
// When the kernel installs a pack it copies the cubes under `core/` and runs its own gate over
// them: `tsc -p core/tsconfig.json` plus the type-aware ESLint rules from qwbe's
// eslint.config.mjs, whose `files` pattern is `core/**/*.ts` and therefore covers the installed
// pack. Until now this repository ran neither, so code that its own `npm run typecheck` called
// green was refused at install (three findings: one unused import, two unnecessary type
// assertions). A gate that is weaker than the gate downstream is not a gate.
//
// Rules and their exceptions are copied from qwbe/eslint.config.mjs, not invented here. If the
// kernel changes its list, this file has to follow — the drift is the bug, both directions.
// ESLint does not format anything: the kernel leaves that to Biome and correctness to tsc.

import effect from "@effect/eslint-plugin"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    // Only the cubes are installed into the kernel, and only they have a tsconfig behind them.
    ignores: [
      "**/*.mjs",
      "**/*.cjs",
      "**/node_modules/**",
      "frontend/**",
      "**/dist/**",
    ],
  },
  {
    files: ["cubes/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "@effect": effect,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@effect/no-import-from-barrel-package": "error",
    },
  },
  {
    // The Effect tools and probes are typed through tsconfig.tools.json, so they get the same
    // type-aware rules as the cubes (project instead of projectService: one tsconfig covers
    // tools + probes + checks + test). The .mjs probe entry stays ignored: a one-line launcher.
    files: ["tools/**/*.ts", "probes/**/*.ts", "checks/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.tools.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "@effect": effect,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@effect/no-import-from-barrel-package": "error",
    },
  },
  {
    // Same exception the kernel makes: node:test's describe()/it() return promises the runner
    // awaits, and assertions in tests are written against values the test itself built.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
)
