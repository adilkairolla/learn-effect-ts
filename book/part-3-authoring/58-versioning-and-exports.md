# Chapter 58 — Versioning, exports map, and dual ESM/CJS

> **Worked-example commit:** `worked-example/` chapter 58 — `chore: finalize exports map for dual ESM/CJS, version 0.1.0`
> **Patterns demonstrated:** [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern)
> **Reads from:** [Part II Chapter 21 — ANSI colors and terminal rendering — first encounter with dual ESM/CJS](../part-2-tour/21-printer-ansi.md), [Chapter 46 — Project layout and build setup](46-build-setup.md)
> **Reads into:** Chapter 59 (publishing reads the version and the exports map to generate the tarball)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

From Chapter 46 onward, `worked-example/package.json` has carried placeholder `"main"`, `"module"`, and `"types"` fields that point to `dist/` paths which do not yet exist. Those three fields are a legacy mechanism: `"main"` tells CommonJS runtimes where to find the entry point, `"module"` is an unofficial Webpack/Rollup convention for the ESM build, and `"types"` tells TypeScript's language service where to find declarations. They all work — but only for the package root. A consumer who writes `import { CacheKey } from "@example/effect-cache/CacheKey"` gets `ERR_PACKAGE_PATH_NOT_EXPORTED` in Node 18+ because there is no `"exports"` field to authorize that subpath.

The `"exports"` field is Node.js's answer to that problem. It is an explicit allowlist: every path listed in `"exports"` can be imported; every path absent from it — including `src/internal/*` — cannot. Node 18+ honors `"exports"` over `"main"`, so once this field is present the legacy triplet becomes a fallback for older bundlers that do not understand `"exports"`. We keep both for maximum compatibility.

This chapter makes one change to exactly one file — `package.json` — but it is the change that makes `@example/effect-cache` publishable. Version `0.1.0` signals that the library has crossed the threshold from development artifact to releasable package. The `"exports"` map defines the package's public surface at the module-resolution level, so that Node.js itself enforces the `internal/` privacy boundary we have maintained by convention since Chapter 54.

---

## What we already have

After Chapter 57, `worked-example/` contains a complete, documented library:

```
worked-example/
  src/
    Cache.ts          — public service + layers
    CacheConfig.ts    — schema-validated config
    CacheError.ts     — typed error hierarchy
    CacheKey.ts       — branded key type
    CacheEvent.ts     — tagged-union events
    index.ts          — barrel re-export
    internal/
      storage.ts      — Storage interface (private)
      MemoryStorage.ts — Ref-backed implementation (private)
      eviction.ts     — eviction fiber (private)
  test/
    Cache.test.ts
  package.json        — version 0.0.0, no exports map
  README.md, DESIGN.md, docgen.json
  tsconfig.json, tsconfig.src.json, tsconfig.build.json
  vitest.config.ts, .gitignore
```

The current `package.json` has `"version": "0.0.0"` — the conventional placeholder for "not yet publishable" — and no `"exports"` field. A consumer adding the package from a local path would get the root `index.ts` barrel via `"main"`, but any subpath import would fail at module resolution. The `"sideEffects"` field is also absent, which means bundlers cannot tree-shake the package effectively.

---

## What we're adding

A single file is modified in this chapter: `worked-example/package.json`.

Changes:

- `"version"` bumped from `0.0.0` to `0.1.0` (initial publishable release).
- `"sideEffects": false` added (tree-shaking signal).
- Full `"exports"` map added with six per-module entries: `.`, `./Cache`, `./CacheConfig`, `./CacheError`, `./CacheKey`, `./CacheEvent`. Each entry has `"types"`, `"import"`, and `"require"` conditions. `internal/*` is deliberately absent from the map.
- `"files"` array added, listing exactly what the npm tarball should contain.

No source files change. No tests change. This is a packaging-only commit.

---

## The code

### Before: `worked-example/package.json` (Chapter 46 state)

```json
{
  "name": "@example/effect-cache",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/dts/index.d.ts",
  "scripts": {
    "build": "tsc -b tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.src.json --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "effect": "^3.21.0"
  },
  "devDependencies": {
    "@effect/vitest": "^0.29.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^3.2.0"
  }
}
```

Three problems with this state: the version signals "unpublishable", there is no `"exports"` field (subpath imports are unsupported), and there is no `"files"` field (npm would include everything, including test files and tsconfig files).

### After: `worked-example/package.json` (this chapter's commit)

```json
{
  "name": "@example/effect-cache",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/dts/index.d.ts",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/dts/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    },
    "./Cache": {
      "types": "./dist/dts/Cache.d.ts",
      "import": "./dist/esm/Cache.js",
      "require": "./dist/cjs/Cache.js"
    },
    "./CacheConfig": {
      "types": "./dist/dts/CacheConfig.d.ts",
      "import": "./dist/esm/CacheConfig.js",
      "require": "./dist/cjs/CacheConfig.js"
    },
    "./CacheError": {
      "types": "./dist/dts/CacheError.d.ts",
      "import": "./dist/esm/CacheError.js",
      "require": "./dist/cjs/CacheError.js"
    },
    "./CacheKey": {
      "types": "./dist/dts/CacheKey.d.ts",
      "import": "./dist/esm/CacheKey.js",
      "require": "./dist/cjs/CacheKey.js"
    },
    "./CacheEvent": {
      "types": "./dist/dts/CacheEvent.d.ts",
      "import": "./dist/esm/CacheEvent.js",
      "require": "./dist/cjs/CacheEvent.js"
    }
  },
  "files": [
    "dist",
    "src",
    "README.md",
    "DESIGN.md",
    "package.json"
  ],
  "scripts": {
    "build": "tsc -b tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.src.json --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "effect": "^3.21.0"
  },
  "devDependencies": {
    "@effect/vitest": "^0.29.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^3.2.0"
  }
}
```

### Reading the exports map

Each subpath entry follows the same three-key structure:

```json
"./Cache": {
  "types": "./dist/dts/Cache.d.ts",
  "import": "./dist/esm/Cache.js",
  "require": "./dist/cjs/Cache.js"
}
```

Node.js evaluates export conditions in declaration order and stops at the first match. A TypeScript language server running in `moduleResolution: "bundler"` or `"node16"` mode sees the `"types"` key first and resolves to the `.d.ts` declaration file. An ESM runtime (`import { ... } from "@example/effect-cache/Cache"`) matches `"import"` and gets the ESM build. A CJS runtime (`const { ... } = require("@example/effect-cache/Cache")`) matches `"require"` and gets the CJS build.

Note that `"types"` comes first in each entry. Node.js documentation explicitly recommends placing the `"types"` condition before `"import"` and `"require"` so that TypeScript resolves declarations before the runtime conditions are evaluated. The Effect source at `repos/effect/packages/effect/package.json` uses workspace-style exports (pointing at `./src/*.ts`) in the checked-in source — the final per-condition map is generated by `build-utils pack-v3` at publish time. The condition ordering used here — `types` → `import` → `require` — matches what `pack-v3` produces and is the recommended ordering per the Node.js package exports documentation.

### What is NOT exported

There is no entry for `./internal/*`. Any import attempt — `import { MemoryStorage } from "@example/effect-cache/internal/MemoryStorage"` — will throw `ERR_PACKAGE_PATH_NOT_EXPORTED` in Node 18+. This is the correct behavior: `internal/` is an implementation detail, and its exports change freely between minor versions. This enforcement mirrors the `"./internal/*": null` entry in `repos/effect/packages/effect/package.json:38` and `repos/effect/packages/printer-ansi/package.json:40`, which use `null` (the explicit "block this path" value) rather than simply omitting the entry.

> _Note: We use omission rather than `null` because our per-module explicit map does not use wildcard globs. The effect is identical — absent paths are not exported._

---

## Why this design choice

### Exports map over plain `"main"`/`"module"`

The `"main"` and `"module"` fields only handle the package root. If a consumer writes:

```ts
import { CacheKey } from "@example/effect-cache/CacheKey"
```

...this import is unauthorized without an `"exports"` entry. Node 18+ will throw. Older bundlers (Webpack 4, Jest's default CJS transform) will fall back to `"main"` and attempt the import path directly against the filesystem — which may accidentally succeed in a development setup where `dist/` exists, but will silently import the wrong artifact (CJS instead of ESM, or the barrel instead of the submodule).

The `"exports"` field removes that ambiguity. It is an allowlist: if a path is not listed, it cannot be imported. This matters for `@example/effect-cache` because the library's design intent — described in [Chapter 54](54-internal-modules.md) — is that `internal/` should be invisible to consumers. The `"exports"` map makes that invisible boundary enforced by the module system itself.

### Per-module entries over a wildcard glob

Effect's source package uses `"./*": "./src/*.ts"` as a wildcard glob (see `repos/effect/packages/effect/package.json:37`), which expands to individual per-module entries at publish time. For `@example/effect-cache`, we use explicit per-module entries rather than a wildcard. This is appropriate for a small, stable public API: there are exactly five exported modules plus the root barrel. Explicit entries make the surface area legible in the file itself and avoid the risk of accidentally exporting a file that should have remained internal.

### `"sideEffects": false`

This flag tells bundlers (Webpack, Rollup, esbuild) that importing any file from this package does not produce side effects — no global mutations, no polyfills, no top-level code that runs on import. When this flag is present, a bundler that builds an application importing only `CacheKey` from `@example/effect-cache` can tree-shake away the `Cache`, `CacheEvent`, `CacheConfig`, and `CacheError` modules entirely. Without it, bundlers must assume every file might have side effects and include the full package in the output bundle.

Effect itself uses `"sideEffects": []` in the effect-smol package (see `repos/effect-smol/packages/effect/package.json:28`), which is the equivalent empty-array form — both `false` and `[]` tell bundlers the package is side-effect free.

### Version policy: `0.1.0` and what it signals

`0.0.0` is the standard placeholder for a package that is not yet ready to publish. Bumping to `0.1.0` signals that `@example/effect-cache` is ready for initial release. Under semantic versioning, `0.x.y` carries a specific promise: breaking changes are allowed in minor version bumps (`0.1.0` → `0.2.0`) because the package has not yet declared stability. Only at `1.0.0` do the full semver guarantees apply — major bumps for breaking changes, minor bumps for backwards-compatible additions, patch bumps for backwards-compatible fixes.

The `@since 0.1.0` JSDoc tags we added in [Chapter 57](57-jsdoc.md) are the per-symbol counterpart of this package-level version. When a new function is added in a future `0.2.0`, it will be tagged `@since 0.2.0`, letting consumers of the generated documentation know exactly which version introduced each export.

The peer dependency range `"effect": "^3.21.0"` uses the caret `^` to accept any `3.x` release from `3.21.0` upward. This matches the pinned snapshot major and minor while permitting patch updates, which is the standard practice for peer dependencies on Effect — breaking changes in the Effect API surface are reserved for major version bumps.

---

## What's still missing

This chapter makes `package.json` publishable but does not publish anything. The remaining steps belong to Chapter 59:

- **`npm publish` / `pnpm publish`** — the actual publish command, including authentication tokens, registry configuration, and `--dry-run` verification.
- **Changesets** — automated changelog generation via `@changesets/cli`. Effect's monorepo uses changesets for every release; `@example/effect-cache` should too once it reaches `1.0.0`.
- **`CHANGELOG.md`** — a human-readable release log. Changesets generates this automatically from changeset YAML files committed alongside each feature branch.
- **`dist/` built artifacts** — the `"exports"` map points at `dist/esm/`, `dist/cjs/`, and `dist/dts/`, none of which exist yet. The build step (`npm run build`) is a prerequisite for publishing, but is not yet wired into a prepublish lifecycle script.
- **Provenance attestation** — Effect's packages use `"publishConfig": { "provenance": true }` to generate npm provenance attestations via GitHub Actions. This is omitted here but is the recommended practice for public packages.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add package.json
git commit -m "chore: finalize exports map for dual ESM/CJS, version 0.1.0"
```

This produces the sole change in this chapter: one file modified, forty-one lines inserted, one line removed.

---

## See also

- [Part II Chapter 21 — ANSI colors and terminal rendering](../part-2-tour/21-printer-ansi.md) — first encounter with the dual ESM/CJS export pattern; shows the four-entry `exports` map shape (`"."`, `"./*"`, `"./internal/*": null`, `"./package.json"`) in `repos/effect/packages/printer-ansi/package.json`.
- [Chapter 46 — Project layout and build setup](46-build-setup.md) — establishes the `dist/cjs`, `dist/esm`, `dist/dts` output layout that the `"exports"` map points at.
- [Chapter 54 — Internal modules and private implementations](54-internal-modules.md) — explains why `internal/` must be hidden from consumers; the `"exports"` map in this chapter enforces that at the module-system level.
- [Chapter 57 — Documenting with JSDoc](57-jsdoc.md) — the `@since 0.1.0` tags added there correspond to the `"version": "0.1.0"` set here.
- [Chapter 59 — Publishing to npm](59-publishing.md) — uses the version and exports map defined in this chapter to build and publish the tarball.
- [Dual ESM/CJS export pattern — patterns catalog](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) — documents the pattern, the anti-pattern it replaces, and when not to use it.
- `repos/effect/packages/effect/package.json` — the pinned Effect source; the `"exports"` field at line 34 uses the same `import`/`require`/`types` conditions that this chapter adapts for `@example/effect-cache`.
