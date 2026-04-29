# Chapter 46 — Project layout and build setup — matching Effect monorepo conventions

> **Worked-example commit:** `worked-example/` chapter 46 — `chore: initial package.json, tsconfig, vitest.config, gitignore`
> **Patterns demonstrated:** [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) (build setup foreshadows this; the exports map is finalized in Ch 58), [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) (foreshadowed in tsconfig `rootDir`)
> **Reads from:** [Part II Chapter 21 (printer-ansi — first encounter with dual ESM/CJS)](../part-2-tour/21-printer-ansi.md), [Part II Chapter 22 (platform — `internal/` shape)](../part-2-tour/22-platform.md)
> **Reads into:** Chapter 47 (first source file lands), Chapter 56 (vitest config used), Chapter 58 (final exports map)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Before any TypeScript source file can be written, a library needs to know where its compiler
expects to find files, where to emit outputs, and how tests will be discovered. Get these wrong
and you will fix them repeatedly as the codebase grows — a wrong `moduleResolution`, a missing
`composite: true`, a `rootDir` that does not match the emit assumptions. The cost of correcting
build configuration mid-stream is disproportionate to its apparent simplicity: every file path in
`tsconfig`, every key in the `exports` map, every `include` glob is load-bearing once real source
lands.

This chapter addresses that cost upfront. We commit six files — `package.json`, `tsconfig.json`,
`tsconfig.src.json`, `tsconfig.build.json`, `vitest.config.ts`, and `.gitignore` — before a single
line of `@example/effect-cache` logic is written. After this commit, a reader can clone the repo
and immediately run `npm run typecheck` (it will pass vacuously because there is no source yet)
and `vitest run` (it will pass with zero tests). From Chapter 47 onward, every new source file or
test file drops into a working build and test harness without any configuration adjustment.

There is a second reason to do this now. Effect's own monorepo uses a distinctive three-tsconfig
pattern — one root file that holds references, one for IDE and typecheck use, one for actual emit.
Matching that pattern matters for two reasons. First, if you want to contribute to or mirror
Effect's conventions (the goal of Part III), your package should feel familiar to anyone who has
read Effect source. Second, the three-tsconfig split gives you independent control over the IDE
experience versus the build output: you can typecheck without emitting, and emit without running
the full IDE typecheck flow.

The vitest configuration is equally intentional. `@effect/vitest` (Chapter 43) provides `it.effect`
and `it.scoped` helpers that integrate Effect's runtime directly into vitest's test runner. The
configuration here does not yet use them — that is Chapter 56's work — but having a valid
`vitest.config.ts` in place means you can add test files at any point between now and Chapter 56
and they will be discovered automatically.

---

## What we already have

After Chapter 45, `worked-example/` contains exactly two files and two commits:

```bash
$ cd worked-example && git log --oneline
99b1b8f fix: CacheKey constructor call, README imports
10c9764 chore: initial README and design notes

$ ls
DESIGN.md  README.md
```

`README.md` introduces `@example/effect-cache` to a prospective consumer: installation, basic
usage sketch, and an explanation of the TTL and pluggable storage design. `DESIGN.md` is an
author-facing document capturing key decisions — why `Cache` is a service `Tag` rather than a
standalone module, why TTL eviction runs as a fiber rather than a lazy check, and the planned
layer hierarchy.

Neither file contains runnable code. There is no `package.json`, no TypeScript configuration, no
test runner. The repository is a design document, not a package. This chapter converts it into
one.

---

## What we're adding

Six files are committed in this chapter:

| File | Role |
|---|---|
| `package.json` | Package identity, scripts, peer and dev dependencies |
| `tsconfig.json` | Workspace root — references only, no include |
| `tsconfig.src.json` | IDE and typecheck config — `rootDir: "src"`, no emit |
| `tsconfig.build.json` | Emit config — extends `tsconfig.src.json`, outputs to `dist/` |
| `vitest.config.ts` | Test runner — discovers `test/**/*.test.ts` |
| `.gitignore` | Excludes `node_modules/`, `dist/`, build info, logs, coverage |

No `src/` directory is created yet. `tsconfig.src.json` references `rootDir: "src"` and
`include: ["src"]`, but TypeScript is perfectly happy with an empty or absent `src/` when
`--noEmit` is used or when `composite: true` with no source just produces an empty build info
file. The directory materialises in Chapter 47.

---

## The code

### `package.json` (new)

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

`"type": "module"` makes Node.js treat all `.js` files in the package as ESM. This is the same
choice Effect makes in `repos/effect/packages/effect/package.json` and is mandatory for a package
that ships an ESM build as its primary target.

`"main"`, `"module"`, and `"types"` are legacy-compatibility pointers. They exist for bundlers and
type checkers that predate the `"exports"` field (introduced in Node 12 and widely supported since
Node 14). The full `"exports"` map — with separate `"import"` and `"require"` conditions per
subpath — is deferred to Chapter 58 because it cannot be written correctly until all public entry
points are known. See [Chapter 58 (exports map)](../part-3-authoring/58-versioning-and-exports.md)
and the [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern).

`@effect/vitest` version `^0.29.0` matches the version pinned in
`repos/effect/packages/vitest/package.json`, which at `effect@3.21.2` ships `@effect/vitest`
`0.29.0`. The `vitest` peer range `^3.2.0` matches the `peerDependencies` declaration in the same
file.

`"peerDependencies"` lists `effect` but not `@effect/vitest`. That is correct: `@effect/vitest` is
a testing tool used only by `devDependencies` and test files. Consumers of `@example/effect-cache`
do not need it at runtime.

### `tsconfig.json` (new)

```json
{
  "include": [],
  "references": [
    { "path": "tsconfig.src.json" },
    { "path": "tsconfig.build.json" }
  ]
}
```

This is the workspace root tsconfig. It holds no `compilerOptions` and includes no files of its
own. Its sole job is to act as the entry point for `tsc -b` (project references build mode). When
you run `tsc -b tsconfig.json`, TypeScript builds all referenced projects in dependency order.

This mirrors the structure in `repos/effect/packages/effect/tsconfig.json`, with one omission: the
real Effect package also references `tsconfig.test.json` for a dedicated test project. We add tests
in Chapter 56, where we'll revisit whether to follow the same split or keep the simpler
single-tsconfig setup. The `"include": []` is not an accident: a root tsconfig that accidentally
includes source files would cause them to be compiled twice (once by the root, once by the
referenced project), leading to duplicate declaration errors.

### `tsconfig.src.json` (new)

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "moduleDetection": "force",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "moduleResolution": "NodeNext",
    "module": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"],
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo/src.tsbuildinfo",
    "rootDir": "src",
    "outDir": "build/src"
  },
  "include": ["src"]
}
```

Three settings here deserve explanation:

- **`"moduleResolution": "NodeNext"` and `"module": "NodeNext"`** — required for ESM packages in
  Node.js. With `NodeNext`, every relative import must include the `.js` extension even in
  TypeScript source (the compiler resolves `.ts` files when you write `.js` imports). This matches
  the setting in `repos/effect/tsconfig.base.json`.

- **`"composite": true`** — required for project references. Without it `tsc -b` refuses to build
  the project.

- **`"exactOptionalPropertyTypes": true`** — Effect's strictest strictness setting. It prevents
  assigning `undefined` to optional properties unless `undefined` is explicitly in the type. This
  catches a common class of bug where `{ key: undefined }` is passed where `{}` is expected.

`"rootDir": "src"` anticipates the `src/` directory that Chapter 47 creates. TypeScript does not
require the directory to exist when the tsconfig is first written.

### `tsconfig.build.json` (new)

```json
{
  "extends": "./tsconfig.src.json",
  "compilerOptions": {
    "types": ["node"],
    "tsBuildInfoFile": ".tsbuildinfo/build.tsbuildinfo",
    "outDir": "dist/esm",
    "declarationDir": "dist/dts",
    "stripInternal": true
  }
}
```

The build config extends `tsconfig.src.json` so it inherits every strictness setting. It then
overrides the output directories:

- **`"outDir": "dist/esm"`** — emitted `.js` files go here. These are the ESM output files
  referenced by `"module"` in `package.json`.
- **`"declarationDir": "dist/dts"`** — `.d.ts` files go here. Referenced by `"types"` in
  `package.json`.
- **`"stripInternal": true`** — declarations marked `@internal` in JSDoc are stripped from the
  emitted `.d.ts` files. This is how Effect's own packages hide implementation details from
  published type declarations while keeping them visible during development.

Note: `dist/cjs/` does not appear here. CJS output in the Effect monorepo is produced by Babel
transforming the ESM output (not by a separate `tsc` pass). For this worked example, CJS output
is a placeholder for Chapter 58. The `"main"` field in `package.json` points to `dist/cjs/index.js`
as a forward declaration; the actual CJS build tooling is deferred.

### `vitest.config.ts` (new)

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"]
  }
})
```

A minimal vitest configuration. The only non-default setting is `include`, which constrains test
discovery to `test/**/*.test.ts`. This mirrors the conventional layout used across the Effect
monorepo where tests live in a top-level `test/` directory rather than co-located with source.

`@effect/vitest` does not require special vitest configuration — it provides helper functions
(`it.effect`, `it.scoped`, `it.live`) that are imported directly in test files. Chapter 56 uses
these helpers; the vitest config itself stays exactly as written here.

### `.gitignore` (new)

```bash
node_modules/
dist/
.tsbuildinfo/
*.log
coverage/
```

Standard exclusions. `dist/` excludes the build output. `.tsbuildinfo/` excludes TypeScript
incremental build info files (the `tsBuildInfoFile` paths in `tsconfig.src.json` and
`tsconfig.build.json` both point inside this directory).

---

## Why this design choice

### The three-tsconfig split

Effect's monorepo uses a consistent three-tsconfig pattern across every package. Inspect
`repos/effect/packages/effect/tsconfig.json`: it is a pure-references file with no
`compilerOptions`. `repos/effect/packages/effect/tsconfig.src.json` holds the IDE and typecheck
config with `rootDir` and no emit target beyond the `build/src` intermediate directory.
`repos/effect/packages/effect/tsconfig.build.json` extends `tsconfig.src.json` and sets the
final `outDir` and `declarationDir`.

This separation gives you three distinct operations:

1. **`tsc -b tsconfig.json`** — rebuilds everything in reference order. Used in CI.
2. **`tsc -p tsconfig.src.json --noEmit`** (aliased as `npm run typecheck`) — typechecks the
   source without emitting any files. Fast for local development because it does not write to disk.
   (Note: `tsc -b` build mode ignores `--noEmit`; this step uses project mode `-p` instead.)
3. **`tsc -b tsconfig.build.json`** (aliased as `npm run build`) — emits the distributable output.
   Run before publishing.

The alternative — a single `tsconfig.json` with `"declaration": true` and an `"outDir"` — forces
you to choose: either you always emit on every typecheck (slow, pollutes working tree) or you
never emit during development (then `npm run build` runs cold with no incremental cache).

The three-tsconfig pattern resolves this tension. The IDE uses `tsconfig.src.json` (fast
incremental cache, no disk writes). The build uses `tsconfig.build.json` (separate cache, writes
to `dist/`). The root `tsconfig.json` is only there to let `tsc -b` walk the whole project.

### `tsconfig.src.json` — inlined options versus monorepo base extension

The real `repos/effect/packages/effect/tsconfig.src.json` is much shorter than ours — it extends
`../../tsconfig.base.json` and adds only project-specific overrides. The worked example doesn't
have a monorepo-level `tsconfig.base.json` to extend, so it inlines all compiler options directly.
Two details are worth calling out: we use `"lib": ["ES2022"]` with no DOM types (this is a
server-side library; DOM globals like `fetch` or `window` should not be in scope), and we omit
the `@effect/language-service` plugin (an Effect-specific TypeScript plugin that improves
diagnostics for Effect code — for example, catching common `pipe` argument mismatches). Adding the
plugin is a future improvement worth noting; it requires `typescript-language-server` integration
and is not necessary to get a correct build.

### `"type": "module"` and ESM-first

`"type": "module"` in `package.json` means all `.js` files in the package are treated as ESM by
Node.js. This is the direction the Effect ecosystem has moved: `repos/effect/packages/effect/package.json`
sets `"type": "module"`. Combined with `"moduleResolution": "NodeNext"` in TypeScript, it enforces
explicit `.js` extensions on relative imports, which is required for correct ESM interop.

The consequence is that `dist/cjs/` cannot be produced by `tsc` alone — you need a CommonJS
transform step (Babel or esbuild) applied to the ESM output. The real Effect monorepo runs a Babel
pass over `build/esm` to emit a CommonJS variant at `build/cjs`. The worked example skips this
step in Chapter 46; Chapter 58 introduces the full ESM/CJS dual output story.

A related divergence: the real Effect monorepo separates `build/` (intermediate `tsc` output plus
the Babel CJS pass) from `dist/` (the final published artifact assembled by a pack step — see
`repos/effect/packages/effect/package.json` for the `build-cjs` Babel script). The worked example
collapses this into a single `dist/` because we don't have a separate Babel CJS step yet. Using
`dist/esm` and `dist/dts` directly is a valid simplification for a single-package project without
a monorepo build orchestrator. Chapter 58 revisits this when we introduce the full `exports` map
and dual-output publishing.

---

## What's still missing

- **No `src/` directory.** `tsconfig.src.json` references `"rootDir": "src"` but no TypeScript
  source exists yet. The first source file — `src/index.ts` and `src/Cache.ts` — lands in
  [Chapter 47 (designing the public API)](../part-3-authoring/47-public-api.md).

- **No `exports` map.** `package.json` has only legacy `main`/`module`/`types` pointers. The
  full `exports` field with dual ESM/CJS conditions per subpath is written in
  [Chapter 58 (versioning, exports map, and dual ESM/CJS)](../part-3-authoring/58-versioning-and-exports.md).

- **No CJS build step.** The `dist/cjs/` directory referred to by `"main"` does not yet exist
  and is not produced by the current `tsconfig.build.json`. The Babel/esbuild transform that
  produces CJS from the ESM output is part of the Chapter 58 publishing setup.

- **No peer dependency range check.** The `"effect": "^3.21.0"` range in `peerDependencies` is
  an initial guess. The final range — checked against actual API usage and Effect's semver
  guarantees — is confirmed in
  [Chapter 59 (publishing checklist)](../part-3-authoring/59-publishing.md).

- **No JSDoc tooling.** `docgen.json` (the Effect docgen configuration) and JSDoc annotations on
  exported symbols are Chapter 57's work: [Chapter 57 (documenting with JSDoc)](../part-3-authoring/57-jsdoc.md).

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add package.json tsconfig.json tsconfig.src.json tsconfig.build.json vitest.config.ts .gitignore
git commit -m "chore: initial package.json, tsconfig, vitest.config, gitignore"
```

After this commit, `git log --oneline` shows:

```bash
8b59b08 chore: initial package.json, tsconfig, vitest.config, gitignore
99b1b8f fix: CacheKey constructor call, README imports
10c9764 chore: initial README and design notes
```

---

## See also

- [Chapter 47 — Designing the public API — the `.make` constructor and the service `Tag`](../part-3-authoring/47-public-api.md) — first source file; `tsconfig.src.json`'s `rootDir: "src"` becomes real
- [Chapter 43 — Testing Effect programs with @effect/vitest](../part-2-tour/43-vitest.md) — the package whose helpers (`it.effect`, `it.scoped`) we'll wire into our vitest config in Chapter 56
- [Chapter 56 — Testing with @effect/vitest — `it.effect`, `it.scoped`, and layer management](../part-3-authoring/56-testing.md) — the `vitest.config.ts` committed here is used without modification
- [Chapter 57 — Documenting with JSDoc — `@since`, `@category`, `@example` tags](../part-3-authoring/57-jsdoc.md) — `docgen.json` and annotation tooling added alongside the existing build config
- [Chapter 58 — Versioning, exports map, and dual ESM/CJS](../part-3-authoring/58-versioning-and-exports.md) — the `package.json` skeleton committed here receives its full `"exports"` map
- [Chapter 59 — Publishing checklist — peer deps, changesets, and release](../part-3-authoring/59-publishing.md) — `peerDependencies` range finalised
- [Chapter 60 — Retrospective — re-reading `effect-cache` against the patterns catalog](../part-3-authoring/60-retrospective.md) — looks back at every design decision, including why ESM-first was the right call
- [Part II Chapter 21 — ANSI colors and terminal rendering with @effect/printer-ansi](../part-2-tour/21-printer-ansi.md) — first encounter with the dual ESM/CJS export pattern in a published Effect package
- [Part II Chapter 22 — Platform services — the abstract runtime layer](../part-2-tour/22-platform.md) — `internal/` folder convention first observed; `tsconfig.src.json`'s `rootDir` foreshadows the same shape
- [Patterns catalog — Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern)
- [Patterns catalog — The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape)
