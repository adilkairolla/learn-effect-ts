# Chapter 57 — Documenting with JSDoc — `@since`, `@category`, `@example` tags

> **Worked-example commit:** `worked-example/` chapter 57 — `docs: JSDoc tags on public exports + docgen config`
> **Patterns demonstrated:** [`JSDoc` `@since`, `@category`, `@example` tags](../../research/02-patterns-catalog.md#jsdoc-since-category-example-tags)
> **Reads from:** [Chapter 21 — printer-ansi — monorepo conventions at first encounter](../part-2-tour/21-printer-ansi.md), [Chapter 22 — Platform services — the abstract runtime layer](../part-2-tour/22-platform.md)
> **Reads into:** Chapter 58 (exports map — package.json `"exports"` field), Chapter 59 (publishing — the docs site is generated from these JSDoc blocks)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Every library ships two surfaces: the runtime surface (functions, types, classes) and the documentation surface (the JSDoc you read in your editor). The runtime surface of `effect-cache` has been stable since Chapter 53. The documentation surface has been growing organically as we wrote each chapter, picking up `@since` and `@category` tags along the way — but never systematically, and without `@example` blocks on the most important exports.

This chapter sweeps the public `src/` files and brings the JSDoc up to the standard used throughout the Effect monorepo. The practical goal is threefold. First, every exported symbol needs `@since 0.1.0` so tooling (and humans) can tell when it first appeared and spot accidental regressions across semver boundaries. Second, every exported symbol needs `@category` so that `@effect/docgen` can group related functions on the generated docs site. Third, the ten most-used exports need `@example` blocks — short, self-contained TypeScript snippets that a reader can copy-paste and run.

The chapter also introduces `docgen.json`, the configuration file that `@effect/docgen` reads to know where to find the package, which files to exclude (`src/internal/**`), and what compiler options to use when type-checking the `@example` snippets in isolation.

This is a documentation chapter, not an implementation chapter. No `src/internal/` file is touched. No runtime behaviour changes. The only observable difference is that IDE tooltips become more informative and the docs site (when you run `docgen`) becomes navigable by category.

---

## What we already have

After Chapter 56, `worked-example/src/` contains six public files and two internal files, all covered by eight tests in `test/Cache.test.ts`. The public API is frozen.

Many exports already have `@since 0.1.0` and `@category` from prior chapters — the implementers added them while building each feature:

- `CacheError.ts` — all three error classes have `@since` and `@category errors`.
- `Cache.ts` — `layerMemory`, `layerMemoryWithEviction`, `get`, `set`, `delete`, `invalidate` have `@since` and `@category`.
- `CacheConfig.ts` — the class (`models`), `Tag` (`tags`), `load` (`constructors`), and `layer` (`layers`) all have both tags.
- `CacheEvent.ts` — both the type (`models`) and the `CacheEvent` constructor (`constructors`) are tagged.
- `CacheKey.ts` — both the type and the constructor are tagged.

What is missing is: `@since` and `@category` on `CacheService` and the `Cache` tag class itself, `@example` blocks on any export, and the `docgen.json` config file.

---

## What we're adding

Four things, across six files plus one new file:

1. **`@since 0.1.0` + `@category`** on `CacheService` (models) and the `Cache` tag class (tags), which were the only public exports missing both.
2. **`@example` blocks** on the ten most important exports: `Cache` tag, `Cache.layerMemory`, `Cache.layerMemoryWithEviction`, `Cache.get`, `Cache.set`, `Cache.events`, `CacheConfig`, `CacheConfig.load`, `CacheError.Missing`, `CacheKey`, and `CacheEvent`.
3. **`Cache.events` module-level combinator** — a plain `Effect<Stream<CacheEvent>, never, Cache>` that reads `events` from the service. The service property existed since Chapter 55; the module-level accessor is added here so callers never need to `yield* Cache` manually just to get the stream.
4. **`worked-example/docgen.json`** — the `@effect/docgen` configuration file, modelled on `repos/effect/packages/effect/docgen.json`.

---

## The code

### `worked-example/src/Cache.ts` (modified)

The `CacheService` interface gains `@since` and `@category models`. The `Cache` tag class gains `@since`, `@category tags`, and an `@example` block showing both how to provide the tag via a layer and how to consume it inside `Effect.gen`:

```ts
/**
 * The Cache service tag. Extend `Context.Tag` to wire the service through the
 * Effect dependency graph. Provide via `Cache.layerMemory` or
 * `Cache.layerMemoryWithEviction`; consume via `yield* Cache` inside
 * `Effect.gen`, or use the dual combinators exported from this module.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Cache, CacheConfig, CacheKey } from "@example/effect-cache"
 *
 * const program = Effect.gen(function* () {
 *   const key = CacheKey("user:42")
 *   yield* Cache.set(key, { name: "Alice" }, 60_000)
 *   const value = yield* Cache.get(key)
 *   return value
 * })
 *
 * const layer = Cache.layerMemory.pipe(
 *   (l) => l,
 *   // provide CacheConfig.layer in production
 * )
 * ```
 *
 * @since 0.1.0
 * @category tags
 */
export class Cache extends Context.Tag("@example/effect-cache/Cache")<Cache, CacheService>() {}
```

The `@example` block for `Cache.layerMemory` shows the `Layer.provide` composition that the docs site reader needs to understand before they can use the package at all — it is the first thing anyone building an application will write:

```ts
/**
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { Cache, CacheConfig, CacheKey } from "@example/effect-cache"
 *
 * const AppLayer = Cache.layerMemory.pipe(
 *   Layer.provide(CacheConfig.layer)
 * )
 *
 * const program = Effect.gen(function* () {
 *   const key = CacheKey("session:abc")
 *   yield* Cache.set(key, { userId: 1 }, 300_000)
 *   return yield* Cache.get(key)
 * }).pipe(Effect.provide(AppLayer))
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layerMemory: Layer.Layer<Cache, never, CacheConfig> = Layer.effect(Cache, MemoryStorage.make)
```

The `Cache.get` dual combinator gains an `@example` that shows both call signatures side by side, making the data-last vs data-first distinction concrete:

```ts
/**
 * @example
 * ```ts
 * import { Effect, Option } from "effect"
 * import { Cache, CacheKey } from "@example/effect-cache"
 *
 * // Data-last — service resolved from the Effect context
 * const getUser = (id: string) =>
 *   Cache.get(CacheKey(`user:${id}`)).pipe(
 *     Effect.map(Option.getOrNull)
 *   )
 *
 * // Data-first — service provided explicitly
 * const getExplicit = (svc: Cache["Type"], id: string) =>
 *   Cache.get(svc, CacheKey(`user:${id}`))
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
```

The new `Cache.events` combinator — added at the bottom of `Cache.ts` — is a plain `Effect` value that resolves the service from context and returns its `events` stream. Unlike `get` and `set`, it takes no parameters, so `dual` is unnecessary (the same reasoning applied to `invalidate` in Chapter 53):

```ts
/**
 * @example
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { Cache, CacheEvent, CacheKey } from "@example/effect-cache"
 *
 * const withEventLogging = <A, E, R>(program: Effect.Effect<A, E, R>) =>
 *   Effect.gen(function* () {
 *     const stream = yield* Cache.events
 *     yield* stream.pipe(
 *       Stream.tap((event) =>
 *         Effect.log(
 *           CacheEvent.$match(event, {
 *             Hit:   ({ key }) => `HIT  ${key}`,
 *             Miss:  ({ key }) => `MISS ${key}`,
 *             Set:   ({ key }) => `SET  ${key}`,
 *             Evict: ({ key }) => `EVICT ${key}`
 *           })
 *         )
 *       ),
 *       Stream.runDrain,
 *       Effect.fork
 *     )
 *     return yield* program
 *   })
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const events: Effect.Effect<Stream.Stream<CacheEvent>, never, Cache> = Effect.map(
  Cache,
  (s) => s.events
)
```

Note that `events` has type `Effect<Stream<CacheEvent>, never, Cache>`, not `Stream<CacheEvent, never, Cache>`. This is intentional: the `Stream` is constructed inside the service (it wraps the internal `PubSub`), so you first yield the `Effect` to get the `Stream`, then consume the `Stream`. The test in Chapter 56 — `const stream = yield* Cache.events` then `Stream.runCollect` — follows exactly this pattern. See `repos/effect/packages/effect/src/Stream.ts:2031-2058` for how `Stream.fromPubSub` works.

### `worked-example/src/CacheError.ts` (modified)

The `Missing` error class gets an `@example` showing the most common recovery path — `Effect.catchTag`:

```ts
/**
 * Error raised when a `get` finds no entry for the requested key.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Cache, CacheKey } from "@example/effect-cache"
 *
 * const getOrDefault = (key: string) =>
 *   Cache.get(CacheKey(key)).pipe(
 *     Effect.catchTag("Missing", (_err) =>
 *       Effect.succeed(null)
 *     )
 *   )
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class Missing extends Data.TaggedError("Missing")<{ readonly key: CacheKey }> {}
```

### `worked-example/src/CacheEvent.ts` (modified)

The `CacheEvent` value gains an `@example` that demonstrates both construction and exhaustive matching via the `$match` helper generated by `Data.taggedEnum`:

```ts
/**
 * @example
 * ```ts
 * import { CacheEvent, CacheKey } from "@example/effect-cache"
 *
 * const hit = CacheEvent.Hit({ key: CacheKey("user:42") })
 *
 * const label = CacheEvent.$match(hit, {
 *   Hit:   ({ key }) => `cache hit for ${key}`,
 *   Miss:  ({ key }) => `cache miss for ${key}`,
 *   Set:   ({ key }) => `stored ${key}`,
 *   Evict: ({ key }) => `evicted ${key}`
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const CacheEvent = Data.taggedEnum<CacheEvent>()
```

### `worked-example/docgen.json` (new)

```json
{
  "$schema": "node_modules/@effect/docgen/schema.json",
  "exclude": ["src/internal/**/*.ts"],
  "examplesCompilerOptions": {
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "moduleResolution": "NodeNext",
    "module": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "paths": {
      "@example/effect-cache": ["../src/index.js"],
      "@example/effect-cache/*": ["../src/*.js"],
      "effect": ["../../repos/effect/packages/effect/src/index.js"],
      "effect/*": ["../../repos/effect/packages/effect/src/*.js"]
    }
  }
}
```

The structure mirrors `repos/effect/packages/effect/docgen.json` exactly — `$schema`, `exclude`, and `examplesCompilerOptions` with `paths` for resolving package imports inside `@example` blocks. The one adaptation is `moduleResolution: "NodeNext"` instead of `"Bundler"`: the worked-example uses NodeNext (see `worked-example/tsconfig.src.json`), so the docgen compiler options must match. The `paths` entries point at the local source tree so `@example/effect-cache` resolves to `src/index.js` and `effect` resolves to the pinned monorepo snapshot.

The `exclude` pattern (`src/internal/**/*.ts`) tells docgen not to generate documentation pages for internal modules. This is the same pattern used in every package in `repos/effect/` — internal functions that are technically exported for cross-package use but are not part of the public contract.

---

## Why this design choice

**`@since` enforces semver discipline.** The Effect monorepo uses `@since 2.0.0` on every exported symbol in `repos/effect/packages/effect/src/Effect.ts:2-3`. The contract is simple: the version in `@since` is the minimum version at which the export is available. Removing the tag or lowering the version is a documentation lie that breaks consumers relying on it for compatibility decisions. Tools like `@effect/docgen` and TypeScript language-server plugins can surface this tag inline, so callers see the version in their IDE tooltip without opening docs.

**`@category` organizes the docs site.** Without `@category`, every exported symbol lands in a flat, alphabetical list on the generated docs page. With consistent vocabulary — `constructors`, `combinators`, `layers`, `models`, `errors`, `tags` — the docs site groups them into navigable sections. The taxonomy used here was read directly from `repos/effect/packages/effect/src/Cache.ts` (which uses `models`, `constructors`, and `symbols`) and from `repos/effect/packages/effect/src/Layer.ts` (which adds `getters` and `destructors`). Our package avoids `symbols` (no TypeId exports) and `type-level` (no variance helpers) because those categories appear in Effect core for internal type machinery that `effect-cache` does not expose.

**`@example` makes APIs legible without a guide.** The dual-signature overloads on `Cache.get` and `Cache.set` — inherited from the `dual` helper introduced in Chapter 53 — produce TypeScript signatures that are correct but alien to readers who have not internalized data-last calling conventions. An `@example` block showing both call sites side by side removes the confusion immediately. The `Cache.events` example serves a different purpose: it demonstrates the two-step pattern (`yield* Cache.events` to get the `Stream`, then consume) that the type alone does not explain.

**`@example` blocks in `@effect/docgen` are type-checked.** The `examplesCompilerOptions` section in `docgen.json` exists precisely because `@effect/docgen` extracts every `@example` block and runs `tsc` over it with those options. A broken import path or a type error in an `@example` is caught at docs-generation time, not discovered by a confused consumer. This is why the `paths` entries matter: `@example/effect-cache` must resolve to something the checker can see. If the `paths` are wrong, all examples fail to compile silently.

**`src/internal/**` is excluded.** The internal modules (`MemoryStorage.ts`, `eviction.ts`, `storage.ts`) expose types and functions that the layer implementations need but consumers should never call. Excluding them from docgen means they do not appear in the generated docs at all — not even with an `@internal` marker. This is the same decision made in `@effect/platform` and `@effect/printer`. See [Chapter 22 — Platform services](../part-2-tour/22-platform.md) and [Chapter 54 — Internal modules](./54-internal-modules.md) for the full rationale.

---

## What's still missing

- **Exports map** (`package.json` `"exports"` field) — Without the exports map, consumers can import from `@example/effect-cache/src/internal/MemoryStorage.js` directly, bypassing the public surface entirely. Chapter 58 adds the `"exports"` field that restricts what can be imported and provides separate CJS/ESM entry points. The `docgen.json` `srcLink` field (omitted here because there is no published GitHub URL yet) will also land in Chapter 58 alongside the exports map.
- **Publishing to npm** — `docgen.json` exists but `@effect/docgen` is not installed as a dev dependency and there is no `docs` script in `package.json`. Chapter 59 adds both and runs docgen as part of the release workflow.
- **Docs site hosting** — Chapter 59 also covers deploying the generated markdown to a static site. The generated site will use the `@category` groups established here.
- **`@experimental` markers** — None of the current exports are experimental, but if a future chapter adds one (e.g., a `Cache.layerRedis` backed by an unstable adapter), it should carry `@experimental` and the prose should hedge accordingly per the chapter shape constraints.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add docgen.json src/Cache.ts src/CacheConfig.ts src/CacheError.ts src/CacheKey.ts src/CacheEvent.ts src/index.ts
git commit -m "docs: JSDoc tags on public exports + docgen config"
```

---

## See also

- [`JSDoc @since, @category, @example tags` — patterns catalog](../../research/02-patterns-catalog.md#jsdoc-since-category-example-tags) — the canonical pattern entry; cites `repos/effect/packages/effect/src/Effect.ts:2-3` and `repos/effect/packages/effect/src/Effect.ts:78-80` for the real-world usage
- [Chapter 21 — printer-ansi — monorepo conventions](../part-2-tour/21-printer-ansi.md) — first encounter with `@since` / `@category` tags in a published Effect package; shows the vocabulary in context
- [Chapter 22 — Platform services — abstract runtime layer](../part-2-tour/22-platform.md) — `@effect/platform`'s use of `internal/` exclusion and the Tag+interface pattern that `effect-cache` mirrors
- [Chapter 53 — Dual API — `dual` from effect/Function](./53-dual-api.md) — the dual overloads on `Cache.get` and `Cache.set` that the `@example` blocks in this chapter clarify; `repos/effect/packages/effect/src/Function.ts:31-103`
- [Chapter 54 — Internal modules — the `internal/` folder](./54-internal-modules.md) — establishes why `src/internal/**` is excluded from docgen
- [Chapter 55 — Cache events stream — PubSub + Stream](./55-cache-events-stream.md) — introduces `CacheService.events`; this chapter adds both the module-level `Cache.events` accessor and its `@example`
- [Chapter 58 — Exports map — `package.json` `"exports"` field](./58-exports-map.md) — the next step: restricting importable paths and adding the `srcLink` to `docgen.json`
- [`repos/effect/packages/effect/docgen.json`](../../repos/effect/packages/effect/docgen.json) — the reference file whose structure `worked-example/docgen.json` mirrors; uses `moduleResolution: "Bundler"` where our NodeNext project uses `"NodeNext"`
- [`repos/effect/packages/platform/docgen.json`](../../repos/effect/packages/platform/docgen.json) — platform's docgen config; shows `srcLink` and multi-package `paths` entries in the real monorepo
