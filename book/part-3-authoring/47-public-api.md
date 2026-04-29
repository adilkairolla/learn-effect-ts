# Chapter 47 — Designing the public API — the `.make` constructor and the service `Tag`

> **Worked-example commit:** `worked-example/` chapter 47 — `feat: define Cache tag and CacheService interface`
> **Patterns demonstrated:** [`.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors), [`Context.GenericTag` / `Tag` class / `Reference` — tag variants](../../research/02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants)
> **Reads from:** [Chapter 08 — Context and Tags](../part-1-foundations/08-context-and-tags.md), [Chapter 09 — Layer](../part-1-foundations/09-layer.md), [Chapter 11 — Constructors](../part-1-foundations/11-constructors.md)
> **Reads into:** Chapter 51 (the first Layer implements this Tag), Chapter 53 (dual API exposes the methods on this Tag)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

The most consequential decision you make as a library author is the one you make earliest: what does the public API look like? Every subsequent chapter in Part III is shaped by the answer we give here. The `Cache` tag string (`"@example/effect-cache/Cache"`), the five methods on `CacheService`, the distinction between the interface and the class — these choices propagate through Layer implementations (Chapters 51–52), the dual API (Chapter 53), the test suite (Chapter 56), and the JSDoc (Chapter 57). Changing a method signature after Layer implementations land is painful. Changing the tag identifier after consumers have persisted it to logs or serialized it to config is worse.

This chapter deliberately commits the shape before any logic is written. The idea is borrowed from design-by-contract disciplines: decide what the contract is before deciding how to honour it. In Effect terms, that means writing the `Context.Tag`, the service interface, and the `make` stub while leaving every method body as an `Effect.die`. The type system enforces the contract; the runtime enforcement comes later.

There is a secondary benefit to this order. When the interface comes first, every later chapter has a fixed target. The test chapter (Chapter 56) tests against `CacheService`, not against any specific implementation class. The dual API chapter (Chapter 53) wraps `CacheService` methods without knowing how they are implemented. The internal refactor chapter (Chapter 54) can reorganize files freely because the public surface is already frozen. Landing the API surface before the implementation is what makes this sequence possible.

The chapter also introduces three placeholder type aliases — `CacheKey`, `CacheError`, and `CacheEvent` — that will be replaced by real, branded, or tagged types in Chapters 48, 50, and 55 respectively. The prose is explicit about this substitution so the reader knows what is provisional.

---

## What we already have

After Chapter 46, `worked-example/` contains six configuration files plus the two design documents from Chapter 45, across four commits:

```bash
$ git -C worked-example log --oneline
79d5da5 fix: typecheck script uses -p not -b for --noEmit
8b59b08 chore: initial package.json, tsconfig, vitest.config, gitignore
99b1b8f fix: CacheKey constructor call, README imports
10c9764 chore: initial README and design notes

$ ls worked-example/
DESIGN.md  README.md  package.json  tsconfig.build.json
tsconfig.json  tsconfig.src.json  vitest.config.ts  .gitignore
```

There is no `src/` directory. `tsconfig.src.json` already declares `"rootDir": "src"` and `"include": ["src"]` in anticipation of this chapter, but TypeScript has nothing to compile. Running `npm run typecheck` in `worked-example/` today would invoke `tsc -p tsconfig.src.json --noEmit` and pass vacuously with zero source files.

The `DESIGN.md` from Chapter 45 already specifies the intended interface in prose form — five methods, a `Stream` of events, no synchronous accessors. This chapter is where that prose specification becomes a TypeScript type.

---

## What we're adding

Two files in `src/`:

| File | Role |
|---|---|
| `src/Cache.ts` | `Cache` Tag class, `CacheService` interface, `make` stub |
| `src/index.ts` | Barrel re-export — `export * from "./Cache.js"` |

`src/Cache.ts` is the heart of the chapter: the `Cache extends Context.Tag(...)<Cache, CacheService>()` declaration, the `CacheService` interface spelling out the five operations, and a `make` stub that throws via `Effect.die` to signal it is not yet implemented. Three local type aliases — `CacheKey`, `CacheError`, `CacheEvent` — stand in for the branded and tagged types that land in later chapters.

`src/index.ts` is a one-line barrel. It uses the `.js` extension on the import path, which is the correct form for ESM packages under `"moduleResolution": "NodeNext"` — TypeScript resolves `./Cache.js` to the TypeScript source file `./Cache.ts` at compile time, but the emitted JavaScript imports remain `.js` as required by Node.js ESM.

---

## The code

### `src/Cache.ts` (new)

```ts
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"

// Forward declarations — these types land in later chapters.
// Ch 48 introduces CacheError variants; Ch 50 introduces CacheKey; Ch 55 introduces CacheEvent.
// For Ch 47 we use placeholders so the interface signature is clear without the imports.
type CacheKey = string
type CacheError = unknown
type CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }

/**
 * The shape of the cache service. Implementations are provided as Layers in
 * subsequent chapters (`Cache.layerMemory` in Chapter 51, `Cache.layerMemoryWithEviction`
 * in Chapter 52).
 */
export interface CacheService {
  readonly get: (key: CacheKey) => Effect.Effect<Option.Option<unknown>, CacheError>
  readonly set: (key: CacheKey, value: unknown, ttlMillis?: number) => Effect.Effect<void, CacheError>
  readonly delete: (key: CacheKey) => Effect.Effect<void, CacheError>
  readonly invalidate: Effect.Effect<void, CacheError>
  readonly events: Stream.Stream<CacheEvent>
}

/**
 * The Cache service tag. Use `Effect.gen` and `yield* Cache` to access the service
 * inside an Effect, or pass a Cache implementation via `Effect.provideService(Cache, impl)`.
 */
export class Cache extends Context.Tag("@example/effect-cache/Cache")<Cache, CacheService>() {}

/**
 * Stub `.make` constructor — returns a placeholder service. The real implementations
 * land in Chapter 51 (`Cache.layerMemory`) and Chapter 52 (`Cache.layerMemoryWithEviction`).
 */
export const make = (): Effect.Effect<CacheService, never> =>
  Effect.die("Cache.make: not implemented yet — see Chapter 51 for the in-memory layer")
```

#### The placeholder types

`CacheKey`, `CacheError`, and `CacheEvent` are local `type` aliases — not exported, not branded, not tagged. They exist here for one purpose: to make the method signatures in `CacheService` readable without importing types that do not exist yet.

- **`CacheKey = string`** — Chapter 50 replaces this with `string & Brand.Brand<"CacheKey">` and a constructor `CacheKey = Brand.nominal<CacheKey>()`. Until then, any `string` satisfies `CacheKey`.
- **`CacheError = unknown`** — Chapter 48 replaces this with a union of three `Data.TaggedError` variants (`Missing`, `Backend`, `Encoding`). Using `unknown` here is the widest possible type: the error channel accepts any error in Ch 47, which is vacuously correct (nothing can produce an error yet anyway, since `make` calls `Effect.die`).
- **`CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }`** — Chapter 55 replaces this with a proper `Data.TaggedEnum` discriminated union. The inline shape here communicates the intent without introducing the full Chapter 55 machinery.

The chapter prose must be explicit: these three types are provisional. When Chapters 48, 50, and 55 land their respective implementations, the `type` aliases in this file are deleted and replaced with real imports. The method signatures on `CacheService` do not change — only the types behind them become more precise.

#### The `CacheService` interface

Five members:

- **`get`** — looks up a key and returns `Option.Option<unknown>`. The `Option` rather than a nullable signals to callers that a cache miss is not an error: it is a legitimate outcome modelled in the type system. Callers who need to treat a miss as a failure use `Option.match` or `Effect.flatMap` with an appropriate handler. The `Option` here is sourced from `effect/Option` — see [Chapter 06 — Typed errors](../part-1-foundations/06-typed-errors.md) and the Option/Either patterns in Part I for a refresher on when to use `Option` versus the error channel.

- **`set`** — stores a value with an optional per-entry TTL override. The `ttlMillis?: number` parameter means callers can override the global TTL for a specific entry without reconfiguring the whole cache. The global TTL default is determined by `CacheConfig` (Chapter 49).

- **`delete`** — removes a single entry by key. Returns `Effect.Effect<void, CacheError>` rather than `Effect.Effect<boolean, CacheError>` — we do not signal whether the key existed. Callers who need to know should `get` first.

- **`invalidate`** — `Effect.Effect<void, CacheError>` (not a function, a value). This is an important distinction: `invalidate` is a property of type `Effect`, not a method that returns an Effect. Callers write `yield* cache.invalidate`, not `yield* cache.invalidate()`. The pattern is consistent with how Effect's own services expose zero-argument effectful operations — compare `Clock.currentTimeMillis` in `effect/Clock`, which is also an `Effect<number>` property rather than a `() => Effect<number>` method.

- **`events`** — `Stream.Stream<CacheEvent>`. A cold-ish stream backed by `PubSub.unbounded` (Chapter 55). Multiple subscribers can independently consume events. No `R` (requirements) channel: the stream is self-contained after the layer provides the `PubSub`.

#### The `Cache` Tag

```ts
export class Cache extends Context.Tag("@example/effect-cache/Cache")<Cache, CacheService>() {}
```

`Context.Tag` is the higher-kinded function at `repos/effect/packages/effect/src/Context.ts:507-524`. Its JSDoc (lines 507–523) shows the canonical form:

```ts
class MyTag extends Context.Tag("MyTag")<
 MyTag,
 { readonly myNum: number }
>() {
 static Live = Layer.succeed(this, { myNum: 108 })
}
```

The two type parameters to the generic application `<Cache, CacheService>` are: the tag's own class (`Cache`, used for the `Tag<Cache, CacheService>` phantom type) and the service shape (`CacheService`). The empty `()` at the end invokes the curried factory — `Context.Tag("id")` returns a curried function, and calling it with `<Self, Shape>()` (no arguments, just type parameters) returns the `TagClass` that we subclass. The `extends ... {}` is an empty subclass that gives us a stable nominal type.

For a real-world production example of this exact pattern, see `repos/effect/packages/effect/src/DateTime.ts:1059-1063`:

```ts
/**
 * @since 3.11.0
 * @category current time zone
 */
export class CurrentTimeZone extends Context.Tag("effect/DateTime/CurrentTimeZone")<CurrentTimeZone, TimeZone>() {}
```

`CurrentTimeZone` is a tag for a simple service (a time zone value). The string identifier is namespaced under `"effect/DateTime/"` — the same convention we follow with `"@example/effect-cache/"`. Effect's own packages use the package name as a namespace prefix to avoid collisions when multiple packages register tags into the same context.

#### The `make` stub

```ts
export const make = (): Effect.Effect<CacheService, never> =>
  Effect.die("Cache.make: not implemented yet — see Chapter 51 for the in-memory layer")
```

`Effect.die` produces a defect — an unrecoverable error that bypasses the typed error channel. This is the correct signal for a stub: it should not compile silently into a `never` or return `undefined`; it should crash immediately and visibly if called before the real implementation lands. The error channel is `never` because the stub never fails with a typed error.

### `src/index.ts` (new)

```ts
export * from "./Cache.js"
```

A single wildcard re-export. The `.js` extension is mandatory under `"moduleResolution": "NodeNext"` — the TypeScript compiler resolves `.js` import paths to the corresponding `.ts` source file during type-checking and preserves the `.js` extension in emitted output, which is what Node.js ESM requires at runtime. This was covered in Chapter 46 when we set `"module": "NodeNext"`.

---

## Why this design choice

### Tag class (subclass) over `Context.GenericTag`

`Context.GenericTag` (`repos/effect/packages/effect/src/Context.ts:167-182`) creates a tag from a plain string key without defining a class:

```ts
const Cache = Context.GenericTag<CacheService>("@example/effect-cache/Cache")
```

This works, but has two drawbacks. First, the resulting `Tag<CacheService, CacheService>` has identical identifier and service type, which means TypeScript uses structural typing: any object matching `CacheService` can be used as the identifier. The `Tag class` form (`Cache extends Context.Tag(...)<Cache, CacheService>()`) gives the tag a distinct nominal identifier type (`Cache`) separate from the service type (`CacheService`), which improves error messages and prevents accidental tag aliasing.

Second, the `GenericTag` form loses the stable class name in debugger views, serialized errors, and `Layer` error messages. The `Tag class` form preserves `Cache` as the constructor name throughout the Effect runtime's diagnostic output.

### Interface separate from the class

`CacheService` is a plain `interface`, not merged into the `Cache` class. This separation has two benefits. First, it is straightforward to implement `CacheService` in tests without subclassing `Cache`:

```ts
const testCache: CacheService = {
  get: () => Effect.succeed(Option.none()),
  set: () => Effect.void,
  delete: () => Effect.void,
  invalidate: Effect.void,
  events: Stream.empty
}

Effect.provideService(program, Cache, testCache)
```

Second, it matches what Effect's own packages do. The `CacheService` pattern mirrors `@effect/platform`'s approach (Chapter 22): a `Tag` class with a separate named service interface. An alternative is to embed the interface inline in the tag's type parameter (as `CurrentTimeZone` does — the service type is simply `TimeZone`), but for a service with five methods an inline type becomes hard to read and impossible to import without importing the class.

### `Effect.Service` not used

`Effect.Service` (`repos/effect/packages/effect/src/Effect.ts:13540-13585`) combines Tag + Layer + service shape into a single class declaration, which is ergonomic for simple services. However, its JSDoc explicitly warns:

> `@experimental might be up for breaking changes`

Because Part III is building a library intended for publication and long-term stability, using an `@experimental` API as the foundation of the entire `Cache` service would be a liability. A future minor release could change the generated class shape or the `Layer` interface in a way that breaks compilation for all consumers. The `Context.Tag` subclass pattern has been stable since Effect 2.0.0 (as confirmed by the `@since 2.0.0` annotation at `Context.ts:521`) and is the pattern used throughout Effect's own published packages.

> _Note: If `Effect.Service` stabilizes in a future Effect release (dropping the `@experimental` tag), it would be a valid replacement for the boilerplate here. The worked example will call this out in Chapter 60's retrospective._

---

## What's still missing

After this chapter, `src/Cache.ts` has the right shape but every implementation is a stub:

- **No typed errors.** `CacheError = unknown` is a placeholder. Chapter 48 replaces it with a `Data.TaggedError` union — `CacheError.Missing`, `CacheError.Backend`, `CacheError.Encoding` — giving callers `Effect.catchTag` recovery.

- **No `Schema`-driven config.** The optional `ttlMillis` on `set` is an unvalidated `number`. Chapter 49 introduces `CacheConfig` as a `Schema.Class` that enforces TTL bounds and integrates with `Config.redacted`.

- **No branded key.** `CacheKey = string` means any string satisfies the key type. Chapter 50 introduces `Brand.nominal<CacheKey>()` (where `CacheKey = string & Brand.Brand<"CacheKey">`) to prevent accidental raw-string misuse — a `string` will no longer compile where a `CacheKey` is required.

- **No Layer implementation.** `Cache.make` calls `Effect.die`. Chapter 51 adds `Cache.layerMemory` via `Layer.effect`; Chapter 52 adds `Cache.layerMemoryWithEviction` via `Layer.scoped`.

- **No dual API.** Each method is invoked via the service directly (`cache.get(key)`). Chapter 53 wraps every method in `Function.dual` so callers can write both `Cache.get(cache, key)` (data-first) and `cache.pipe(Cache.get(key))` (data-last).

- **No `CacheEvent` implementation.** `events` is typed as `Stream.Stream<CacheEvent>` but the `PubSub` backing it does not exist yet. Chapter 55 introduces the `PubSub.unbounded`-backed implementation.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add src/Cache.ts src/index.ts
git commit -m "feat: define Cache tag and CacheService interface"
```

After this commit, `git log --oneline` shows:

```bash
770a49e feat: define Cache tag and CacheService interface
79d5da5 fix: typecheck script uses -p not -b for --noEmit
8b59b08 chore: initial package.json, tsconfig, vitest.config, gitignore
99b1b8f fix: CacheKey constructor call, README imports
10c9764 chore: initial README and design notes
```

> _Note: Running `npx tsc -p tsconfig.src.json --noEmit` inside `worked-example/` will fail if `effect` is not installed (there is no `node_modules/` in the repo). This is expected — the worked example is a narrated repository, not a fully-runnable build. The build setup chapter (Chapter 46) committed `package.json` with `"peerDependencies": { "effect": "^3.21.0" }`, but `npm install` was intentionally deferred. A reader who wants to typecheck locally should run `npm install` first._

---

## See also

- [Chapter 48 — Typed errors — `CacheError` variants with `Data.TaggedError`](../part-3-authoring/48-typed-errors.md) — the `CacheError = unknown` placeholder in this chapter is replaced by real tagged error variants; `get`, `set`, `delete`, and `invalidate` gain precise error channels
- [Chapter 50 — Branded keys — `CacheKey` with `Brand.nominal`](../part-3-authoring/50-branded-keys.md) — `CacheKey = string` is replaced by a nominal brand; method signatures become stricter
- [Chapter 51 — First Layer — `Cache.layerMemory` with `Layer.effect`](../part-3-authoring/51-layer-memory.md) — the `make` stub that `Effect.die`s is replaced by the first real implementation of `CacheService`
- [Chapter 53 — Dual API — `Function.dual` overloads on the Cache service](../part-3-authoring/53-dual-api.md) — the five `CacheService` methods defined here are wrapped in `Function.dual` to expose both data-first and data-last call styles
- [Chapter 55 — Cache events — `PubSub.unbounded` and `Stream`](../part-3-authoring/55-events.md) — the `events: Stream.Stream<CacheEvent>` property defined here is backed by a real `PubSub`
- [Chapter 08 — Context and Tags](../part-1-foundations/08-context-and-tags.md) — foundational chapter on `Context.Tag`, how tags work as keys in the Effect context map, and how `yield* Tag` accesses a service inside `Effect.gen`
- [Chapter 09 — Layer](../part-1-foundations/09-layer.md) — explains `Layer.succeed`, `Layer.effect`, and `Layer.scoped`; the `Cache` tag defined here is the target for the layers in Chapters 51–52
- [Chapter 11 — Constructors](../part-1-foundations/11-constructors.md) — the `.make` naming convention followed by `Cache.make` is established here; every Effect module exposes a `.make` factory as its primary entry point
- [Chapter 22 — Platform services — the abstract runtime layer](../part-2-tour/22-platform.md) — `@effect/platform` is the canonical example of Tag + separate-interface design; `Cache` follows the same pattern at smaller scale
- [Patterns catalog — `.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors)
- [Patterns catalog — `Context.GenericTag` / `Tag` class / `Reference` — tag variants](../../research/02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants)
