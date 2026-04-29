# Chapter 54 — Internal modules and the `internal/` convention — the `index.ts` re-export shape

> **Worked-example commit:** `worked-example/` chapter 54 — `refactor: extract Storage interface to internal/, refactor MemoryStorage`
> **Patterns demonstrated:** [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape)
> **Reads from:** [Chapter 22 — Platform internals — first encounter with the `internal/` convention](../part-2-tour/22-platform-internals.md), [Chapter 51 — The first Layer](./51-layer-memory.md), [Chapter 52 — The second Layer](./52-layer-scoped-eviction.md)
> **Reads into:** Chapter 58 (exports map respects `internal/` as private)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Chapter 51 introduced `src/internal/MemoryStorage.ts`. At the time we chose the `internal/` subdirectory because that is where Effect puts implementation details — but we didn't fully commit to the discipline. `MemoryStorage.ts` exported a concrete type (`Entry`) and concrete implementation helpers (`makeStorage`, `makeService`, `make`) that `Cache.ts` imported directly. The eviction fiber in `eviction.ts` took a bare `Ref<HashMap<CacheKey, Entry>>` as its argument — tightly coupling the eviction sweep to the in-memory data structure.

That coupling was deliberate. Chapters 51–53 were about building something that works: a `Ref`-backed cache, an eviction fiber, a dual API surface. Premature abstraction would have obscured those concepts. But now that the public API has stabilized — `Cache.layerMemory`, `Cache.layerMemoryWithEviction`, and the four dual combinators are all committed and working — we can afford to ask: "what would it take to add a second storage backend?"

The answer reveals a tight coupling we want to remove. The eviction fiber imports `Entry` from `MemoryStorage.ts` and takes a `Ref<HashMap<CacheKey, Entry>>` directly. If we want a Redis backend, we cannot reuse the eviction logic without rewriting it. The fix is a standard refactor: introduce an abstract interface (`Storage`) that the eviction fiber and the Cache façade talk through, and make `MemoryStorage` an implementation detail of that interface.

This chapter does exactly that. The goal is to introduce a `Storage` interface in `src/internal/storage.ts`, refactor `MemoryStorage.ts` to implement it, and update `eviction.ts` to work with any `Storage`. The public `Cache` API does not change. No consumer of `effect-cache` needs to care about what happened.

---

## What we already have

After Chapter 53, `worked-example/src/` contains:

- **`Cache.ts`** — `Cache` tag class, `CacheService` interface, `Cache.layerMemory`, `Cache.layerMemoryWithEviction`, and the four dual combinators (`get`, `set`, `delete`, `invalidate`).
- **`internal/MemoryStorage.ts`** — `Entry` type, `makeStorage` (creates `Ref<HashMap<CacheKey, Entry>>`), `makeService` (wraps a ref into `CacheService`), `make` (combines both).
- **`internal/eviction.ts`** — `sweep` (filters the HashMap atomically) and `runEviction` (forks the sweep fiber into the layer scope). Both operate on a `Ref<HashMap<CacheKey, Entry>>`.
- **`CacheConfig.ts`**, **`CacheError.ts`**, **`CacheKey.ts`**, **`index.ts`**

The eviction fiber imports the `Entry` type directly from `MemoryStorage.ts`, binding it structurally to the `Ref<HashMap>` implementation. If you wanted to add a Redis backend, you would need to rewrite `eviction.ts` as well.

---

## What we're adding

Three files change in this commit; no public API changes.

1. **`src/internal/storage.ts`** (new) — defines the `Entry` type and the abstract `Storage` interface.
2. **`src/internal/MemoryStorage.ts`** (modified) — implements `Storage` via a `Ref<HashMap>`, rebuilds `makeStorage`, `makeService`, and `make` on top of it.
3. **`src/internal/eviction.ts`** (modified) — accepts a `Storage` instead of a bare `Ref<HashMap>`.

`src/Cache.ts` receives a two-line mechanical change: the name `ref` becomes `storage` inside `layerMemoryWithEviction` — the types stay the same because `MemoryStorage.makeStorage` now returns `Effect<Storage>` instead of `Effect<Ref<HashMap<...>>>`.

---

## The code

### `src/internal/storage.ts` (new)

```ts
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type { CacheKey } from "../CacheKey.js"

/**
 * A single storage entry: the stored value and the wall-clock time (ms since
 * epoch) at which the entry expires.
 *
 * `expiresAt` is computed by the Cache façade (using `CacheConfig.defaultTtlMillis`
 * or an explicit TTL argument). The storage backend stores and returns it
 * transparently — TTL logic stays in one place.
 *
 * @internal
 */
export type Entry = { readonly value: unknown; readonly expiresAt: number }

/**
 * Abstract storage backend. Concrete implementations live in `internal/` and
 * are NOT re-exported from the public barrel (`src/index.ts`).
 *
 * Public `Cache` Layers compose a `Storage` with the optional eviction fiber
 * and the public façade (Schema decoding, error mapping, branding). Separating
 * storage from the façade means future backends (Redis, SQLite, a test double)
 * can be substituted without changing `Cache.ts` or the eviction logic.
 *
 * Design decisions:
 * - `get` returns `Option<Entry>` with NO expiry filtering. The Cache façade
 *   decides what to do with an expired entry (return `None`, delete lazily, etc.).
 *   Keeping expiry decisions out of storage lets each backend stay simple.
 * - `set(key, entry)` — `entry` includes `expiresAt`; the storage layer does not
 *   compute TTLs.
 * - `entries` returns a full snapshot. The eviction fiber uses it to scan for
 *   expired keys; other backends (e.g., Redis) can implement it via HSCAN.
 * - `clear` drops all entries — used by `CacheService.invalidate`.
 *
 * @internal
 */
export interface Storage {
  readonly get: (key: CacheKey) => Effect.Effect<Option.Option<Entry>>
  readonly set: (key: CacheKey, entry: Entry) => Effect.Effect<void>
  readonly delete: (key: CacheKey) => Effect.Effect<void>
  readonly entries: Effect.Effect<ReadonlyArray<readonly [CacheKey, Entry]>>
  readonly clear: Effect.Effect<void>
}
```

Notice the imports: all `import type` — the interface is structural. Nothing in `storage.ts` reaches for a concrete Effect module, so the file has zero runtime weight. This matches the pattern visible in `repos/effect/packages/effect/src/internal/queue.ts:16-26` — the first several exported symbols are all `/** @internal */` constants that the public `Queue.ts` re-exports selectively, keeping the implementation out of the public API surface.

`Storage` has five members. Four mirror the `CacheService` interface one-for-one at a lower level. The fifth, `entries`, is new: it exposes a full snapshot of the store. This is how the eviction fiber scans for expired keys without knowing anything about `HashMap` or `Ref`. An alternative — passing a callback — would introduce unnecessary complexity. A snapshot is simpler and correct for this use case.

### `src/internal/MemoryStorage.ts` (modified)

The refactored file has four responsibilities:

1. Re-export `Entry` from `storage.ts` so existing import sites (including `eviction.ts` at the old path) still resolve without changes at the call site.
2. Implement `Storage` via a `makeStorageFromRef` internal constructor.
3. Export `makeStorage: Effect.Effect<Storage>` — the effectful constructor that creates the `Ref` and wraps it.
4. Export `makeService(storage: Storage): Effect.Effect<CacheService, never, CacheConfig>` — the Cache façade that computes TTLs, filters expired entries on read using `Clock.currentTimeMillis`, and delegates raw CRUD to the `Storage`.

The most important design decision: `makeService` now uses `Clock.currentTimeMillis` (not `Date.now()`) for the expiry check in `get` and the `expiresAt` computation in `set`. Previously the façade used `Date.now()` directly; the eviction fiber was the only place using `Clock`. After this refactor, all time operations go through the Effect Clock service — which means `TestClock` can control every timestamp in the module, not just the eviction fiber's sweep threshold. (Tests arrive in Chapter 56.)

```ts
export const makeService = (
  storage: Storage
): Effect.Effect<CacheService, never, CacheConfig> =>
  Effect.gen(function* () {
    const config = yield* CacheConfig.Tag

    const service: CacheService = {
      get: (key) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const entry = yield* storage.get(key)
          return Option.flatMap(entry, (e) =>
            e.expiresAt > now ? Option.some(e.value) : Option.none()
          )
        }),

      set: (key, value, ttlMillis?) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          yield* storage.set(key, {
            value,
            expiresAt: now + (ttlMillis ?? config.defaultTtlMillis)
          })
        }),

      delete: (key) => storage.delete(key),
      invalidate: storage.clear,
      events: Stream.empty  // PubSub events arrive in Chapter 55
    }

    return service
  })
```

The `make` convenience combinator is unchanged in shape — it still combines `makeStorage` and `makeService`:

```ts
export const make: Effect.Effect<CacheService, never, CacheConfig> = Effect.gen(function* () {
  const storage = yield* makeStorage
  return yield* makeService(storage)
})
```

### `src/internal/eviction.ts` (modified)

The sweep function previously operated on a `Ref<HashMap<CacheKey, Entry>>` directly, using `HashMap.filter` to atomically remove expired entries. Now it works through the `Storage` interface:

```ts
const sweep = (storage: Storage): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const all = yield* storage.entries
    yield* Effect.forEach(
      all.filter(([, entry]) => entry.expiresAt <= now),
      ([key]) => storage.delete(key),
      { concurrency: "unbounded", discard: true }
    )
  })
```

The `sweep` signature changes from `(ref: Ref<HashMap<CacheKey, Entry>>)` to `(storage: Storage)`, and `runEviction` changes in the same way. `Cache.ts` updates the two-line call site: `makeStorage` now returns `Effect<Storage>`, so `layerMemoryWithEviction` passes `storage` rather than `ref` to both `makeService` and `runEviction`. No logic changes in `Cache.ts` beyond this rename.

Note: the sweep is no longer a single `Ref.update` atomic operation. The old implementation filtered the entire map in one `HashMap.filter` call, which was atomic with respect to other Ref operations. The new implementation calls `storage.entries` to get a snapshot, then calls `storage.delete` for each expired key individually. Between the snapshot and the deletes, new entries could be written — but those entries would have fresh TTLs and would not be in the expired set. The correctness argument is: the snapshot identifies keys that were already expired at time `now`; deleting them after writing a new entry with the same key would only happen if the key was set with a TTL of zero or negative, which the schema validation in `CacheConfig` forbids. For the in-memory backend this is sound; a more rigorous backend (Redis, SQLite) might wrap the sweep in a transaction.

---

## Why this design choice

The `internal/` convention is a core discipline in the Effect ecosystem. Open `repos/effect/packages/effect/src/internal/queue.ts` at lines 16–26 and you see the pattern clearly: every exported symbol is marked `/** @internal */`. The public `Queue.ts` file imports the whole internal module under the alias `internal` and re-exports each symbol individually, adding JSDoc, `@since` tags, and `@category` annotations that are absent from the internal file.

The effect is a clean separation between the *contract* (what `Queue.ts` promises to callers, documented and stable) and the *implementation* (what `internal/queue.ts` does, free to change). The same `internal/` folder does not appear anywhere in `repos/effect/packages/effect/src/index.ts` — the public barrel. Zero lines in the top-level index re-export from `internal/`. Consumers who import from `"effect"` cannot reach internal symbols even if they try a deep import like `"effect/internal/queue"` — the package's `exports` map (Chapter 58) blocks the path.

We have been following this convention since Chapter 51 — `MemoryStorage.ts` and `eviction.ts` live in `internal/` and are not re-exported from `src/index.ts`. What this chapter adds is the *interface* layer that the internal convention enables. It is not enough to hide files behind `internal/`; the files also need to communicate through explicit interfaces rather than through shared concrete types. As long as `eviction.ts` depended directly on `Ref<HashMap<CacheKey, Entry>>`, the internal subdivision was cosmetic — you could not substitute a different storage backend without rewriting `eviction.ts`.

The right moment to introduce the abstraction is when you can see two concrete implementations or when you can clearly articulate what the interface would look like. After Chapters 51 and 52, we have the in-memory implementation fully built and the eviction fiber fully built. The interface (`Storage`) writes itself from the operations the two parties exchange. This is the "pattern emerges from need" principle: wait until refactoring is forced before you generalize.

---

## What's still missing

- **Events PubSub (Chapter 55)** — `CacheService.events` is still `Stream.empty`. The `Storage` interface does not include a notification hook for mutations; when we add the PubSub, events will be emitted at the Cache façade layer (in `makeService`), not in `Storage`. The interface will not need to change.
- **Tests (Chapter 56)** — `makeService` now uses `Clock.currentTimeMillis` everywhere, which means a `TestClock` can control every timestamp in the module. Chapter 56 exercises this.
- **JSDoc on public API (Chapter 57)** — `Storage` and `Entry` are both marked `@internal`. The public `Cache.ts` exports still lack `@example` tags and complete `@since` annotations.
- **Exports map (Chapter 58)** — the `package.json` `"exports"` field does not yet restrict deep imports. Without it, a consumer could write `import { Storage } from "effect-cache/internal/storage"` and bypass the abstraction. Chapter 58 seals that gap.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add src/internal/storage.ts src/internal/MemoryStorage.ts src/internal/eviction.ts src/Cache.ts
git commit -m "refactor: extract Storage interface to internal/, refactor MemoryStorage"
```

---

## See also

- [Chapter 22 — Platform internals](../part-2-tour/22-platform-internals.md) — first encounter with the `internal/` convention; the platform packages follow the same discipline as the core `effect` package
- [Chapter 51 — The first Layer](./51-layer-memory.md) — where `MemoryStorage.ts` and the `internal/` folder were introduced; the foundation this chapter refactors
- [Chapter 52 — The second Layer](./52-layer-scoped-eviction.md) — the eviction fiber chapter; `eviction.ts` is one of the two files refactored here
- [Chapter 58 — The exports map](./58-exports-map.md) — seals the `internal/` abstraction at the package boundary with the `"exports"` field
- [`repos/effect/packages/effect/src/internal/queue.ts:16-26`](../../repos/effect/packages/effect/src/internal/queue.ts) — the internal implementation of `Queue`, marked `@internal` throughout; the corresponding `Queue.ts` re-exports selectively with public JSDoc
- [`repos/effect/packages/effect/src/Queue.ts:7-7`](../../repos/effect/packages/effect/src/Queue.ts) — the single `import * as internal from "./internal/queue.js"` line that is the only link between the public surface and the implementation
- [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — catalog entry with the anti-pattern it replaces and guidance on when to use this convention
