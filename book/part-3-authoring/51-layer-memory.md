# Chapter 51 — The first Layer — `Layer.succeed` for the in-memory implementation

> **Worked-example commit:** `worked-example/` chapter 51 — `feat: in-memory storage layer with Ref-backed map`
> **Patterns demonstrated:** [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors), [`Ref` — atomic mutable cell](../../research/02-patterns-catalog.md#ref--atomic-mutable-cell)
> **Reads from:** [Chapter 09 — Layers and dependency injection](../part-1-foundations/09-layers.md), [Chapter 36 — Concurrency primitives — Ref](../part-2-tour/36-concurrency-primitives.md)
> **Reads into:** Chapter 52 (eviction wraps this layer), Chapter 53 (dual module-level API), Chapter 54 (storage interface refactored), Chapter 56 (tests use `layerMemory` directly)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

The five preceding chapters established the full type skeleton of `@example/effect-cache`: a service tag (`Cache`), a typed error channel (`CacheError`), a schema-validated config type (`CacheConfig`), and a branded key type (`CacheKey`). Everything compiled. Nothing ran. `Cache.make()` still called `Effect.die(...)`.

This chapter makes the cache work for the first time. It introduces two additions:

1. **`src/internal/MemoryStorage.ts`** — an internal module that builds a `CacheService` backed by a `Ref<HashMap<CacheKey, Entry>>`. This is the in-memory implementation: no external dependencies, no persistence, no eviction (that arrives in Chapter 52), but fully functional `get`, `set`, `delete`, and `invalidate` operations.

2. **`Cache.layerMemory`** — a single-line exported `Layer` that wires `MemoryStorage.make` into the `Cache` tag. Any Effect that requires `Cache` can be satisfied by providing `Cache.layerMemory`.

The chapter title says "Layer.succeed" because that is the simplest Layer constructor and the natural first concept to reach for. But the actual implementation needs `Layer.effect` — the constructor for layers that require effectful initialization. The distinction, why it matters, and when each applies is the central design lesson of this chapter.

A secondary lesson is the choice of `Ref<HashMap<CacheKey, Entry>>` over a plain JavaScript `Map`. Both work at runtime. Only the Effect-native option is safe under concurrent access, compatible with the Effect fiber scheduler, and testable in isolation. The in-memory implementation deliberately avoids eviction — that is a scheduling concern that belongs in Chapter 52, not in the storage primitive.

---

## What we already have

After Chapter 50, `worked-example/` has eight commits (most recent: `10d38f4 feat: brand CacheKey for nominal typing`).

The current `src/Cache.ts` defines the `Cache` tag and a `CacheService` interface with five members:

```ts
export interface CacheService {
  readonly get: (key: CacheKey) => Effect.Effect<Option.Option<unknown>, CacheError>
  readonly set: (key: CacheKey, value: unknown, ttlMillis?: number) => Effect.Effect<void, CacheError>
  readonly delete: (key: CacheKey) => Effect.Effect<void, CacheError>
  readonly invalidate: Effect.Effect<void, CacheError>
  readonly events: Stream.Stream<CacheEvent>
}
```

The `make` export is a stub that calls `Effect.die(...)`. No Layer exists. No implementation exists.

`src/CacheConfig.ts` defines a `CacheConfig` class (via `Schema.Class`) with three validated integer fields: `defaultTtlMillis`, `maxEntries`, and `evictionIntervalMillis`. It also exports a `load` effect that reads from environment variables. However, `CacheConfig` has no `Context.Tag` yet — it cannot be requested from the Effect context via `yield*`. This chapter adds that tag as part of plumbing the config dependency.

---

## What we're adding

| File | Change |
|---|---|
| `src/internal/MemoryStorage.ts` | **New.** `CacheService` implementation backed by `Ref<HashMap<CacheKey, Entry>>`. Internal — not re-exported from `index.ts`. |
| `src/Cache.ts` | **Modified.** Add `import * as Layer` and `import * as MemoryStorage`. Export `layerMemory: Layer.Layer<Cache, never, CacheConfig>`. |
| `src/CacheConfig.ts` | **Modified.** Add `CacheConfig.Tag` (a `Context.GenericTag<CacheConfig>`) and a module-level `layer` export that wires `load` into a `Layer.Layer<CacheConfig, ...>`. |

`src/index.ts` does not change. `internal/` is private by convention — consumers never import from it directly. `Cache.layerMemory` is already exported via `Cache.ts`, which is re-exported by `index.ts`.

---

## The code

### `src/CacheConfig.ts` (modified)

The `CacheConfig` class needs to be addressable as an Effect service so that `MemoryStorage.make` can declare it in its `R` type and receive it from the layer graph. This requires a `Context.Tag`. We add it as a static property on the class:

```ts
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
// ... other imports unchanged

export class CacheConfig extends Schema.Class<CacheConfig>("CacheConfig")({
  defaultTtlMillis: Schema.Number.pipe(Schema.int(), Schema.positive()),
  maxEntries: Schema.Number.pipe(Schema.int(), Schema.positive()),
  evictionIntervalMillis: Schema.Number.pipe(Schema.int(), Schema.positive())
}) {
  static readonly Tag = Context.GenericTag<CacheConfig>("@example/effect-cache/CacheConfig")
}

export const load: Effect.Effect<CacheConfig, ConfigError.ConfigError | ParseResult.ParseError> =
  // ... unchanged

export const layer: Layer.Layer<CacheConfig, ConfigError.ConfigError | ParseResult.ParseError> =
  Layer.effect(CacheConfig.Tag, load)
```

`Context.GenericTag` is defined at `repos/effect/packages/effect/src/Context.ts:167-182`. It creates a `Tag<Identifier, Service>` keyed by the provided string. The tag's `Identifier` type is `CacheConfig` — the class type — which means `yield* CacheConfig.Tag` inside `Effect.gen` resolves to an instance of `CacheConfig`. The string key `"@example/effect-cache/CacheConfig"` must be globally unique to avoid collisions in larger layer graphs.

The `layer` export is defined after `load` (at module level, below the class) to avoid a temporal dead-zone issue: if `layer` were a static class field that referenced `load`, it would capture `undefined` because `const load` has not yet been initialised when the class body runs.

### `src/internal/MemoryStorage.ts` (new)

```ts
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { CacheConfig } from "../CacheConfig.js"
import type { CacheError } from "../CacheError.js"
import type { CacheKey } from "../CacheKey.js"
import type { CacheService } from "../Cache.js"

type Entry = { readonly value: unknown; readonly expiresAt: number }

export const make: Effect.Effect<CacheService, never, CacheConfig> = Effect.gen(function* () {
  const config = yield* CacheConfig.Tag
  const ref = yield* Ref.make<HashMap.HashMap<CacheKey, Entry>>(HashMap.empty())

  const service: CacheService = {
    get: (key) =>
      Ref.get(ref).pipe(
        Effect.map((map) =>
          Option.flatMap(HashMap.get(map, key), (entry) =>
            entry.expiresAt > Date.now() ? Option.some(entry.value) : Option.none()
          )
        )
      ),

    set: (key, value, ttlMillis) =>
      Ref.update(ref, (map) =>
        HashMap.set(map, key, {
          value,
          expiresAt: Date.now() + (ttlMillis ?? config.defaultTtlMillis)
        })
      ),

    delete: (key) => Ref.update(ref, (map) => HashMap.remove(map, key)),

    invalidate: Ref.set(ref, HashMap.empty()),

    events: Stream.empty
  }

  return service
})
```

#### API citations

**`Ref.make`** — `repos/effect/packages/effect/src/Ref.ts:65-69`

```ts
/**
 * @since 2.0.0
 * @category constructors
 */
export const make: <A>(value: A) => Effect.Effect<Ref<A>> = internal.make
```

`Ref.make(HashMap.empty())` returns `Effect<Ref<HashMap<CacheKey, Entry>>>`. It must be yielded inside `Effect.gen` — it is not a synchronous allocation. This is the key invariant that forces `Layer.effect` over `Layer.succeed` (discussed below).

**`Ref.get`** — `repos/effect/packages/effect/src/Ref.ts:71-75`

```ts
/**
 * @since 2.0.0
 * @category getters
 */
export const get: <A>(self: Ref<A>) => Effect.Effect<A> = internal.get
```

Returns an `Effect` that reads the current value atomically. The `Ref.get(ref).pipe(Effect.map(...))` chain in `get` reads the map, then transforms the result without any further effects.

**`Ref.update`** — `repos/effect/packages/effect/src/Ref.ts:141-147`

```ts
/**
 * @since 2.0.0
 * @category utils
 */
export const update: {
  <A>(f: (a: A) => A): (self: Ref<A>) => Effect.Effect<void>
  <A>(self: Ref<A>, f: (a: A) => A): Effect.Effect<void>
} = internal.update
```

`Ref.update` applies a pure function atomically — the function receives the current value and returns the new value. Used for `set` and `delete`, both of which transform the map without reading it for any other purpose.

**`Ref.set`** — `repos/effect/packages/effect/src/Ref.ts:122-129`

```ts
/**
 * @since 2.0.0
 * @category utils
 */
export const set: {
  <A>(value: A): (self: Ref<A>) => Effect.Effect<void>
  <A>(self: Ref<A>, value: A): Effect.Effect<void>
} = internal.set
```

`invalidate` is implemented as `Ref.set(ref, HashMap.empty())`. Note it is evaluated eagerly — the `Effect` is captured at service-construction time (when `make` runs), not deferred per call. This is intentional: `invalidate` is a property on `CacheService`, not a method. The `ref` is captured in the closure; the `Effect` is the same object each time the caller yields `cache.invalidate`.

**`HashMap.empty`** — `repos/effect/packages/effect/src/HashMap.ts:102-108`

```ts
/**
 * Creates a new `HashMap`.
 *
 * @since 2.0.0
 * @category constructors
 */
export const empty: <K = never, V = never>() => HashMap<K, V> = HM.empty
```

`HashMap.empty()` — note the call parentheses. `HashMap.empty` is a function, not a constant value. The type parameters default to `never` and are inferred from the annotation on `Ref.make<HashMap.HashMap<CacheKey, Entry>>`.

**`HashMap.get`** — `repos/effect/packages/effect/src/HashMap.ts:139-149`

```ts
/**
 * Safely lookup the value for the specified key in the `HashMap` using the
 * internal hashing function.
 *
 * @since 2.0.0
 * @category elements
 */
export const get: {
  <K1 extends K, K>(key: K1): <V>(self: HashMap<K, V>) => Option<V>
  <K1 extends K, K, V>(self: HashMap<K, V>, key: K1): Option<V>
} = HM.get
```

Returns `Option<V>` — `Some<Entry>` if the key exists, `None` if not. The return is synchronous (no `Effect` wrapper) because `HashMap` is a pure persistent data structure.

**`HashMap.set`** — `repos/effect/packages/effect/src/HashMap.ts:218-227`

```ts
/**
 * Sets the specified key to the specified value using the internal hashing
 * function.
 *
 * @since 2.0.0
 */
export const set: {
  <K, V>(key: K, value: V): (self: HashMap<K, V>) => HashMap<K, V>
  <K, V>(self: HashMap<K, V>, key: K, value: V): HashMap<K, V>
} = HM.set
```

The method is `HashMap.set`, not `HashMap.insert`. Effect uses `set` for overwrite-on-collision semantics (consistent with ES6 `Map.set`). This is confirmed at the pinned SHA — always verify before writing.

**`HashMap.remove`** — `repos/effect/packages/effect/src/HashMap.ts:382-391`

```ts
/**
 * Remove the entry for the specified key in the `HashMap` using the internal
 * hashing function.
 *
 * @since 2.0.0
 */
export const remove: {
  <K>(key: K): <V>(self: HashMap<K, V>) => HashMap<K, V>
  <K, V>(self: HashMap<K, V>, key: K): HashMap<K, V>
} = HM.remove
```

`delete` is implemented as `Ref.update(ref, (map) => HashMap.remove(map, key))`. The operation is idempotent — calling `delete` on a key that does not exist returns the same map unchanged.

**`Option.flatMap`** — `repos/effect/packages/effect/src/Option.ts:994-1053`

`get` uses `Option.flatMap` to thread the expiry check: if `HashMap.get` returns `None` (key absent), the result is `None`; if it returns `Some(entry)`, the function checks whether the entry is still live. An expired entry returns `Option.none()`. A live entry returns `Option.some(entry.value)`.

**`Option.none`** — `repos/effect/packages/effect/src/Option.ts:135-162`; **`Option.some`** — `repos/effect/packages/effect/src/Option.ts:164-187`. Both are familiar from [Chapter 06 — Option](../part-1-foundations/06-option.md).

**`Stream.empty`** — `repos/effect/packages/effect/src/Stream.ts:1454-1470`

```ts
/**
 * The empty stream.
 * @since 2.0.0
 * @category constructors
 */
export const empty: Stream<never> = internal.empty
```

`events` is `Stream.empty` — a placeholder. The real `PubSub`-backed event stream arrives in Chapter 55. `Stream.empty` produces a stream with element type `never`, which is a subtype of `Stream<CacheEvent>` due to covariance.

### `src/Cache.ts` (modified)

```diff
+ import * as Layer from "effect/Layer"
+ import type { CacheConfig } from "./CacheConfig.js"
+ import * as MemoryStorage from "./internal/MemoryStorage.js"

  // ... CacheService, Cache tag, make stub unchanged ...

+ /**
+  * In-memory CacheService Layer. Backed by a Ref<HashMap<CacheKey, Entry>>.
+  * Reads CacheConfig from the environment.
+  *
+  * No eviction — see Chapter 52 for layerMemoryWithEviction.
+  *
+  * @since 0.1.0
+  * @category layers
+  */
+ export const layerMemory: Layer.Layer<Cache, never, CacheConfig> =
+   Layer.effect(Cache, MemoryStorage.make)
```

**`Layer.effect`** — `repos/effect/packages/effect/src/Layer.ts:283-292`

```ts
/**
 * Constructs a layer from the specified effect.
 *
 * @since 2.0.0
 * @category constructors
 */
export const effect: {
  <I, S>(tag: Context.Tag<I, S>): <E, R>(effect: Effect.Effect<Types.NoInfer<S>, E, R>) => Layer<I, E, R>
  <I, S, E, R>(tag: Context.Tag<I, S>, effect: Effect.Effect<Types.NoInfer<S>, E, R>): Layer<I, E, R>
} = internal.fromEffect
```

`Layer.effect(Cache, MemoryStorage.make)` takes the `Cache` tag and the `make` effect. The resulting `Layer<Cache, never, CacheConfig>` says: "to provide `Cache`, run `MemoryStorage.make`, which requires `CacheConfig` in context." The `never` error type means the layer itself cannot fail at construction time (the config reading and validation happen in the `CacheConfig.layer`, not here).

---

## Why this design choice

### Why `Layer.effect`, not `Layer.succeed`

`Layer.succeed(Tag, value)` is the right tool when the service value already exists as a pure, fully-constructed object — a record of functions, a test double, a constant config. Its signature, at `repos/effect/packages/effect/src/Layer.ts:766-775`, accepts a synchronous value and wraps it in a layer with no requirements and no error channel: `Layer<I>`.

`MemoryStorage.make` is not a pure value. It calls `Ref.make(...)`, which is `Effect<Ref<A>>`. Creating a `Ref` is not synchronous — it participates in the Effect runtime's fiber model and allocates internal state tracked by the runtime. You cannot call `Ref.make(...)` outside of an Effect context. Therefore, the layer must be built from an `Effect`, and the constructor for that is `Layer.effect`.

This is the fundamental rule: **`Layer.succeed` for pure values, `Layer.effect` for effectful construction, `Layer.scoped` when the service also owns a resource requiring cleanup.** The chapter title deliberately names `Layer.succeed` to surface this question early. The answer is always: "use `Layer.succeed` when you can, `Layer.effect` when you must."

A real-world analog: `repos/effect/packages/experimental/src/EventJournal.ts:348-352` shows the same pattern in the Effect repository itself:

```ts
export const layerMemory: Layer.Layer<EventJournal> = Layer.effect(EventJournal, makeMemory)
```

`makeMemory` yields a `PubSub.unbounded()` — another effectful constructor. The resulting layer is named `layerMemory` for the same reason ours is: it signals "backed by in-memory state," as opposed to a future `layerIndexedDb` or `layerSqlite`. This naming convention is idiomatic in Effect packages.

### Why `Ref<HashMap>` over a plain JavaScript `Map`

JavaScript `Map` is mutable and imperative. In an Effect fiber environment, two concurrent fibers could interleave reads and writes to the same `Map` in unpredictable ways. The JavaScript event loop prevents true data races (there is no preemptive threading), but Effect's fibers can yield at any `yield*` — meaning a fiber is not guaranteed to complete a multi-step operation before another fiber runs.

`Ref<A>` is an atomic mutable cell. Every `Ref.get`, `Ref.set`, `Ref.update`, and `Ref.modify` is a single atomic step in the Effect scheduler — no other fiber can observe an intermediate state. `Ref.update(ref, f)` applies `f` to the current value and stores the result in one indivisible step. This is the standard replacement for `let` variables in Effect code, as covered in [Chapter 36 — Concurrency primitives — Ref](../part-2-tour/36-concurrency-primitives.md).

`HashMap<K, V>` is Effect's persistent, immutable, structurally-shared hash map. Each operation (`set`, `remove`) returns a new map rather than mutating the original. The combination of `Ref` (atomic cell) and `HashMap` (immutable value) is the canonical Effect pattern for safe concurrent map access: the cell is mutated atomically, but the map value inside is never mutated.

### Why `CacheKey` works as a `HashMap` key

`HashMap` uses the `Equal` and `Hash` protocols from `effect/Equal` and `effect/Hash`. For primitive values — numbers, strings, and their branded variants — the default implementations use `===` equality and `globalThis.structuredClone`-based hashing. Since `CacheKey` is `string & Brand.Brand<"CacheKey">` and brands are erased at runtime, `CacheKey` values are plain strings at runtime. They hash and compare by value, exactly like ordinary strings. A key `CacheKey("user:42")` and another `CacheKey("user:42")` constructed independently will hash identically and compare as equal in a `HashMap`.

### Why no eviction here

The eviction sweep — walking the map and removing expired entries — belongs in a scheduled fiber, not in the storage primitive. Putting eviction in `MemoryStorage.make` would make the storage module responsible for both data access and lifecycle management, violating separation of concerns. It would also require `Layer.scoped` (to manage the eviction fiber's lifecycle) before the simpler `Layer.effect` has been introduced and understood. Chapter 52 wraps `layerMemory` with a scheduled eviction fiber and exports `layerMemoryWithEviction`. The two-chapter sequence allows the simpler concept (`Layer.effect`, pure storage) to be understood before the more complex one (`Layer.scoped`, resource-managed fiber).

---

## What's still missing

- **Eviction.** Expired entries are filtered in `get` but never removed from the `Ref`. Over time the map grows without bound. Chapter 52 adds a scheduled fiber that sweeps the map on a configurable interval.
- **Event stream.** `events: Stream.empty` is a placeholder. Chapter 55 replaces it with a `PubSub`-backed stream that emits typed `CacheEvent` values on each hit, miss, set, and evict.
- **Dual (module-level) API.** `Cache.get`, `Cache.set`, `Cache.delete` as module-level functions — the "data-last" calling style that avoids `yield* cache` — do not exist yet. Chapter 53 adds them, building on the Layer infrastructure introduced here.
- **Storage abstraction.** `MemoryStorage.ts` directly implements `CacheService`. Chapter 54 introduces a `StorageBackend` interface that separates low-level key/value operations from the higher-level cache semantics. This will allow a Redis or SQLite backend to be swapped in without changing the `CacheService` interface.
- **Tests.** No tests yet. Chapter 56 writes the first test suite using `Cache.layerMemory` as the test layer, demonstrating how `Layer.fresh` isolates each test's state.

---

## Commit

```bash
cd worked-example
git add src/internal/MemoryStorage.ts src/Cache.ts src/CacheConfig.ts
git commit -m "feat: in-memory storage layer with Ref-backed map"
```

Produced commit `0603e9a` on branch `main`.

---

## See also

- [Chapter 09 — Layers and dependency injection](../part-1-foundations/09-layers.md) — introduces `Layer.succeed`, `Layer.effect`, `Layer.scoped`, and the `R` type channel; the foundational reading for this chapter
- [Chapter 36 — Concurrency primitives — Ref](../part-2-tour/36-concurrency-primitives.md) — covers `Ref.make`, `Ref.get`, `Ref.update`, and the atomic update guarantee used throughout `MemoryStorage.ts`
- [Chapter 52 — Eviction fiber](52-eviction-fiber.md) — wraps `layerMemory` with a `Layer.scoped` scheduled sweep, adding `layerMemoryWithEviction`
- [Chapter 53 — Dual API](53-dual-api.md) — module-level `Cache.get` / `Cache.set` / `Cache.delete` functions that work without `yield*`, consuming the layer introduced here
- [Chapter 55 — Event stream](55-event-stream.md) — replaces `events: Stream.empty` with a real `PubSub`-backed stream of typed `CacheEvent` values
- [Chapter 56 — Testing the cache](56-testing.md) — first test suite that provides `Cache.layerMemory` and uses `Layer.fresh` to isolate test state
- [`Layer.succeed` / `effect` / `scoped` pattern catalog entry](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — full decision matrix for which Layer constructor to use and when
- [`Ref` — atomic mutable cell pattern catalog entry](../../research/02-patterns-catalog.md#ref--atomic-mutable-cell) — covers the atomic update guarantee, when to use `SynchronizedRef` instead, and the `let`-variable anti-pattern replaced by `Ref`
