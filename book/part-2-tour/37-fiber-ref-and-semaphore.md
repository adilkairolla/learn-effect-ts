# Chapter 37 — FiberRef, Semaphore, and advanced concurrency patterns

> **Package(s):** `effect`
> **Patterns introduced:** [FiberRef — fiber-local state](../../research/02-patterns-catalog.md#fiberref--fiber-local-state), [Semaphore — async resource limiting](../../research/02-patterns-catalog.md#semaphore--async-resource-limiting), [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../../research/02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking)
> **Reads from:** [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md), [Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends](36-concurrency-primitives.md)
> **Reads into:** Chapter 41 (Stream deep-dive — `Stream.mapEffect` uses Semaphore internally), Part III (worked example uses FiberSet to track eviction fibers)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 17 gave you the fiber model. Chapter 36 gave you `Ref`, `Queue`, `PubSub`, and `Deferred` — the communication tools fibers use to talk to each other. This chapter covers the three remaining pieces you need before writing production concurrent code: fiber-local state, async-aware resource limiting, and structured lifecycle tracking for groups of fibers.

**Request-scoped state in plain TypeScript** is painful. The idiomatic approach is `AsyncLocalStorage` from Node:

```ts
import { AsyncLocalStorage } from "async_hooks"

const correlationStorage = new AsyncLocalStorage<string>()

async function handleRequest(id: string) {
  // Thread the ID through every async function by wrapping in `run`.
  return correlationStorage.run(id, async () => {
    await doWorkA()
    await doWorkB()   // doWorkB can call getStore() to read the ID
  })
}

function doWorkB() {
  const id = correlationStorage.getStore()  // could be undefined
  console.log("correlationId:", id)
}
```

This only works on Node.js. It breaks in browsers, Bun in some configurations, and — critically — it is not fiber-aware. Effect's cooperative scheduler multiplexes many fibers over one thread. When fiber A yields inside `correlationStorage.run(...)`, fiber B may execute inside the same Node.js async context, reading fiber A's correlation ID by mistake. `AsyncLocalStorage` tracks *async contexts*, not *fibers*.

**Concurrency limiting with plain promises** is equally fragile. The usual pattern is a semaphore implemented with a `Ref<boolean>` and a polling loop:

```ts
let locked = false

async function withLock<T>(f: () => Promise<T>): Promise<T> {
  while (locked) {
    await new Promise((r) => setTimeout(r, 10))  // busy-poll
  }
  locked = true
  try {
    return await f()
  } finally {
    locked = false
  }
}
```

The polling burns CPU, the check-then-set has a real race window, there is no fairness guarantee (a low-priority task may never acquire the lock), and the timeout value is a magic constant that interacts badly with backpressure.

**Tracking background fibers** is hardest of all. A `Set<Promise<void>>` is the standard approach, but it gives you no way to interrupt a promise, no structured cancellation on shutdown, and no error propagation back to the parent. You end up with a `process.on("SIGTERM")` handler doing its best to cancel a collection of promises that may not support cancellation at all.

Effect ships three complementary tools that replace each of these patterns: `FiberRef` for fiber-local ambient state, `Semaphore` for async-aware resource limiting, and `FiberSet` / `FiberMap` / `FiberHandle` for structured fiber lifecycle tracking.

---

## The minimal example

A Semaphore capping concurrent outbound HTTP requests to three at a time, while still processing a large list of URLs in a single `Effect.forEach` call:

```ts
import { Effect } from "effect"

const fetchUrl = (url: string): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.text()),
    catch: (e) => new Error(String(e))
  })

const program = Effect.gen(function* () {
  // Create a semaphore with 3 permits.
  // repos/effect/packages/effect/src/Effect.ts:11831-11852
  const sem = yield* Effect.makeSemaphore(3)

  const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/page/${i}`)

  // withPermits(1) wraps each individual task. The semaphore ensures at most
  // 3 tasks hold permits simultaneously; the rest wait in a fair queue.
  const pages = yield* Effect.forEach(
    urls,
    (url) => sem.withPermits(1)(fetchUrl(url)),
    { concurrency: "unbounded" }  // fibers are unbounded; semaphore does the capping
  )

  return pages
})

Effect.runPromise(program)
```

The key insight: `Effect.forEach` with `{ concurrency: "unbounded" }` forks all 20 fibers immediately. The semaphore then acts as the actual throttle — at most 3 hold permits at once, the rest block in a fair FIFO queue waiting for a permit to become available.

---

## Tour

### FiberRef — fiber-local state

`FiberRef` is Effect's analog of thread-local storage, but fiber-aware. Every fiber has its own copy of a `FiberRef`'s value, and the copy is inherited by child fibers when they are forked.

**Construction.** `FiberRef.make` creates a scoped `FiberRef` — it lives as long as the enclosing scope:

```ts
import { Effect, FiberRef } from "effect"

const program = Effect.scoped(
  Effect.gen(function* () {
    // repos/effect/packages/effect/src/FiberRef.ts:94-100
    const correlationId = yield* FiberRef.make("none")

    yield* FiberRef.set(correlationId, "req-abc-123")

    const id = yield* FiberRef.get(correlationId)
    yield* Effect.log(`Handling request with id: ${id}`)
  })
)
```

The `make` signature allows you to configure two optional hooks: `fork` and `join`. The `fork` hook runs when a child fiber is forked and transforms the inherited value (default: identity — children see the same value). The `join` hook runs when the child fiber joins back into the parent and merges the child's final value into the parent's current value (default: keep the parent's value, discarding the child's).

**Reading and writing.** `FiberRef.get` reads the current fiber's copy. `FiberRef.set` replaces it. Both are plain `Effect`s — they compose with everything else.

**Scoped override.** `Effect.locally` temporarily overrides a `FiberRef` for the duration of one `Effect`, then restores the original value:

```ts
import { Effect, FiberRef } from "effect"

const program = Effect.scoped(
  Effect.gen(function* () {
    // repos/effect/packages/effect/src/Effect.ts:10421-10428
    const logLevel = yield* FiberRef.make("info")

    // Override to "debug" only for this subtree. The value is restored
    // when the effect completes, even on failure or interruption.
    yield* Effect.locally(logLevel, "debug")(
      Effect.gen(function* () {
        const level = yield* FiberRef.get(logLevel)
        yield* Effect.log(`level is now: ${level}`)   // "debug"
      })
    )

    const level = yield* FiberRef.get(logLevel)
    yield* Effect.log(`level restored to: ${level}`)  // "info"
  })
)
```

**Fork semantics.** When a fiber is forked, the child receives a copy of the parent's current `FiberRef` values. Mutations the child makes are invisible to the parent (and vice versa) until join. This is what makes `FiberRef` safe for request-scoped state: a correlation ID set on the request fiber automatically propagates into any child fibers the request spawns, but is never visible to sibling request fibers running concurrently.

```ts
import { Effect, FiberRef, Fiber } from "effect"

const program = Effect.scoped(
  Effect.gen(function* () {
    const corrId = yield* FiberRef.make("none")
    yield* FiberRef.set(corrId, "req-abc")

    // Child fiber inherits "req-abc" at fork time.
    const child = yield* Effect.fork(
      Effect.gen(function* () {
        const id = yield* FiberRef.get(corrId)
        // id === "req-abc"
        yield* FiberRef.set(corrId, "req-abc/child")
        // parent's copy is unaffected
      })
    )

    yield* Fiber.join(child)
    const id = yield* FiberRef.get(corrId)
    // id === "req-abc" — parent's copy unchanged
    yield* Effect.log(`Parent still has: ${id}`)
  })
)
```

Effect uses `FiberRef` internally for the current logger, tracer, span context, and log annotations. When you call `Effect.withSpan("name")`, it sets a `FiberRef` so that all effects inside the span see the right span context — without threading a parameter through every function.

### Semaphore — async resource limiting

`Semaphore` is not a module. It is an interface returned by `Effect.makeSemaphore`, defined in `Effect.ts`. Do not attempt to import `Semaphore` as a namespace — use `Effect.makeSemaphore` and work with the returned value.

```ts
import { Effect } from "effect"

// repos/effect/packages/effect/src/Effect.ts:11831-11852
const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(5)  // 5 permits
  // ...
})
```

The returned `Semaphore` interface exposes four operations:

**`withPermits(n)`** is the high-level, bracketed API. It acquires `n` permits before running the wrapped effect, then releases them when the effect completes (including on failure or interruption). This is almost always what you want:

```ts
import { Effect } from "effect"

// repos/effect/packages/effect/src/Effect.ts:11772-11821
const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(3)

  // Wraps the effect: acquire 1 permit → run → release 1 permit
  const limited = sem.withPermits(1)(
    Effect.gen(function* () {
      yield* Effect.log("inside critical section")
      yield* Effect.sleep("200 millis")
    })
  )

  // Fork 10 fibers, but at most 3 run the critical section concurrently.
  yield* Effect.all(Array.from({ length: 10 }, () => limited), {
    concurrency: "unbounded"
  })
})
```

**`take(n)` and `release(n)`** are the low-level, manual pair. `take` acquires `n` permits (suspending until available), `release` returns them. Use this pattern when the acquire and release cannot be co-located — for example, when a fiber acquires a permit during a setup phase and releases it during cleanup:

```ts
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(1)  // mutex

  // Manual acquire/release with guaranteed cleanup via acquireRelease
  const resource = yield* Effect.acquireRelease(
    Effect.flatMap(sem.take(1), () => openResource()),
    (_r) => Effect.flatMap(closeResource(), () => sem.release(1))
  )

  yield* useResource(resource)
})
```

**`withPermitsIfAvailable(n)`** is a non-blocking try-acquire. It runs the effect if permits are immediately available and returns `Option.none()` otherwise, without ever suspending:

```ts
import { Effect, Option } from "effect"

const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(1)

  // Try once, skip if permits unavailable.
  const result = yield* sem.withPermitsIfAvailable(1)(
    Effect.succeed("did the work")
  )

  if (Option.isSome(result)) {
    yield* Effect.log(`Result: ${result.value}`)
  } else {
    yield* Effect.log("Permits unavailable, skipping")
  }
})
```

**Relationship to TSemaphore.** Chapter 35 (STM) introduced `TSemaphore`, the transactional variant. Use `TSemaphore` when the semaphore acquire must compose atomically with other STM operations (for example, acquiring a semaphore and updating a `TRef` as a single transaction). Use `Effect.makeSemaphore` for everything else — it is lighter weight and has no STM overhead.

### FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking

These three modules (`FiberSet`, `FiberMap`, `FiberHandle`) provide structured containers for forked fibers. The key property they share: all three are created via `Effect.acquireRelease`, so they require a `Scope`. When the scope closes, all tracked fibers are interrupted. No manual cleanup loop required.

**FiberSet — unkeyed bag of fibers.**

`FiberSet.make()` creates a mutable set that tracks fibers. `FiberSet.run(set)(effect)` forks an effect as a daemon fiber and registers it in the set. The fiber is automatically removed when it completes:

```ts
import { Effect, FiberSet } from "effect"

// repos/effect/packages/effect/src/FiberSet.ts:117-130
const program = Effect.scoped(
  Effect.gen(function* () {
    const workers = yield* FiberSet.make()

    // Fork 5 worker fibers. All are registered in the set.
    for (let i = 0; i < 5; i++) {
      yield* FiberSet.run(workers)(
        Effect.gen(function* () {
          yield* Effect.log(`worker ${i} started`)
          yield* Effect.sleep("1 second")
          yield* Effect.log(`worker ${i} done`)
        })
      )
    }

    // Wait for all workers to finish.
    yield* FiberSet.join(workers)
  })
)
// When the scope closes, any workers still running are interrupted.
```

Use `FiberSet` when you have a pool of independent background tasks all doing the same kind of work, and you need them all cleaned up when the outer scope closes.

**FiberMap — keyed fibers, one per key.**

`FiberMap.make()` creates a map from keys to fibers. `FiberMap.run(map, key)(effect)` forks the effect and registers it under `key`. If a fiber already exists for `key`, it is interrupted before the new one starts. This makes `FiberMap` ideal for debouncing and "run once per entity" patterns:

```ts
import { Effect, FiberMap } from "effect"

// repos/effect/packages/effect/src/FiberMap.ts:120-139
const program = Effect.scoped(
  Effect.gen(function* () {
    const tasks = yield* FiberMap.make<string>()

    // Start a background sync for user "alice". If one is already running,
    // it is interrupted and replaced.
    yield* FiberMap.run(tasks, "alice")(syncUser("alice"))
    yield* FiberMap.run(tasks, "alice")(syncUser("alice"))  // cancels previous

    // Different key — runs concurrently with alice.
    yield* FiberMap.run(tasks, "bob")(syncUser("bob"))

    // Retrieve the running fiber for a key (fails with NoSuchElementException if absent).
    // repos/effect/packages/effect/src/FiberMap.ts:344-355
    const aliceFiber = yield* FiberMap.get(tasks, "alice")
  })
)
```

`FiberMap.run` accepts an `onlyIfMissing` option. When set to `true`, it will only fork the effect if no fiber exists for the key, otherwise it returns the existing fiber immediately. This is the "start once, share" pattern.

**FiberHandle — single-fiber slot.**

`FiberHandle.make()` creates a slot that holds at most one fiber. `FiberHandle.run(handle)(effect)` forks the effect and stores it in the slot, interrupting any previously stored fiber:

```ts
import { Effect, FiberHandle } from "effect"

// repos/effect/packages/effect/src/FiberHandle.ts:110-125
const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* FiberHandle.make()

    // Start a background poller. The handle holds the fiber.
    yield* FiberHandle.run(handle)(pollForUpdates)

    yield* Effect.sleep("5 seconds")

    // Replace the poller (the old fiber is interrupted first).
    yield* FiberHandle.run(handle)(pollForUpdates)

    // Retrieve the current fiber.
    // repos/effect/packages/effect/src/FiberHandle.ts:303-304
    const fiber = yield* FiberHandle.get(handle)
  })
)
```

`FiberHandle` is the right tool for a single exclusive background task: a heartbeat, a debounced write, or a cancellable timer. The previous task is always cleaned up before the new one starts.

---

## A production example

A rate-limited concurrent web crawler combining all three patterns: a `Semaphore` caps concurrent outbound requests, a `FiberSet` tracks all worker fibers for clean shutdown, and a `FiberRef` carries a per-crawl correlation ID so every log line is traceable:

```ts
import { Effect, FiberRef, FiberSet } from "effect"

interface CrawlResult {
  url: string
  links: string[]
}

// Simulate fetching a page and extracting links.
const fetchPage = (url: string): Effect.Effect<CrawlResult, Error> =>
  Effect.tryPromise({
    try: async () => {
      const html = await fetch(url).then((r) => r.text())
      const links = Array.from(html.matchAll(/href="(https?:\/\/[^"]+)"/g))
        .map(([, link]) => link)
      return { url, links }
    },
    catch: (e) => new Error(String(e))
  })

// A single crawl session: correlationId flows through all forked workers.
const runCrawl = (
  seeds: string[],
  maxConcurrent: number
): Effect.Effect<CrawlResult[], Error, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      // FiberRef carries the crawl's correlation ID.
      // repos/effect/packages/effect/src/FiberRef.ts:94-100
      const corrId = yield* FiberRef.make("crawl-unset")
      const sessionId = `crawl-${Date.now()}`
      yield* FiberRef.set(corrId, sessionId)

      // Semaphore caps concurrent outbound requests.
      // repos/effect/packages/effect/src/Effect.ts:11831-11852
      const sem = yield* Effect.makeSemaphore(maxConcurrent)

      // FiberSet tracks all worker fibers. Scope close interrupts them all.
      // repos/effect/packages/effect/src/FiberSet.ts:117-130
      const workers = yield* FiberSet.make<CrawlResult, Error>()

      const results: CrawlResult[] = []

      // Fork one worker per seed URL. Each worker:
      //   1. Inherits corrId from the parent fiber at fork time.
      //   2. Acquires a semaphore permit before making the HTTP request.
      for (const url of seeds) {
        yield* FiberSet.run(workers)(
          sem.withPermits(1)(
            Effect.gen(function* () {
              const id = yield* FiberRef.get(corrId)
              yield* Effect.log(`[${id}] fetching ${url}`)

              const result = yield* fetchPage(url)
              results.push(result)

              yield* Effect.log(`[${id}] done ${url}, found ${result.links.length} links`)
              return result
            })
          )
        )
      }

      // Wait for all forked workers to complete.
      yield* FiberSet.join(workers)

      return results
    })
  )

// Run three crawl sessions with different concurrency limits.
const program = Effect.gen(function* () {
  const urls = [
    "https://effect.website",
    "https://effect.website/docs",
    "https://effect.website/blog",
  ]

  const results = yield* runCrawl(urls, 2)
  yield* Effect.log(`Crawled ${results.length} pages`)
})

Effect.runPromise(program)
```

The composition is layered: the `Scope` from `Effect.scoped` owns both the `FiberRef` and the `FiberSet`. The `FiberSet` owns the worker fibers. The workers inherit the `FiberRef` value at fork time (so the session ID flows in automatically), then acquire a semaphore permit before making the real HTTP call. When the program is interrupted or the scope closes, every in-flight fiber is interrupted and permits are released. Nothing leaks.

---

## Variations

**`FiberRef.locally` for a scoped override** — temporarily change a `FiberRef` for one subtree without affecting the rest of the fiber:

```ts
import { Effect, FiberRef } from "effect"

// repos/effect/packages/effect/src/Effect.ts:10421-10428
const verbose = yield* FiberRef.make(false)
yield* Effect.locally(verbose, true)(runVerboseDiagnostics)
// verbose is restored to false here
```

**Manual `take` / `release` pair with `acquireRelease`** — when the acquire and release are not co-located:

```ts
import { Effect } from "effect"

const guardedOpen = (sem: Effect.Semaphore, path: string) =>
  Effect.acquireRelease(
    Effect.flatMap(sem.take(1), () => openFile(path)),
    (file) => Effect.flatMap(closeFile(file), () => sem.release(1))
  )
```

**`FiberMap` with `onlyIfMissing` for singleton background tasks** — start a fiber for a key once; skip if already running:

```ts
import { Effect, FiberMap } from "effect"

const startOnce = (map: FiberMap.FiberMap<string>, key: string) =>
  FiberMap.run(map, key, { onlyIfMissing: true })(expensiveSetup(key))
```

**`FiberHandle` for a debounced write** — replace the pending write fiber on each new event:

```ts
import { Effect, FiberHandle } from "effect"

// Only the most recent write fires; previous ones are interrupted.
// repos/effect/packages/effect/src/FiberHandle.ts:344-368
const onUserInput = (handle: FiberHandle.FiberHandle<void>, value: string) =>
  FiberHandle.run(handle)(
    Effect.gen(function* () {
      yield* Effect.sleep("300 millis")
      yield* saveToDatabase(value)
    })
  )
```

**`Semaphore.resize`** — dynamically adjust the number of available permits at runtime (for example, reacting to rate-limit headers from a remote API):

```ts
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(10)
  // API told us to back off
  yield* sem.resize(2)
})
```

**`FiberSet.runtime`** — capture the current runtime and produce a plain function that forks effects into the set from outside Effect (for integrating with event listeners):

```ts
import { Effect, FiberSet } from "effect"

// repos/effect/packages/effect/src/FiberSet.ts:380-395
const program = Effect.scoped(
  Effect.gen(function* () {
    const workers = yield* FiberSet.make()
    const forkWorker = yield* FiberSet.runtime(workers)<never>()

    // forkWorker is now a plain (effect) => Fiber function.
    // Safe to pass to an EventEmitter or similar callback.
    emitter.on("job", (payload) => forkWorker(handleJob(payload)))
  })
)
```

---

## Anti-patterns

**Module-level `Semaphore` (lifecycle leak).** Creating a semaphore at module load time looks convenient but leaks permits if the program is restarted inside a test or hot-reloaded:

```ts
// WRONG — module-level semaphore has no scope, permits can get stuck.
const sem = Effect.runSync(Effect.makeSemaphore(5))

export const limitedFetch = (url: string) =>
  sem.withPermits(1)(fetch(url))
```

```ts
// CORRECT — semaphore lives inside the program's scope.
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(5)
  // ... use sem here
})
```

**Using `Effect.forEach` with high concurrency without a Semaphore.** When `concurrency` is set to a large number or `"unbounded"`, all fibers hit an external service simultaneously, triggering rate-limit errors:

```ts
// WRONG — all 1000 requests fire at once.
yield* Effect.forEach(urls, fetchPage, { concurrency: 1000 })
```

```ts
// CORRECT — semaphore limits actual in-flight requests to 10.
const sem = yield* Effect.makeSemaphore(10)
yield* Effect.forEach(
  urls,
  (url) => sem.withPermits(1)(fetchPage(url)),
  { concurrency: "unbounded" }
)
```

**Missing finalizer on forked fibers (orphaned workers).** Manually forking fibers without tracking them means they continue running after the parent exits or fails:

```ts
// WRONG — child fiber is never interrupted if the parent fails.
const program = Effect.gen(function* () {
  yield* Effect.fork(backgroundWorker)  // orphaned if parent fails
  yield* doMainWork                     // if this fails, worker keeps running
})
```

```ts
// CORRECT — FiberSet ensures workers are interrupted when scope closes.
import { Effect, FiberSet } from "effect"

const program = Effect.scoped(
  Effect.gen(function* () {
    const workers = yield* FiberSet.make()
    yield* FiberSet.run(workers)(backgroundWorker)
    yield* doMainWork  // on failure, scope closes, worker is interrupted
  })
)
```

**Using `Ref` for per-request data shared across fibers.** `Ref` is shared across all fibers that hold a reference to it. Per-request data should live in `FiberRef`, not `Ref`:

```ts
// WRONG — all requests share one Ref; mutations from concurrent requests interleave.
const correlationId = yield* Ref.make("none")

// CORRECT — each fiber gets its own copy.
const correlationId = yield* FiberRef.make("none")
```

---

## See also

- [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — the fork/join model, `Effect.fork`, `forkScoped`, and `Fiber` values that FiberSet/Map/Handle build on
- [Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends](36-concurrency-primitives.md) — `Ref` (the shared-state counterpart to `FiberRef`), `Deferred` (one-shot signaling), and `Queue` (backpressured communication between fibers)
- [Chapter 35 — STM — software transactional memory](35-stm.md) — `TSemaphore`, the transactional variant of Semaphore that composes with `TRef` updates in a single atomic transaction
- Chapter 41 (Stream deep-dive) — `Stream.mapEffect` uses `Semaphore` internally to cap concurrent effects; `Stream.fromQueue` and `Stream.fromPubSub` connect back to Chapter 36's primitives
- Part III (worked example) — uses `FiberSet` to track eviction fibers in a cache implementation; shows `FiberRef` propagating trace context into every worker
- [FiberRef — fiber-local state](../../research/02-patterns-catalog.md#fiberref--fiber-local-state) — patterns catalog entry with fork/join semantics, when-to-use guidance, and contrast with `AsyncLocalStorage`
- [Semaphore — async resource limiting](../../research/02-patterns-catalog.md#semaphore--async-resource-limiting) — patterns catalog entry with source citations at `repos/effect/packages/effect/src/Effect.ts:11772-11824` and anti-pattern comparison
- [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../../research/02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — patterns catalog entry; source citations at `repos/effect/packages/effect/src/FiberSet.ts:117-118`, `repos/effect/packages/effect/src/FiberMap.ts:120-121`, `repos/effect/packages/effect/src/FiberHandle.ts:110-111`
- [Research — effect package notes](../../research/packages/effect.md) — overview of FiberRef, Semaphore, and lifecycle tracking tools in the context of the full `effect` package
