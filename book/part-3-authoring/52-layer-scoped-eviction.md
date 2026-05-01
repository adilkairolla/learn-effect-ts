# Chapter 52 — The second Layer — `Layer.scoped` for the eviction fiber

> **Worked-example commit:** `worked-example/` chapter 52 — `feat: eviction fiber layer with Layer.scoped and Schedule`
> **Patterns demonstrated:** [`Layer.scoped` (resource layers)](../../research/02-patterns-catalog.md#layerscoped-resource-layers), [`Effect.acquireRelease` / `acquireUseRelease`](../../research/02-patterns-catalog.md#effectacquirerelease--acquireuserelease), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](../../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin), [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](../../research/02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs)
> **Reads from:** [Chapter 10 — Layer.scoped and Scope](../part-1-foundations/10-layer-scoped-and-scope.md), [Chapter 17 — Fibers and concurrency](../part-1-foundations/17-fibers-and-concurrency.md), [Chapter 34 — Schedule](../part-2-tour/34-schedule.md)
> **Reads into:** Chapter 53 (dual module-level API), Chapter 55 (eviction publishes events to PubSub), Chapter 56 (tests use `it.scoped` to exercise this layer)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Chapter 51 gave us a working in-memory cache: a `Ref<HashMap>` behind a `CacheService`, wired into the `Cache` tag via `Layer.effect`. Entries are written with a TTL — an `expiresAt` timestamp computed at write time — and filtered on read. The implementation is honest about what it doesn't do: "Eviction of expired entries is NOT performed here." That comment ends the chapter.

This chapter adds eviction. But the interesting question is not "how do we delete stale entries?" It is: **why should eviction be a layer at all?**

The answer is that eviction is a background resource — it runs independently of any request, and it must be shut down cleanly when the application stops. In Node.js tradition you might write `setInterval(() => sweep(), 30_000)` and later `clearInterval(id)` somewhere in a SIGTERM handler. That pattern leaks: it misses `SIGINT`, unhandled exceptions, test teardown, and any case where the scope owning the cache ends before the process does. It is also untestable — `setInterval` talks directly to wall-clock time.

Effect gives us two composable primitives that solve both problems. `Effect.forkScoped` forks a fiber into an explicitly tracked `Scope` so the fiber's lifetime is bound to the scope's lifetime — no matter how the scope closes (success, failure, or interruption), the fiber is interrupted. `Layer.scoped` wraps a scoped acquisition into a Layer, so the scope is managed by the layer's own lifetime: it opens when the layer is built and closes when the layer is released. The two together mean: "this background fiber lives exactly as long as the layer that started it." No teardown code to write, no SIGTERM handler to maintain, no leak.

A third primitive, `Schedule.spaced`, replaces the `setInterval` call. It drives the sweep on a configurable delay between sweeps (not a fixed period from epoch), is fully interruption-aware, and — crucially — runs through Effect's Clock service rather than the system clock. That last point means `TestClock` can advance time in tests without touching real wall-clock time.

---

## What we already have

After Chapter 51, `worked-example/` has these source files:

- `src/Cache.ts` — `Cache` tag, `CacheService` interface, `Cache.layerMemory` (`Layer.effect`)
- `src/internal/MemoryStorage.ts` — `MemoryStorage.make`: an `Effect<CacheService, never, CacheConfig>` that creates a `Ref<HashMap>` internally and builds the service around it
- `src/CacheConfig.ts` — `CacheConfig` schema class with `defaultTtlMillis`, `maxEntries`, `evictionIntervalMillis`; a `CacheConfig.Tag`; and `CacheConfig.layer`
- `src/CacheError.ts`, `src/CacheKey.ts`, `src/index.ts`

The critical constraint is that `MemoryStorage.make` encapsulates the `Ref` entirely — it creates the ref and returns a service, but the ref is not observable from outside. That works for `layerMemory`. It does not work for `layerMemoryWithEviction`, which needs to hand the same ref to both the service and the eviction fiber. The eviction fiber sweeps the ref; the service reads and writes it. They must share a single `Ref`.

---

## What we're adding

Three changes in this chapter:

1. **`src/internal/MemoryStorage.ts` (modified)** — Refactored to expose two separate constructors: `makeStorage` (creates the `Ref`) and `makeService` (takes a `Ref` and returns the `CacheService`). The original `make` convenience combinator is kept intact so `Cache.layerMemory` needs no changes.

2. **`src/internal/eviction.ts` (new)** — An internal module with two functions: `sweep` (reads the Ref, filters expired entries, writes back) and `runEviction` (forks `sweep` on a `Schedule.spaced` loop into the enclosing `Scope`).

3. **`src/Cache.ts` (modified)** — Adds `Cache.layerMemoryWithEviction`, a `Layer.scoped` that creates the ref, forks the eviction loop, and returns the service. `Cache.layerMemory` is unchanged.

---

## The code

### `src/internal/MemoryStorage.ts` (modified)

The refactor separates what was one opaque constructor into three composable pieces:

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

export type Entry = { readonly value: unknown; readonly expiresAt: number }

// Creates the Ref — the single shared source of truth.
export const makeStorage: Effect.Effect<Ref.Ref<HashMap.HashMap<CacheKey, Entry>>> =
  Ref.make<HashMap.HashMap<CacheKey, Entry>>(HashMap.empty())

// Builds a CacheService from an existing Ref.
export const makeService = (
  ref: Ref.Ref<HashMap.HashMap<CacheKey, Entry>>
): Effect.Effect<CacheService, never, CacheConfig> =>
  Effect.gen(function* () {
    const config = yield* CacheConfig.Tag
    const service: CacheService = {
      get: (key) =>
        Ref.get(ref).pipe(
          Effect.map((map) =>
            Option.flatMap(HashMap.get(map, key), (entry) =>
              entry.expiresAt > Date.now() ? Option.some(entry.value) : Option.none()
            )
          )
        ),
      set: (key, value, ttlMillis?) =>
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

// Convenience combinator for layerMemory — creates a fresh ref and delegates.
export const make: Effect.Effect<CacheService, never, CacheConfig> = Effect.gen(function* () {
  const ref = yield* makeStorage
  return yield* makeService(ref)
})
```

The type `Entry` is now `export`ed (previously it was module-local) so that `eviction.ts` can import it without duplicating the definition. This is the minimal change — everything else in the service body is identical to Chapter 51.

See `worked-example/src/internal/MemoryStorage.ts`.

### `src/internal/eviction.ts` (new)

```ts
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import { CacheConfig } from "../CacheConfig.js"
import type { CacheKey } from "../CacheKey.js"
import type { Entry } from "./MemoryStorage.js"

const sweep = (ref: Ref.Ref<HashMap.HashMap<CacheKey, Entry>>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    yield* Ref.update(ref, (map) =>
      HashMap.filter(map, (entry) => entry.expiresAt > now)
    )
  })

export const runEviction = (
  ref: Ref.Ref<HashMap.HashMap<CacheKey, Entry>>
): Effect.Effect<void, never, Scope.Scope | CacheConfig> =>
  Effect.gen(function* () {
    const config = yield* CacheConfig.Tag
    yield* Effect.forkScoped(
      Effect.repeat(sweep(ref), Schedule.spaced(`${config.evictionIntervalMillis} millis`))
    )
  })
```

**`Clock.currentTimeMillis`** — `repos/effect/packages/effect/src/Clock.ts:88-92`. Returns `Effect<number>` — the current wall-clock time in milliseconds. Unlike `Date.now()`, it routes through Effect's Clock service, which `TestClock` can replace with a simulated clock (see [Chapter 17 — Fibers and concurrency](../part-1-foundations/17-fibers-and-concurrency.md) for the Clock service pattern).

**`HashMap.filter`** — `repos/effect/packages/effect/src/HashMap.ts:449-460`. Data-first form: `HashMap.filter(map, predicate)`. Accepts a predicate `(value, key) => boolean` and returns a new `HashMap` with non-matching entries removed. The data-first form is used inside `Ref.update` so the result drops straight into the update callback with no extra pipe.

**`Ref.update`** — (covered in Chapter 51; see [Chapter 36 — Concurrency primitives](../part-2-tour/36-concurrency-primitives.md)). Atomically applies a pure function to the ref's current value. Using `Ref.update` rather than separate `Ref.get` + `Ref.set` ensures the sweep is an atomic compare-and-swap: no entries written by `set` between the read and write are lost.

**`Effect.forkScoped`** — `repos/effect/packages/effect/src/Effect.ts:6438-6507`. Signature: `<A, E, R>(self: Effect<A, E, R>) => Effect<Fiber.RuntimeFiber<A, E>, never, Scope.Scope | R>`. Forks the effect into the current `Scope`. The fiber runs independently but is interrupted when the scope closes. This is what adds `Scope.Scope` to the `R` channel of `runEviction`.

**`Schedule.spaced(duration)`** — `repos/effect/packages/effect/src/Schedule.ts:1742-1757`. Returns a schedule that recurs indefinitely, with a fixed delay _between_ the end of one execution and the start of the next. The `duration` parameter accepts a `DurationInput` — which includes the string form `"100 millis"` via `Duration.decode` (`repos/effect/packages/effect/src/Duration.ts:82-144`). So `Schedule.spaced(\`${config.evictionIntervalMillis} millis\`)` converts the plain integer from `CacheConfig` to a Duration string at runtime, avoiding an explicit `Duration.millis(...)` call.

**`Effect.repeat(effect, schedule)`** — `repos/effect/packages/effect/src/Effect.ts:10116-10192`. Data-first form: runs `effect` once, then repeats it according to `schedule`. The effect (`sweep`) is idempotent; the schedule (`spaced`) provides the delay. `repeat` propagates interruption — when the enclosing `Scope` closes, the forked fiber is interrupted and `repeat` stops cleanly.

### `src/Cache.ts` (modified)

```ts
import * as Eviction from "./internal/eviction.js"
import * as MemoryStorage from "./internal/MemoryStorage.js"

// Inside `class Cache extends Context.Tag(...)<Cache, CacheService>() { ... }`:

// layerMemory is unchanged — still Layer.effect, no Scope.
static readonly layerMemory: Layer.Layer<Cache, never, CacheConfig> =
  Layer.effect(Cache, MemoryStorage.make)

static readonly layerMemoryWithEviction: Layer.Layer<Cache, never, CacheConfig> =
  Layer.scoped(
    Cache,
    Effect.gen(function* () {
      const ref = yield* MemoryStorage.makeStorage
      yield* Eviction.runEviction(ref)          // forks fiber into Scope
      return yield* MemoryStorage.makeService(ref)
    })
  )
```

**`Layer.scoped`** — `repos/effect/packages/effect/src/Layer.ts:721-735`. Signature: `(tag, effect) => Layer<I, E, Exclude<R, Scope.Scope>>`. Constructs a layer from a scoped effect. The key difference from `Layer.effect` is that the layer opens a `Scope` during build and closes it on release. Any `acquireRelease` calls or `forkScoped` calls inside the effect register against that scope. When the layer is released — on application shutdown, test teardown, or interruption — the scope's finalizers run, which includes interrupting the eviction fiber.

Note the `Exclude<R, Scope.Scope>` in the return type: `Layer.scoped` consumes the `Scope` requirement and removes it from the layer's environment. The caller does not need to supply a `Scope` — the layer manages it internally. That is why `layerMemoryWithEviction` has type `Layer.Layer<Cache, never, CacheConfig>` even though `runEviction` returns `Effect<void, never, Scope.Scope | CacheConfig>`.

See `worked-example/src/Cache.ts`.

---

## Why this design choice

### `Effect.forkScoped` over `Effect.forkDaemon`

Plain `Effect.fork` attaches the child to the parent fiber's lifetime — when the parent returns, the child is interrupted — making it unsuitable for a background loop that must outlive its creator and end with the layer. `Effect.forkDaemon` attaches the fiber to the runtime's root scope. The fiber runs until the entire application terminates — it does not stop when the layer is released. For a cache eviction loop that lives alongside a single layer instance, that is wrong: if the layer is torn down (e.g., in a test that rebuilds the layer), the daemon fiber keeps running and sweeping a ref that may have been replaced. `Effect.forkScoped` puts the fiber in the _enclosing_ scope. The layer's scope is that enclosing scope, so the fiber's lifetime exactly matches the layer's lifetime.

A comparable pattern in the Effect source: `repos/effect/packages/effect/src/internal/rateLimiter.ts` shows both `tokenBucket` and `fixedWindow` using `Effect.forkScoped` to tie a token-refill fiber to the limiter's scope. The limiter is intended to be built via `Layer.scoped` (its factory returns `Effect<RateLimiter, never, Scope.Scope>`), and the fiber stops exactly when the limiter is released. Our eviction fiber follows the same idiom.

### `Schedule.spaced` over a manual `Effect.loop` or `setInterval`

`Schedule.spaced(duration)` measures the delay from the _end_ of the previous execution, not from a fixed epoch. For a sweep that might occasionally take tens of milliseconds, this avoids the overlap that a fixed-period timer would produce. The manual alternative — `Effect.loop(() => sweep(ref), ...)` or `Effect.forever(Effect.delay(sweep(ref), duration))` — works but produces more repetitive code and loses the declarative intent. `Schedule.spaced` is the library vocabulary for "run on a fixed spacing"; use it.

### `Clock.currentTimeMillis` over `Date.now()`

`MemoryStorage.makeService` still uses `Date.now()` in its `get` and `set` implementations — noted as a deliberate deferral for Chapter 53. The eviction sweep uses `Clock.currentTimeMillis` instead. The difference matters for tests: `TestClock.adjust("5 minutes")` advances Effect's Clock by five minutes, which changes what `Clock.currentTimeMillis` returns. A test can therefore write `yield* TestClock.adjust(...)` and assert that the sweep removes entries with `expiresAt` in the past — without waiting five real minutes. `Date.now()` is opaque to `TestClock` and would make that test impossible. (Chapter 56 uses this to test the eviction layer.)

### MemoryStorage refactor: three-function design over alternatives

The task description offered several options: (a) make `MemoryStorage.make` return `{ service, ref }`, (b) a separate factory for the ref plus a service factory that takes it, or (c) keep a convenience `make` that composes the two. We chose (c): `makeStorage` creates the ref, `makeService` consumes it, and `make` (the original API) combines them. This preserves `Cache.layerMemory`'s one-line implementation (`Layer.effect(Cache, MemoryStorage.make)`) without change — backward compatibility at zero cost.

---

## What's still missing

- **`Date.now()` in `get` / `set`** — The service still uses `Date.now()` for TTL calculation and read-time expiry checks. These should use `Clock.currentTimeMillis` too, for the same testability reasons. Chapter 53 (dual API) is the natural moment to address this alongside the module-level export refactor.

- **Dual module-level API** — Chapter 53 adds `get`, `set`, `delete`, and `invalidate` as top-level functions on the `Cache` module (not just members of `CacheService`), mirroring the `Effect.gen`-friendly dual API style used throughout the Effect ecosystem (see [Chapter 04 — pipe and the dual API](../part-1-foundations/04-pipe-and-dual-api.md)).

- **Storage interface** — `MemoryStorage` is still a single concrete module, not an interface. Chapter 54 extracts a `CacheStorage` interface so alternative backends (Redis, SQLite) can be plugged in as different layers.

- **Event publishing** — `events: Stream.empty` is a permanent stub. Chapter 55 replaces it with a `PubSub`-backed stream that emits `Hit`, `Miss`, `Set`, and `Evict` events. The eviction sweep will use that PubSub to publish `Evict` events for each removed entry.

- **Tests** — No tests exist yet. Chapter 56 adds `it.scoped` tests that exercise `layerMemoryWithEviction`, use `TestClock.adjust` to trigger eviction without wall-clock time, and assert that swept entries are gone.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add src/internal/eviction.ts src/internal/MemoryStorage.ts src/Cache.ts
git commit -m "feat: eviction fiber layer with Layer.scoped and Schedule"
```

---

## See also

- [Chapter 10 — `Layer.scoped` and Scope](../part-1-foundations/10-layer-scoped-and-scope.md) — the foundational chapter on `Layer.scoped`, scope lifecycle, and `acquireRelease`
- [Chapter 17 — Fibers and concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — `Effect.fork`, `forkDaemon`, `forkScoped`, and the Clock service including `TestClock`
- [Chapter 34 — Schedule](../part-2-tour/34-schedule.md) — `Schedule.spaced`, `Schedule.fixed`, `Schedule.exponential`, and composing schedules
- [Chapter 56 — Testing the eviction layer with `it.scoped` and `TestClock`](56-test-scoped.md) — tests that use `TestClock.adjust` to drive eviction without real time
- [Chapter 55 — Eviction events via PubSub](55-pubsub-events.md) — extends the sweep to publish `Evict` events for each removed entry
- [`Layer.scoped` (resource layers)](../../research/02-patterns-catalog.md#layerscoped-resource-layers) — pattern catalog entry with the `Layer.scoped` signature, when to use, and anti-patterns
- [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](../../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin) — pattern catalog entry comparing all four fork variants with lifecycle diagrams
- [`repos/effect/packages/effect/src/internal/rateLimiter.ts`](../../repos/effect/packages/effect/src/internal/rateLimiter.ts) — real-world `Effect.forkScoped` usage in the rate-limiter implementation
