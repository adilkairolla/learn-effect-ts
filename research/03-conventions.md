# Effect TS House Conventions

> Source: `repos/effect/packages/effect/` and a sample of sibling packages (`@effect/cli`, `@effect/sql`), pinned at `39c934c1476be389f7469433910fdf30fc4dad82` (see `book/00-toc.md`).

---

## Package layout

Every package follows the same directory structure. Using the core `effect` package as the canonical example:

```
packages/effect/
├── src/               # All public TypeScript source (177 files in effect)
│   ├── index.ts       # Single barrel re-export for the whole package
│   ├── Effect.ts      # One file per public module
│   ├── Array.ts
│   └── internal/      # Implementation details — never re-exported (101 files)
│       ├── core.ts
│       ├── cause.ts
│       └── opCodes/   # Sub-folders for related internals
├── test/              # Colocated test suite (one .test.ts per public module)
├── tsconfig.json      # Top-level composite project ref
├── tsconfig.src.json  # Compiles src/ → build/src/
├── tsconfig.build.json# Compiles src/ → build/esm/ + build/dts/ (stripInternal)
├── tsconfig.test.json # Compiles test/ (extends tsconfig.base.json)
├── vitest.config.ts   # Delegates to ../../vitest.shared.ts
├── docgen.json        # @effect/docgen config: excludes src/internal/**
├── package.json
└── CHANGELOG.md
```

This layout is identical across `@effect/cli` (`repos/effect/packages/cli/`) and `@effect/sql` (`repos/effect/packages/sql/`). The scripts block and build pipeline are byte-for-byte the same in all three (see `repos/effect/packages/effect/package.json` scripts, `repos/effect/packages/cli/package.json` scripts, `repos/effect/packages/sql/package.json` scripts).

**Notable variation**: `@effect/cli`'s `package.json` includes an `"effect": { "generateIndex": { "include": ["**/*"] } }` field that enables auto-generation of `index.ts` via build tooling (`repos/effect/packages/cli/package.json`). The core `effect` package does not use this — its `index.ts` is hand-maintained.

---

## `index.ts` re-export shape

The barrel file in every package uses **namespace re-exports** almost exclusively:

```ts
// repos/effect/packages/effect/src/index.ts, lines 35-42
/**
 * @since 3.10.0
 */
export * as Arbitrary from "./Arbitrary.js"

/**
 * @since 2.0.0
 */
export * as Array from "./Array.js"
```

Each namespace export gets its own JSDoc block with a `@since` tag (and often a description paragraph for larger modules — see `BigDecimal` at `repos/effect/packages/effect/src/index.ts:44-60`).

The one exception is a small set of **named value exports** from `Function.ts` that are lifted directly into the top-level namespace (no namespace wrapping), so callers can write `import { pipe } from "effect"`:

```ts
// repos/effect/packages/effect/src/index.ts, lines 5-30
export {
  absurd,
  flow,
  hole,
  identity,
  pipe,
  unsafeCoerce
} from "./Function.js"
```

The file extension in every import specifier is `.js` (not `.ts`), which is required by `"moduleResolution": "NodeNext"` (see `repos/effect/repos/effect/tsconfig.base.json`).

`@effect/cli` (`repos/effect/packages/cli/src/index.ts`) and `@effect/sql` (`repos/effect/packages/sql/src/index.ts`) use the same pure namespace re-export pattern with no named-value overrides.

---

## JSDoc tags the team uses

Five `@`-tags appear in the public source. All five are observed in `repos/effect/packages/effect/src/Effect.ts`:

| Tag | Purpose | Where it appears |
|-----|---------|-----------------|
| `@since` | Semver version at which the declaration was added | Every public export, every re-export in `index.ts` |
| `@category` | Groups the symbol in generated API docs | All public functions/constants (e.g., `@category Caching`, `@category Guards`) |
| `@example` | Runnable TypeScript code snippet (compiled by `@effect/docgen`) | Selected functions — typically complex operators |
| `@experimental` | Flags APIs that may have breaking changes in minor releases | Sparse; see `repos/effect/packages/effect/src/Effect.ts:4418` and `:13583` |
| `@see` | Cross-reference to a related symbol | Used alongside `{@link …}` inline links, e.g. `@see {@link cached}` at `repos/effect/packages/effect/src/Effect.ts:343-345` |

Tags in `internal/` modules use a different style:

```ts
// repos/effect/packages/effect/src/internal/cause.ts, lines 25-28
/** @internal */
export const CauseTypeId: Cause.CauseTypeId = Symbol.for(…)
```

`/** @internal */` is a single-line block comment with no other tags. The TypeScript build option `"stripInternal": true` in `tsconfig.build.json` (`repos/effect/packages/effect/tsconfig.build.json:8`) strips these declarations from the emitted `.d.ts` files, so they never appear in the public type surface.

`@effect/cli`'s `Args.ts` uses only `@since` and `@category` — no `@example` or `@experimental` (`repos/effect/packages/cli/src/Args.ts`). This is a per-module choice, not a per-package policy.

**Surprising finding**: There is no `@param`, `@returns`, or `@throws` tag anywhere in Effect source. Documentation is written as prose paragraphs inside the JSDoc block, with section headers like `**Details**`, `**When to Use**`, and `**Example**` (in Markdown, not JSDoc tags).

---

## Exports map (dual ESM/CJS)

The **development-time** `package.json` used inside the monorepo maps every entry point to the raw TypeScript source:

```jsonc
// repos/effect/packages/effect/package.json
{
  "type": "module",
  "exports": {
    "./package.json": "./package.json",
    ".":              "./src/index.ts",
    "./*":            "./src/*.ts",
    "./internal/*":   null
  }
}
```

Key points:
- `"type": "module"` — all `.js` files in this package are treated as ESM.
- `"."` → `"./src/index.ts"` — consumers inside the monorepo import live TypeScript source, not compiled output.
- `"./*"` → `"./src/*.ts"` — allows deep imports like `import * as Effect from "effect/Effect"` while still pointing at source.
- `"./internal/*": null` — explicitly blocks any import path that starts with `internal/`, matching the docgen exclusion rule.
- `"main"`, `"module"`, and `"types"` are all `null` (absent) — the workspace-level exports map is the only resolution path.

The **published** package (`dist/`) is produced by `build-utils pack-v3` and rewrites this map to separate `import` (ESM, `build/esm/`) and `require` (CJS, `build/cjs/`) conditions, plus a `"types"` entry pointing to `build/dts/`. The `build-cjs` step uses Babel (`@babel/transform-modules-commonjs`) to transpile the already-compiled ESM output to CJS — so there is a single source of truth and no separate CJS hand-written code (see `repos/effect/packages/effect/package.json` scripts: `build-esm`, `build-annotate`, `build-cjs`).

The exports map shape is identical across `@effect/cli` (`repos/effect/packages/cli/package.json`) and `@effect/sql` (`repos/effect/packages/sql/package.json`).

---

## `internal/` folder

**What goes there**: Any implementation module that is not part of the public API. Examples:

- `repos/effect/packages/effect/src/internal/core.ts` — the low-level interpreter for `Effect` (hundreds of op-code constructors, the fiber scheduler primitives, all the `EffectTypeId` bookkeeping).
- `repos/effect/packages/effect/src/internal/cause.ts` — the `Cause` data constructors and traversal engine.
- `repos/effect/packages/effect/src/internal/errors.ts` — a single helper `getBugErrorMessage` and nothing else.
- `repos/effect/packages/effect/src/internal/opCodes/` — sub-folder for string-constant op-code tables (e.g. `effect.ts`, `deferred.ts`). All declarations are `/** @internal */`.

**What does not go there**: Type-level declarations (interfaces, type aliases, namespace declarations) that are referenced in public module signatures stay in the public `.ts` files even when the runtime implementation is in `internal/`. For example, `Cause.ts` exports the `CauseTypeId` symbol type and all the interface shapes; `internal/cause.ts` provides the runtime values.

**Why not re-exported**: The exports map sets `"./internal/*": null`, which causes bundlers and Node's ESM resolver to throw when a consumer tries to import from that path. Additionally, `tsconfig.build.json` strips `/** @internal */` declarations from `.d.ts` output so the type is not even visible in distributed packages (`repos/effect/packages/effect/tsconfig.build.json:8`). The `docgen.json` also explicitly excludes `"src/internal/**/*.ts"` from documentation generation (`repos/effect/packages/effect/docgen.json:3`).

The same pattern holds in `@effect/cli` (`repos/effect/packages/cli/src/internal/`) and `@effect/sql` (`repos/effect/packages/sql/src/internal/`).

---

## Naming conventions

### Constructors

| Pattern | Meaning | Example |
|---------|---------|---------|
| `.make` | Allocate a new mutable or structured value | `Chunk.make(...items)` (`repos/effect/packages/effect/src/Chunk.ts:233`); `Deferred.make()` (`repos/effect/packages/effect/src/Deferred.ts:88`); `Effect.makeSemaphore(n)` (`repos/effect/packages/effect/src/Effect.ts:11852`) |
| `.succeed` / `.fail` / `.sync` | Lift a pure value into an effectful context | `Effect.succeed(a)` (`repos/effect/packages/effect/src/Effect.ts:3160`); `Effect.fail(e)` (`:2575`); `Effect.sync(thunk)` (`:3326`) |
| `.from*` | Construct from an existing value of a related type | `Effect.fromFiber` (`repos/effect/packages/effect/src/Effect.ts:6534`); `Effect.fromNullable` (`:13248`) |
| `.of` | Typically an alias for single-element construction | Less common; `Chunk` does not expose `.of` directly; used in typeclass-style contexts |

### TypeIds and branded types

Every Effect data type exposes a **unique symbol** as its runtime brand:

```ts
// repos/effect/packages/effect/src/Effect.ts, lines 81-87
export const EffectTypeId: unique symbol = core.EffectTypeId
export type EffectTypeId = typeof EffectTypeId
```

The symbol is always named `<TypeName>TypeId` (e.g. `CauseTypeId`, `LayerTypeId`, `TagTypeId`). The pattern is mirrored in `Context.ts` (`repos/effect/packages/effect/src/Context.ts:24-30`): `TagTypeId`, `ReferenceTypeId`, and `TypeId` are all declared as `unique symbol` in the public module and their values are implemented in `internal/`.

Branded value types use `Brand.refined<MyBrand>(predicate)` or `Brand.nominal<MyBrand>()` from `repos/effect/packages/effect/src/Brand.ts:203-269`.

### Error classes

Two distinct styles coexist:

1. **`Data.TaggedError`** — class-based errors with a `_tag` discriminant, used in public APIs:
   ```ts
   // repos/effect/packages/effect/src/Cron.ts:253
   export class ParseError extends Data.TaggedError("CronParseError")<{ readonly input: string }> {}
   ```
2. **Factory functions** via `makeException` — used for built-in runtime exceptions (`NoSuchElementException`, `TimeoutException`, `IllegalArgumentException`) defined in `repos/effect/packages/effect/src/internal/core.ts:2300-2365`. These are exposed through `Cause.ts` as plain values, not classes.

Error class names follow `<Domain>Error` (e.g. `ParseError`, `GraphError`, `SqlError`) or `<Action>Exception` for runtime/built-in exceptions (`TimeoutException`, `IllegalArgumentException`).

### Layer variables

The community convention (shown in Effect's own docs examples) is to suffix a `Layer` value with `Live` when it provides a real implementation:

```ts
// repos/effect/packages/effect/src/Effect.ts, lines 7512-7518
const DatabaseLive = Layer.succeed(Database, { query: … })
```

Service tags are PascalCase class declarations extending `Context.Tag("Namespace/ServiceName")` — see `repos/effect/packages/effect/src/Context.ts:513-517`.

### `dual` functions

Functions that support both data-first and data-last calling styles are implemented with the `dual` combinator from `repos/effect/packages/effect/src/Function.ts`. The public signature uses an overloaded object type:

```ts
// repos/effect/packages/effect/src/Effect.ts, lines 5170-5173
export const map: {
  <A, B>(f: (a: A) => B): <E, R>(self: Effect<A, E, R>) => Effect<B, E, R>
  <A, E, R, B>(self: Effect<A, E, R>, f: (a: A) => B): Effect<B, E, R>
} = core.map
```

---

## Test conventions

- **Framework**: `@effect/vitest` wraps Vitest and provides Effect-aware test runners. Every test file imports `describe` and `it` from `"@effect/vitest"`, not from `"vitest"` directly (see `repos/effect/packages/effect/test/Array.test.ts:1`).
- **Assertion helpers**: `deepStrictEqual`, `strictEqual`, `assertSome`, `assertNone`, `throws` are imported from `"@effect/vitest/utils"` (`repos/effect/packages/effect/test/Array.test.ts:2`).
- **Colocation**: One test file per public module, named `<Module>.test.ts`, in a sibling `test/` directory. `Channel` is a subdirectory (`test/Channel/`) for its large test surface.
- **Shared config**: All packages inherit from `repos/effect/vitest.shared.ts`, which sets `"include": ["test/**/*.test.ts"]`, `"sequence": { "concurrent": true }`, and a shared `setupFiles` (`repos/effect/vitest.shared.ts:12-20`). Each package's `vitest.config.ts` calls `mergeConfig(shared, config)` and may add coverage settings (`repos/effect/packages/effect/vitest.config.ts`).
- **Deep imports in tests**: `@effect/cli` tests import via the package's deep-import paths (e.g. `import * as Args from "@effect/cli/Args"`), while `effect` tests import via the namespace re-exports (e.g. `import { Array as Arr } from "effect"`). Both styles appear in the repo.
- **`runEffect` helper**: In `@effect/cli` tests, a local `const runEffect = <E, A>(…) => Effect.provide(self, NodeContext.layer).pipe(Effect.runPromise)` pattern is common (`repos/effect/packages/cli/test/Args.test.ts:22-24`).

---

## Release / versioning

- **Changesets**: The monorepo uses `@changesets/cli`. New changes ship with a `.md` file in `.changeset/` describing the bump type (`patch`, `minor`, `major`) and affected packages. The config at `repos/effect/.changeset/config.json` sets:
  - `"access": "restricted"` — individual packages must opt-in to `"public"` in their own `publishConfig` (all packages in the repo do: `"publishConfig": { "access": "public", "provenance": true, "directory": "dist" }`).
  - `"updateInternalDependencies": "patch"` — internal cross-package deps receive at least a patch bump when a dependency changes.
  - `"baseBranch": "main"` — changesets are cut relative to `main`.

- **Semver policy**: The core `effect` package is at `3.x.y` (currently `3.21.2`). Subpackages use independent versioning at `0.x.y` (`@effect/cli@0.75.1`, `@effect/sql@0.51.1`). This means the core package follows semver with `MAJOR.MINOR.PATCH`, while subpackages treat `MINOR` changes as potentially breaking (the `0.x` convention).

- **Prerelease tagging**: The changeset config supports snapshots via `"prereleaseTemplate": "{tag}-{commit}"` (`repos/effect/.changeset/config.json:11`). Prerelease packages are published by running `changeset publish` with a snapshot tag rather than the normal version bump workflow.

- **Release script**: `changeset-publish` in `repos/effect/package.json` runs `pnpm codemod && pnpm build && TEST_DIST= pnpm vitest && changeset publish` — it codemods, full-builds, runs the test suite against the dist output, and then publishes.

- **Provenance**: All packages set `"provenance": true` in `publishConfig`, enabling npm publish provenance attestation.

**Surprising finding**: `"commit": false` in the changeset config — changesets do not auto-commit. Engineers open PRs with changeset files committed manually; the version-bump commit is produced by a CI step that runs `changeset version`.
