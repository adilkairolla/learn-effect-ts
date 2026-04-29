# Chapter 55 — Streams of cache events — eviction and hit/miss telemetry

> **Worked-example commit:** `worked-example/` chapter 55 — `feat: PubSub-backed events stream with Data.TaggedEnum`
> **Patterns demonstrated:** [`Data.TaggedEnum` — discriminated union constructors](../../research/02-patterns-catalog.md#datataggedenum--discriminated-union-constructors), [`PubSub` — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast), [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](../../research/02-patterns-catalog.md#streamfrompubsub--fromqueue--fromschedule--groupby)
> **Reads from:** [Chapter 16 — Stream](../part-1-foundations/16-stream.md), [Chapter 18 — Data — structural equality and discriminated unions](../part-1-foundations/18-data.md), [Chapter 36 — Concurrency primitives — Queue and PubSub](../part-2-tour/36-queue-pubsub.md)
> **Reads into:** Chapter 56 (tests subscribe to events stream), Chapter 60 (retrospective)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Chapters 51–54 built a working in-memory cache with an eviction fiber and a clean internal/external module boundary. What the cache still lacks is observability: callers cannot tell whether a `get` hit an entry, missed one, or whether the eviction fiber silently removed a key they were about to read. Production caches need that telemetry. It enables hit-rate dashboards, debugging sessions where you want to watch the eviction sweep in real time, and integration tests that assert specific lifecycle events without poking at internal state.

The right mechanism for this in Effect is `PubSub`. A `PubSub<A>` is an asynchronous broadcast hub — multiple independent subscribers each receive every message. Using a `Queue` would share messages across subscribers (each message is consumed by exactly one reader), which is wrong for telemetry: two subscribers watching `cache.events` should both see every event. A `SubscriptionRef` tracks only the current value, not the history of transitions. `PubSub` is the right tool.

This chapter wires a `PubSub<CacheEvent>` into both `MemoryStorage.makeService` (for Hit, Miss, and Set events) and `Eviction.runEviction` (for Evict events). Subscribers receive a `Stream<CacheEvent>` via `cache.events`, which calls `Stream.fromPubSub` under the hood. Each subscriber gets its own independent subscription: messages are not consumed by one and lost to the others.

The design goal is surgical: the `Storage` interface does not change, the public `CacheService` interface does not change, and no part of the public API is disturbed. The PubSub is an internal concern of the façade.

---

## What we already have

After Chapter 54, `worked-example/src/` contains:

- **`Cache.ts`** — `Cache` tag, `CacheService` interface (with a forward-declared placeholder `CacheEvent` type), `layerMemory`, `layerMemoryWithEviction`, and the four dual combinators.
- **`internal/storage.ts`** — abstract `Storage` interface and `Entry` type.
- **`internal/MemoryStorage.ts`** — `makeStorage` (creates the `Ref<HashMap>` backend), `makeService(storage)` (builds `CacheService`; events was `Stream.empty`), `make` (combines both for `layerMemory`).
- **`internal/eviction.ts`** — `sweep(storage)` and `runEviction(storage)` — the eviction fiber knows nothing about events.
- **`CacheConfig.ts`**, **`CacheError.ts`**, **`CacheKey.ts`**, **`index.ts`**

The placeholder `CacheEvent` type in `Cache.ts` (a plain structural type with `_tag` and `key`) was a carry-forward note from Chapter 47. The `events` field on `CacheService` returned `Stream.empty` — it compiled but never emitted anything.

---

## What we're adding

Two new concerns are introduced and one placeholder is replaced:

1. **`src/CacheEvent.ts`** (new) — a `Data.TaggedEnum` discriminated union with four variants: `Hit`, `Miss`, `Set`, `Evict`. The runtime value `CacheEvent` produced by `Data.taggedEnum<CacheEvent>()` provides constructors and matchers.
2. **`src/internal/MemoryStorage.ts`** (modified) — `makeService` now takes a `PubSub<CacheEvent>` as a second argument and publishes Hit/Miss on `get`, Set on `set`. `make` creates both a `Storage` and a `PubSub` internally. `events` returns `Stream.fromPubSub(pubsub)`.
3. **`src/internal/eviction.ts`** (modified) — `sweep` and `runEviction` each take a `PubSub<CacheEvent>` and publish `CacheEvent.Evict` for every key removed.
4. **`src/Cache.ts`** (modified) — replaces the placeholder type with `import type { CacheEvent } from "./CacheEvent.js"`. The `layerMemoryWithEviction` body now creates a shared PubSub and threads it into both `makeService` and `runEviction`.
5. **`src/index.ts`** (modified) — adds `export * from "./CacheEvent.js"`.

---

## The code

### `src/CacheEvent.ts` (new)

```ts
import * as Data from "effect/Data"
import type { CacheKey } from "./CacheKey.js"

/**
 * Discriminated union of cache lifecycle events. Subscribers receive these via
 * `Cache.events` — a `Stream<CacheEvent>` backed by a `PubSub` shared by the
 * memory storage and the eviction fiber.
 *
 * @since 0.1.0
 * @category models
 */
export type CacheEvent = Data.TaggedEnum<{
  readonly Hit: { readonly key: CacheKey }
  readonly Miss: { readonly key: CacheKey }
  readonly Set: { readonly key: CacheKey }
  readonly Evict: { readonly key: CacheKey }
}>

/**
 * Constructors and matchers for `CacheEvent`. Use:
 *   - `CacheEvent.Hit({ key })` to build a Hit value
 *   - `CacheEvent.$match({ Hit: ..., Miss: ..., Set: ..., Evict: ... })(event)` to pattern-match
 *
 * @since 0.1.0
 * @category constructors
 */
export const CacheEvent = Data.taggedEnum<CacheEvent>()
```

The type-level `Data.TaggedEnum<{ Hit: { key: CacheKey }; ... }>` auto-inserts `_tag` into each variant — the object you pass into the type parameter's values does NOT include `_tag` yourself. The runtime `Data.taggedEnum<CacheEvent>()` call returns an object whose properties are constructor functions (`Hit`, `Miss`, `Set`, `Evict`) plus two built-in utilities: `$is("Hit")` returns a type predicate, and `$match({ Hit: ..., Miss: ..., Set: ..., Evict: ... })` returns a pattern-match function. This is verified in `repos/effect/packages/effect/test/Data.test.ts:192-225`.

Citations:
- `repos/effect/packages/effect/src/Data.ts:251-285` — `TaggedEnum` type: maps `{ Tag: Fields }` to a union of `{ _tag: Tag } & Fields`
- `repos/effect/packages/effect/src/Data.ts:422-517` — `taggedEnum` runtime constructor: returns per-tag constructors plus `$is` / `$match`

Note the critical casing rule: `Data.TaggedEnum` (PascalCase) is a TypeScript type alias; `Data.taggedEnum` (camelCase) is a runtime function. Both exist and are distinct.

### `src/internal/MemoryStorage.ts` (modified)

The key changes to `makeService`:

```ts
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import { CacheEvent } from "../CacheEvent.js"

export const makeService = (
  storage: Storage,
  pubsub: PubSub.PubSub<CacheEvent>
): Effect.Effect<CacheService, never, CacheConfig> =>
  Effect.gen(function* () {
    const config = yield* CacheConfig.Tag

    const service: CacheService = {
      get: (key: CacheKey) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const entry = yield* storage.get(key)
          const result = Option.flatMap(entry, (e) =>
            e.expiresAt > now ? Option.some(e.value) : Option.none()
          )
          yield* PubSub.publish(pubsub, Option.isSome(result) ? CacheEvent.Hit({ key }) : CacheEvent.Miss({ key }))
          return result
        }),

      set: (key, value, ttlMillis) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          yield* storage.set(key, { value, expiresAt: now + (ttlMillis ?? config.defaultTtlMillis) })
          yield* PubSub.publish(pubsub, CacheEvent.Set({ key }))
        }),

      // ...
      events: Stream.fromPubSub(pubsub)
    }

    return service
  })

export const make: Effect.Effect<CacheService, never, CacheConfig> = Effect.gen(function* () {
  const storage = yield* makeStorage
  const pubsub = yield* PubSub.unbounded<CacheEvent>()
  return yield* makeService(storage, pubsub)
})
```

Citations:
- `repos/effect/packages/effect/src/PubSub.ts:79-86` — `PubSub.unbounded` creates a hub with no capacity limit; publishers never block
- `repos/effect/packages/effect/src/PubSub.ts:150-160` — `PubSub.publish(pubsub, value)` dual: data-first or data-last; returns `Effect<boolean>` (always `true` for unbounded)
- `repos/effect/packages/effect/src/Stream.ts:2031-2058` — `Stream.fromPubSub(pubsub)` returns a `Stream<A>` that opens a new independent subscription per consumer

`Stream.fromPubSub` creates a new subscription each time it is called, which means each consumer of `cache.events` gets an independent stream — messages published before a subscription is opened are not replayed (unless the PubSub was created with `replay` option). This is the correct behaviour for live telemetry.

### `src/internal/eviction.ts` (modified)

```ts
import * as PubSub from "effect/PubSub"
import { CacheEvent } from "../CacheEvent.js"

const sweep = (storage: Storage, pubsub: PubSub.PubSub<CacheEvent>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const all = yield* storage.entries
    yield* Effect.forEach(
      all.filter(([, entry]) => entry.expiresAt <= now),
      ([key]) =>
        Effect.gen(function* () {
          yield* storage.delete(key)
          yield* PubSub.publish(pubsub, CacheEvent.Evict({ key }))
        }),
      { concurrency: "unbounded", discard: true }
    )
  })

export const runEviction = (
  storage: Storage,
  pubsub: PubSub.PubSub<CacheEvent>
): Effect.Effect<void, never, Scope.Scope | CacheConfig> =>
  Effect.gen(function* () {
    const config = yield* CacheConfig.Tag
    yield* Effect.forkScoped(
      Effect.repeat(sweep(storage, pubsub), Schedule.spaced(`${config.evictionIntervalMillis} millis`))
    )
  })
```

The PubSub is passed in by the caller (either `Cache.ts`'s `layerMemoryWithEviction` or `MemoryStorage.make` for the no-eviction path). The eviction fiber does not own the PubSub — it just publishes into it. This keeps `runEviction` testable without a real PubSub: in Chapter 56, a test double can be wired in.

### `src/Cache.ts` (modified)

```ts
import type { CacheEvent } from "./CacheEvent.js"
import * as PubSub from "effect/PubSub"

// layerMemoryWithEviction now creates the shared PubSub:
export const layerMemoryWithEviction: Layer.Layer<Cache, never, CacheConfig> = Layer.scoped(
  Cache,
  Effect.gen(function* () {
    const storage = yield* MemoryStorage.makeStorage
    const pubsub = yield* PubSub.unbounded<CacheEvent>()
    yield* Eviction.runEviction(storage, pubsub)
    return yield* MemoryStorage.makeService(storage, pubsub)
  })
)
```

The PubSub is created once in the layer body and handed to both `runEviction` and `makeService`. Both publish to the same hub, so a subscriber to `cache.events` receives all four event types from a single stream.

---

## Why this design choice

### PubSub over Queue

`Queue` in Effect is a single-consumer structure: each message is dequeued by exactly one fiber. If two test fibers both subscribe to `cache.events` via a Queue, they compete for messages rather than each receiving a complete copy. `PubSub` creates per-subscriber buffers internally — every active subscription receives every message independently. For telemetry and test assertions, multi-subscriber fan-out is the correct semantic.

`PubSub.unbounded` is the right variant here. A bounded PubSub would block publishers when any subscriber's buffer is full; the cache's `get` and `set` operations must not stall because a slow telemetry consumer is not keeping up. Sliding and dropping variants discard messages — losing a Hit or Evict event silently would undermine the correctness of test assertions in Chapter 56. Unbounded allows each subscriber's buffer to grow without limit, which is acceptable when subscribers promptly drain their streams (as a test fiber does).

See: `repos/effect/packages/effect/src/PubSub.ts:79-86` (`unbounded`), `repos/effect/packages/effect/src/PubSub.ts:49-73` (bounded/sliding/dropping for comparison).

### Data.taggedEnum over a plain union

We could have defined `CacheEvent` as a plain TypeScript discriminated union:

```ts
type CacheEvent =
  | { readonly _tag: "Hit"; readonly key: CacheKey }
  | { readonly _tag: "Miss"; readonly key: CacheKey }
  | { readonly _tag: "Set"; readonly key: CacheKey }
  | { readonly _tag: "Evict"; readonly key: CacheKey }
```

That works, but forces call sites to write object literals: `{ _tag: "Hit", key }`. A typo in `_tag` would be caught by TypeScript only at the assignment site, not at construction. `Data.taggedEnum` generates typed constructor functions — `CacheEvent.Hit({ key })` — so a typo in a tag name is a compile error on the constructor access. It also provides structural equality for free (Effect's `Equal` protocol), which is essential for the test assertions in Chapter 56.

The comparable example in the Effect test suite uses the same pattern for `HttpError`: see `repos/effect/packages/effect/test/Data.test.ts:192-225`.

### Keeping PubSub at the façade level, not inside Storage

An alternative design would be to extend the `Storage` interface to include an `events` field or a `publish` method. That would make `Storage` responsible for broadcasting, and each future backend (Redis, SQLite) would need to implement event publishing. This is wrong: the storage layer's job is raw key/value/expiry operations. Telemetry is a façade concern. Placing the PubSub at the façade level (`makeService` and `runEviction`) means any storage backend automatically gets telemetry without any changes to the backend implementation.

---

## What's still missing

- **Tests** (Chapter 56) — `cache.events` is live, but nothing in the test suite yet subscribes to it. Chapter 56 will add tests that fork a fiber to collect events from the stream, advance `TestClock`, and assert the exact sequence of `Hit`, `Miss`, `Set`, `Evict` events.
- **JSDoc** (Chapter 57) — `CacheEvent.ts`, the updated `MemoryStorage.makeService`, and `Eviction.runEviction` all have internal `@see` refs but no published-API-level JSDoc that a package consumer would see. Chapter 57 adds `@example` blocks and `@since` / `@category` tags throughout.
- **Package exports map** (Chapter 58) — `CacheEvent` is now exported from `index.ts`, but the package's `exports` field in `package.json` does not yet expose a deep-import path for it. Chapter 58 aligns the exports map with the public API surface.
- **Replay for late subscribers** — subscribers who connect after a burst of events miss everything. If replay semantics are needed, `PubSub.unbounded({ replay: N })` retains the last N messages for new subscribers. The current chapter leaves `replay` at its default (`0`).

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add src/CacheEvent.ts src/Cache.ts src/index.ts src/internal/MemoryStorage.ts src/internal/eviction.ts
git commit -m "feat: PubSub-backed events stream with Data.TaggedEnum"
```

---

## See also

- [Chapter 16 — Stream](../part-1-foundations/16-stream.md) — `Stream.fromPubSub` is one of the core stream constructors covered there; subscribers get independent cursors into the hub
- [Chapter 18 — Data — structural equality and discriminated unions](../part-1-foundations/18-data.md) — `Data.TaggedEnum` / `Data.taggedEnum` are introduced there; `Equal` protocol on tagged data values
- [Chapter 36 — Concurrency primitives — Queue and PubSub](../part-2-tour/36-queue-pubsub.md) — PubSub variants (unbounded, bounded, sliding, dropping) and the fan-out semantics used here
- [Chapter 56 — Testing with TestClock and event streams](./56-testing-events.md) — tests that subscribe to `cache.events`, advance `TestClock`, and assert Hit/Miss/Evict sequences
- [Chapter 57 — JSDoc and API documentation](./57-jsdoc.md) — `@example`, `@since`, `@category` tags on `CacheEvent.ts` and the updated `makeService`
- [Chapter 58 — Package exports map](./58-exports-map.md) — exposing `CacheEvent` via the `exports` field so deep imports work without `moduleResolution: bundler` workarounds
- [`Data.TaggedEnum` — discriminated union constructors](../../research/02-patterns-catalog.md#datataggedenum--discriminated-union-constructors) — pattern catalog entry with `$is`, `$match`, and generic variant patterns
- [`PubSub` — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast) — catalog entry comparing unbounded / bounded / sliding / dropping
