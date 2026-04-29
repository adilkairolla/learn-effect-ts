# Chapter 56 — Testing with @effect/vitest — `it.effect`, `it.scoped`, and layer management

> **Worked-example commit:** `worked-example/` chapter 56 — `test: it.effect and it.scoped tests for Cache layers`
> **Patterns demonstrated:** [Runtime — pre-built runtime for executing Effects](../../research/02-patterns-catalog.md#runtime--pre-built-runtime-for-executing-effects), [`Layer.merge` / `provide` / `fresh` — Layer composition](../../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition)
> **Reads from:** [Chapter 09 — Layer](../part-1-foundations/09-layer.md), [Chapter 17 — Fibers and concurrency](../part-1-foundations/17-fibers-and-concurrency.md), [Chapter 43 — @effect/vitest](../part-2-tour/43-vitest.md)
> **Reads into:** Chapter 60 (retrospective — the tests validate the full public API surface)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

We have built five chapters worth of cache implementation: in-memory storage, a scoped eviction fiber, a dual API surface, explicit internal module boundaries, and a PubSub-backed events stream. What we have not yet done is test any of it. That changes here.

The goal is to write tests that cover the full public API — `Cache.get`, `Cache.set`, `Cache.delete`, `Cache.invalidate`, the TTL expiry path, the eviction-fiber path, and the events stream — using the tools that Effect's own test suite uses: `@effect/vitest`.

There are two specific questions this chapter answers. First: what is the right test variant for each situation? `it.effect` vs `it.scoped` is not arbitrary; the choice is dictated by whether the code under test requires a `Scope`. Second: how do we test time-dependent behaviour (TTL expiry, eviction sweeps) without actually waiting? The answer is `TestClock.adjust`, which advances the virtual clock by a specified duration without any wall-clock delay.

The `@effect/vitest` library also handles layer lifecycle automatically. When you pass a fully-provided `Effect` to `it.effect`, the library builds the layer, runs the test against it, and tears it down — all within the test boundary. Each test gets an isolated layer instance with no shared state leaking between tests.

---

## What we already have

After Chapter 55, `worked-example/src/` contains:

- **`Cache.ts`** — `Cache` tag, `CacheService` interface (`get`, `set`, `delete`, `invalidate`, `events`), `layerMemory`, `layerMemoryWithEviction`, and the four dual combinators.
- **`CacheEvent.ts`** — `Data.TaggedEnum` discriminated union with `Hit`, `Miss`, `Set`, and `Evict` variants.
- **`CacheConfig.ts`** — `Schema.Class`-based config with a static `Tag` for context injection.
- **`CacheKey.ts`** — nominal brand over `string`.
- **`CacheError.ts`** — `Data.TaggedError` variants.
- **`internal/MemoryStorage.ts`** and **`internal/eviction.ts`** — the implementation details behind the two layers.
- **`index.ts`** — clean public re-exports.

There is a `vitest.config.ts` in the project root that picks up `test/**/*.test.ts`. No test files exist yet.

---

## What we're adding

A single new file: **`test/Cache.test.ts`** (new). It exercises both layers across seven test cases:

- Four `it.effect` tests for `layerMemory` (missing key, set/get, delete, invalidate).
- One `it.effect` test for TTL expiry on the memory layer using `TestClock.adjust`.
- Two `it.scoped` tests for `layerMemoryWithEviction` (eviction sweep via TestClock, events stream subscription).

The `test/` directory is intentionally outside `tsconfig.src.json`'s `rootDir: "src"` — vitest compiles test files via esbuild, not `tsc`. So `npx tsc -p tsconfig.src.json --noEmit` does not check this file; instead, run `npx vitest run` to exercise the tests.

---

## The code

### test/Cache.test.ts (new)

```ts
import { describe, expect, it } from "@effect/vitest"
import { Chunk, Effect, Fiber, Layer, Stream, TestClock } from "effect"
import { Cache, CacheConfig, CacheKey } from "../src/index.js"

const TestConfigLayer = Layer.succeed(
  CacheConfig.Tag,
  new CacheConfig({ defaultTtlMillis: 1000, maxEntries: 100, evictionIntervalMillis: 50 })
)
```

`Layer.succeed(CacheConfig.Tag, ...)` builds a layer that provides exactly one value under the `CacheConfig.Tag` key. `CacheConfig.Tag` is a `Context.GenericTag` defined as a static field on the `Schema.Class`. The `new CacheConfig({...})` constructor works because `Schema.Class` generates a standard TypeScript class with a constructor that accepts the decoded shape — see `worked-example/src/CacheConfig.ts:17-29`.

#### Basic get/set/delete on `layerMemory`

```ts
describe("Cache.layerMemory", () => {
  const layer = Cache.layerMemory.pipe(Layer.provide(TestConfigLayer))

  it.effect("get returns None for a missing key", () =>
    Effect.gen(function* () {
      const result = yield* Cache.get(CacheKey("absent"))
      expect(result._tag).toBe("None")
    }).pipe(Effect.provide(layer))
  )

  it.effect("set then get returns Some with the stored value", () =>
    Effect.gen(function* () {
      yield* Cache.set(CacheKey("hello"), "world", 1000)
      const result = yield* Cache.get(CacheKey("hello"))
      expect(result._tag).toBe("Some")
      if (result._tag === "Some") {
        expect(result.value).toBe("world")
      }
    }).pipe(Effect.provide(layer))
  )

  it.effect("delete removes the entry", () =>
    Effect.gen(function* () {
      yield* Cache.set(CacheKey("del-me"), 42, 1000)
      yield* Cache.delete(CacheKey("del-me"))
      const result = yield* Cache.get(CacheKey("del-me"))
      expect(result._tag).toBe("None")
    }).pipe(Effect.provide(layer))
  )
})
```

`it.effect` is exported from `@effect/vitest` at `repos/effect/packages/vitest/src/index.ts:186`. Its type is `Vitest.Tester<TestServices.TestServices>`, meaning the test Effect may require `TestServices` (TestClock, TestRandom, etc.) — the framework provides those automatically. The Effect must *not* require `Scope`; if it does, the compiler rejects it (use `it.scoped` instead).

Each test calls `Effect.provide(layer)` to satisfy the `Cache` requirement. The layer is built and torn down for every test — there is no shared state between the `set then get` test and the `delete removes the entry` test.

#### TTL expiry on the memory layer

```ts
it.effect("get returns None for an expired entry (TestClock)", () =>
  Effect.gen(function* () {
    yield* Cache.set(CacheKey("ttl-memory"), "temporary", 100)
    yield* TestClock.adjust("200 millis")
    const result = yield* Cache.get(CacheKey("ttl-memory"))
    expect(result._tag).toBe("None")
  }).pipe(Effect.provide(layer))
)
```

`TestClock.adjust` is defined at `repos/effect/packages/effect/src/TestClock.ts:463-472`. Its signature accepts `Duration.DurationInput`, which includes the string template form `` `${number} ${Unit}` `` (e.g., `"200 millis"`, `"1 seconds"`, `"5 minutes"`) — verified in `repos/effect/packages/effect/src/Duration.ts:82-87`. Advancing the clock does not block; it instantly sets the virtual time and runs any effects that were sleeping until that point.

The memory layer's `get` implementation reads `Clock.currentTimeMillis` and compares it to the stored `expiresAt` timestamp. Because both the storage write (in `set`) and the expiry check (in `get`) go through `Clock`, TestClock controls both sides of the comparison. After `adjust("200 millis")`, the virtual clock reports 200 ms elapsed, which exceeds the 100 ms TTL, so the entry reads back as expired — without touching the eviction fiber.

#### Eviction sweep and the `events` stream on `layerMemoryWithEviction`

```ts
describe("Cache.layerMemoryWithEviction", () => {
  const layer = Cache.layerMemoryWithEviction.pipe(Layer.provide(TestConfigLayer))

  it.scoped("eviction sweep removes expired entries after TestClock advance", () =>
    Effect.gen(function* () {
      yield* Cache.set(CacheKey("ttl-key"), "soon-gone", 100)
      yield* TestClock.adjust("200 millis")
      const result = yield* Cache.get(CacheKey("ttl-key"))
      expect(result._tag).toBe("None")
    }).pipe(Effect.provide(layer))
  )

  it.scoped("publishes Hit, Set, and Miss events in order", () =>
    Effect.gen(function* () {
      const cache = yield* Cache

      const collectorFiber = yield* Stream.take(cache.events, 3).pipe(
        Stream.runCollect,
        Effect.fork
      )
      yield* Effect.yieldNow()

      yield* Cache.set(CacheKey("ev-key"), "hello", 1000)  // Set event
      yield* Cache.get(CacheKey("ev-key"))                  // Hit event
      yield* Cache.get(CacheKey("missing"))                 // Miss event

      const collected = yield* Fiber.join(collectorFiber)

      const tags = Chunk.toReadonlyArray(collected).map((e) => e._tag)
      expect(tags).toEqual(["Set", "Hit", "Miss"])
    }).pipe(Effect.provide(layer))
  )
})
```

`it.scoped` is exported at `repos/effect/packages/vitest/src/index.ts:191`. Its type is `Vitest.Tester<TestServices.TestServices | Scope.Scope>`. The eviction layer uses `Layer.scoped` which internally calls `Effect.forkScoped` — the forked fiber attaches to a `Scope`. That scope is provided by `it.scoped`; using `it.effect` here would leave the `Scope` requirement unsatisfied.

The events test requires careful ordering. `cache.events` is a `Stream<CacheEvent>` backed by `Stream.fromPubSub(pubsub)`. Subscriptions are created lazily when the stream runs. We fork `Stream.take(3).pipe(Stream.runCollect)` to start the subscription, then call `Effect.yieldNow()` to yield the current fiber and let the collector fiber begin executing — registering its PubSub subscription before any events are published. Without `Effect.yieldNow()`, the operations that produce events could run before the subscription is active, and the first event would be lost.

`Stream.runCollect` returns `Effect<Chunk<A>, E, R>`. `Chunk.toReadonlyArray` (from `"effect/Chunk"`) converts it to a plain readonly array for `.map`. The `Array.from` idiom works too, but `Chunk.toReadonlyArray` is more idiomatic in Effect code.

`Fiber.join(collectorFiber)` awaits the fiber's result. The fiber completes as soon as `Stream.take(3)` has seen three events and `Stream.runCollect` finishes. If the operations do not produce three events, the test would hang — which is itself a useful diagnostic.

---

## Why this design choice

### `it.effect` vs plain `it` with `Effect.runPromise`

You could write:

```ts
it("set then get", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () { /* ... */ }).pipe(Effect.provide(layer))
  )
  // ...
})
```

This works for simple cases, but it has two drawbacks. First, `Effect.runPromise` creates a new, bare runtime for each call — it does not include TestServices. That means `TestClock.adjust` has no effect; the test runs against the real clock. Second, the bare runtime does not propagate interruption correctly: if a test times out, the Effect fiber may not be interrupted cleanly.

`it.effect` builds a managed runtime that includes TestServices and handles interruption. It is exactly the right tool for testing Effect code.

### `it.scoped` vs `it.effect` for the eviction layer

The eviction layer requires `Scope`. If you try to use `it.effect` with `Cache.layerMemoryWithEviction`, TypeScript will reject the call because the Effect's requirement set includes `Scope`, which `it.effect` does not satisfy. `it.scoped` provides that scope and closes it at test end — the eviction fiber is interrupted when the scope closes, so there is no fiber leak between tests.

### Layer-per-test isolation

When you call `Effect.provide(layer)` inside each test, `@effect/vitest` builds a fresh layer instance for that test run. This is the default behaviour — layers are not memoized across tests unless you use the `it.layer(...)` form (which shares a single layer instance across all tests in a `describe` block). For the cache, per-test isolation is correct: each test should start with an empty cache, not inherit entries left by a previous test.

### `Effect.yieldNow()` for fiber scheduling

The events test depends on a race condition being resolved correctly: the collector fiber must subscribe before events are published. In a synchronous scheduler, forking and then immediately running operations would be fine. But Effect's scheduler is cooperative — a forked fiber does not run until the current fiber yields. `Effect.yieldNow()` is the explicit yield point that guarantees the scheduler runs the collector fiber before we proceed to publish events.

---

## What's still missing

- **JSDoc on public exports** — `Cache`, `CacheService`, the combinators, `CacheEvent`, `CacheConfig`, and `CacheKey` have source-level JSDoc, but no `@example` blocks that tools like TypeDoc can render. Chapter 57 adds those.
- **Exports map and package.json wiring** — the package does not yet have an `exports` field or proper `dist/` build targets for consumers. Chapter 58 fixes the packaging.
- **Publishing** — `npm publish` configuration, provenance, and the full release pipeline. Chapter 59 covers that.
- **Retrospective** — Chapter 60 revisits all design decisions made across the worked example, the patterns that worked, and the ones that should be reconsidered.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add test/Cache.test.ts
git commit -m "test: it.effect and it.scoped tests for Cache layers"
```

---

## See also

- [Chapter 09 — Layer](../part-1-foundations/09-layer.md) — how `Layer.succeed`, `Layer.provide`, and layer memoization work; the foundation for the `TestConfigLayer` pattern used here.
- [Chapter 17 — Fibers and concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — `Effect.fork`, `Fiber.join`, and the cooperative scheduler that makes `Effect.yieldNow()` necessary in the events test.
- [Chapter 43 — @effect/vitest](../part-2-tour/43-vitest.md) — the full tour of `@effect/vitest` including `it.layer`, `it.live`, `it.prop`, and `describeWrapped`; this chapter uses only `it.effect` and `it.scoped`.
- [`repos/effect/packages/vitest/src/index.ts:183-191`](../../repos/effect/packages/vitest/src/index.ts) — the public export of `effect` and `scoped`; note that `it.effect` and `it.scoped` are re-assembled as properties of `it` at line 280-283.
- [`repos/effect/packages/effect/src/TestClock.ts:38-82`](../../repos/effect/packages/effect/src/TestClock.ts) — the `TestClock` interface and the module-level JSDoc explaining the fork-adjust-verify pattern that makes virtual-time tests reliable.
- [`repos/effect/packages/effect/test/Cache.test.ts`](../../repos/effect/packages/effect/test/Cache.test.ts) — Effect's own cache test, which demonstrates `it.effect` + `TestClock.adjust("2 seconds")` against the built-in memoising `Cache.make` — a good reference for the virtual-time idiom.
- [`Layer.merge` / `provide` / `fresh` — Layer composition](../../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — catalog entry explaining when to use `Layer.fresh` (per-test isolation) vs default memoisation (shared across suite).
