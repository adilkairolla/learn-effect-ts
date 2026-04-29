# Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends

> **Package(s):** `effect`
> **Patterns introduced:** [Ref — atomic mutable cell](../../research/02-patterns-catalog.md#ref--atomic-mutable-cell), [Queue — unbounded / bounded / sliding / dropping](../../research/02-patterns-catalog.md#queue--unbounded--bounded--sliding--dropping), [PubSub — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast), [Deferred — one-shot async value](../../research/02-patterns-catalog.md#deferred--one-shot-async-value)
> **Reads from:** [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md), [Chapter 35 — STM — software transactional memory](35-stm.md)
> **Reads into:** Chapter 37 (FiberRef, Semaphore, and advanced concurrency patterns), Chapter 41 (Stream deep-dive — `Stream.fromPubSub` / `Stream.fromQueue`)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 17 established the fiber model: every concurrent task has a parent, lifetimes are bounded by scopes, and interruption propagates cleanly. Fibers give you the scheduler. What they do not give you — on their own — is the tools fibers need to communicate with each other.

Vanilla TypeScript has four common primitives for this job. Every one of them breaks in concurrent code.

**Shared `let`.**
The simplest shared state is a module-level variable. But `let` plus `await` is not atomic:

```ts
// NOT safe under concurrent fibers
let counter = 0

async function increment() {
  const current = counter   // read
  // Another fiber can run here, reading the same `current`.
  counter = current + 1     // write — last writer wins
}

await Promise.all([increment(), increment(), increment()])
// counter is likely 1, not 3
```

The gap between the read and the write is a real race window. Under Effect's cooperative scheduler the gap is even wider: every `yield*` is an opportunity for a different fiber to interleave.

**A homegrown queue.**
If fibers need to hand work to each other, the obvious solution is an array used as a queue. But arrays have no backpressure: a fast producer can enqueue work faster than a slow consumer can drain it, growing the array without bound until the process is OOM-killed.

**`EventEmitter` for fan-out.**
Node's `EventEmitter` broadcasts to multiple listeners. But it has no backpressure, listener registration leaks (no automatic cleanup when a listener is done), errors thrown inside one listener crash the event loop, and the API is untyped — a missing event name is a silent no-op, not a compile error.

**`Promise` for one-shot signaling.**
A bare `Promise` can signal completion between two pieces of code, but its `resolve`/`reject` callbacks live outside the type system, there is no way to observe whether the promise was interrupted, and composing it with Effect's cancellation model requires wrapping every `then` in `Effect.tryPromise`. The result is boilerplate with no type safety on the error channel.

Effect ships four primitives that replace all four patterns: `Ref`, `Queue`, `PubSub`, and `Deferred`.

---

## The minimal example

Two fibers share a counter through a `Ref`. One increments it a thousand times, the other decrements it a thousand times; the final result must always be zero.

```ts
import { Effect, Ref } from "effect"

const program = Effect.gen(function* () {
  // Ref.make creates an atomically-updatable cell.
  // repos/effect/packages/effect/src/Ref.ts:65-69
  const counter = yield* Ref.make(0)

  const increment = Ref.update(counter, (n) => n + 1).pipe(
    Effect.replicateEffect(1000)
  )
  const decrement = Ref.update(counter, (n) => n - 1).pipe(
    Effect.replicateEffect(1000)
  )

  // Run both fibers concurrently; wait for both to finish.
  // Chapter 17 covers Effect.fork / Fiber.join in detail.
  yield* Effect.all([increment, decrement], { concurrency: "unbounded" })

  const result = yield* Ref.get(counter)
  // repos/effect/packages/effect/src/Ref.ts:71-75
  yield* Effect.log(`Final counter: ${result}`) // always 0
})

Effect.runPromise(program)
```

`Ref.update` is atomic: even with thousands of interleaved fibers, no update is lost. The result is always zero.

---

## Tour

### Ref — atomic mutable cell

`Ref<A>` is a mutable cell that can be read and written atomically by any number of concurrent fibers. It is the standard replacement for a `let` variable in Effect code.

**Defined at** `repos/effect/packages/effect/src/Ref.ts:27-32`:

```ts
export interface Ref<in out A>
  extends Ref.Variance<A>, Effect.Effect<A>, Readable.Readable<A> {
  modify<B>(f: (a: A) => readonly [B, A]): Effect.Effect<B>
}
```

The interface extends `Effect.Effect<A>`, so a `Ref` is itself a yieldable: `yield* myRef` reads the current value without calling `Ref.get` explicitly. That said, the explicit form is often clearer in a generator, and both compile to the same fiber operation.

**Creating a `Ref`** — `Ref.make` at `repos/effect/packages/effect/src/Ref.ts:65-69`:

```ts
import { Effect, Ref } from "effect"

const makeRef = Effect.gen(function* () {
  const ref = yield* Ref.make({ count: 0, name: "Alice" })
  return ref
})
```

**Reading** — `Ref.get` at `repos/effect/packages/effect/src/Ref.ts:71-75`:

```ts
const value = yield* Ref.get(ref)
```

**Writing** — `Ref.set` at `repos/effect/packages/effect/src/Ref.ts:122-129`:

```ts
yield* Ref.set(ref, { count: 1, name: "Alice" })
```

**Pure update (read-modify-write atomically)** — `Ref.update` at `repos/effect/packages/effect/src/Ref.ts:140-147`:

```ts
yield* Ref.update(ref, (state) => ({ ...state, count: state.count + 1 }))
```

**Atomic read-modify-return** — `Ref.modify` at `repos/effect/packages/effect/src/Ref.ts:104-111`. The function returns a tuple `[returnValue, newState]`, which makes it the primitive from which `update`, `get`, and `set` are all derived:

```ts
// Atomically dequeue from a list stored in a Ref
const head = yield* Ref.modify(listRef, (xs) =>
  xs.length === 0
    ? [undefined, xs]
    : [xs[0], xs.slice(1)]
)
```

**Swap** — `Ref.getAndSet` at `repos/effect/packages/effect/src/Ref.ts:77-84` reads the old value and writes the new one atomically.

**When to reach for `TRef` instead.** `Ref.update` is atomic on a single cell. But two separate `Ref` updates on different cells can interleave. The bank-transfer scenario from Chapter 35 is the canonical example: to debit one `Ref` and credit another as one indivisible operation, you need `TRef` inside an `STM.commit`. The rule of thumb is: one variable, one update — use `Ref`. Two or more variables that must change together — use `TRef`.

---

### Queue — unbounded / bounded / sliding / dropping

`Queue<A>` is a typed, async, backpressure-aware FIFO channel between fibers. The four constructors differ only in their overflow strategy when the queue is full.

All four constructors live in `repos/effect/packages/effect/src/Queue.ts`:

| Constructor | Line | Overflow behavior |
|---|---|---|
| `Queue.bounded(n)` | `:423-435` | Suspends the producer until space is available |
| `Queue.dropping(n)` | `:437-450` | Drops new elements silently; returns `false` from `offer` |
| `Queue.sliding(n)` | `:452-465` | Drops the oldest element to make room for the new one |
| `Queue.unbounded()` | `:467-473` | Never blocks; grows without limit |

**The interface** — producers call `offer`; consumers call `take`, `takeAll`, or `takeBetween`. Both sides are declared on `Enqueue` (`repos/effect/packages/effect/src/Queue.ts:104-131`) and `Dequeue` (`repos/effect/packages/effect/src/Queue.ts:133-165`) interfaces respectively; `Queue<A>` extends both.

```ts
import { Effect, Queue } from "effect"

const program = Effect.gen(function* () {
  // A bounded queue with room for 16 items.
  const q = yield* Queue.bounded<string>(16)

  // offer suspends if the queue is full (bounded strategy).
  yield* Queue.offer(q, "hello")
  yield* Queue.offer(q, "world")

  // take suspends until an item is available.
  const first = yield* q.take
  const rest  = yield* q.takeAll   // Chunk<string>
  return [first, rest]
})
```

`q.size` (`repos/effect/packages/effect/src/Queue.ts:483-491`) is an Effect that returns the current number of elements. A negative size means fibers are suspended waiting for elements.

`q.shutdown` interrupts all suspended producers and consumers; subsequent calls to `offer` or `take` fail immediately. Use this to drain and close a queue at program shutdown.

**Choosing the right strategy.** Use `bounded` for work queues where the producer should slow down when the consumer can't keep up — this prevents unbounded memory growth and makes backpressure visible as fiber suspension rather than a crash. Use `dropping` when you are generating metrics or log lines and it is acceptable to lose entries under sustained load rather than stall the producer. Use `sliding` when you want a live view of the most recent N items — a ring buffer. Reserve `unbounded` for tests or when you have external proof that the queue will always drain faster than it fills.

---

### PubSub — multi-subscriber broadcast

`PubSub<A>` is a message hub: one or more publishers send messages; each active subscriber receives every message independently. It is the typed, backpressure-aware, lifecycle-safe replacement for `EventEmitter`.

The four constructors follow the same backpressure naming as `Queue`. They are defined at `repos/effect/packages/effect/src/PubSub.ts`:

- `PubSub.bounded(n)` — `:39-51` — the hub blocks publishers until the slowest subscriber has consumed; all subscribers' buffers are bounded to `n`.
- `PubSub.dropping(n)` — `:53-64` — messages are dropped if any subscriber's buffer is full.
- `PubSub.sliding(n)` — `:66-77` — oldest messages are evicted from full subscriber buffers.
- `PubSub.unbounded()` — `:79-86` — no capacity limit.

An optional `replay` option retains the last N messages so that late subscribers receive recent history immediately.

**The interface** — `PubSub<A>` extends `Queue.Enqueue<A>` and adds `publish` (single message) and `subscribe` (returns a scoped `Dequeue`).

`PubSub.subscribe` at `repos/effect/packages/effect/src/PubSub.ts:174-182` returns `Effect<Queue.Dequeue<A>, never, Scope.Scope>`. The `Scope` requirement means the subscription is automatically cleaned up when the scope closes — no listener leaks.

```ts
import { Effect, PubSub, Queue } from "effect"

const program = Effect.scoped(
  Effect.gen(function* () {
    const hub = yield* PubSub.bounded<string>(64)

    // Each subscriber gets its own Dequeue.
    // When this scope closes, both subscriptions are cleaned up.
    const sub1 = yield* PubSub.subscribe(hub)
    const sub2 = yield* PubSub.subscribe(hub)

    yield* PubSub.publish(hub, "event-A")
    yield* PubSub.publish(hub, "event-B")

    // Both subscribers see both messages independently.
    const [a1, a2] = yield* Effect.all([sub1.take, sub2.take])
    const [b1, b2] = yield* Effect.all([sub1.take, sub2.take])
    return { a1, a2, b1, b2 }
  })
)
```

**`publish` vs `offer`.** Because `PubSub<A>` extends `Queue.Enqueue<A>`, you can also call `queue.offer(value)` on a `PubSub` — the dual API is intentional. The `publish` method on the instance and the `PubSub.publish` function at `repos/effect/packages/effect/src/PubSub.ts:151-160` are the idiomatic choices.

**Key difference from `Queue`.** With a `Queue`, each item is taken by exactly one consumer. With a `PubSub`, each item is delivered to all active subscribers. If subscriber count is zero when a message arrives, that message is lost (unless `replay` is set).

---

### Deferred — one-shot async value

`Deferred<A, E>` is a typed one-shot variable. One fiber sets it (with a success value or a typed failure); any number of fibers can suspend on it until it is set, then they all resume simultaneously.

The model is described in the interface docstring at `repos/effect/packages/effect/src/Deferred.ts:28-36`:

> A `Deferred` represents an asynchronous variable that can be set exactly once, with the ability for an arbitrary number of fibers to suspend (by calling `Deferred.await`) and automatically resume when the variable is set.

**Creating** — `Deferred.make` at `repos/effect/packages/effect/src/Deferred.ts:83-88`:

```ts
import { Deferred, Effect } from "effect"

const d = yield* Deferred.make<string, Error>()
```

**Completing** — `Deferred.succeed` at `repos/effect/packages/effect/src/Deferred.ts:264-273` and `Deferred.fail` at `repos/effect/packages/effect/src/Deferred.ts:150-160`:

```ts
yield* Deferred.succeed(d, "the result")   // returns Effect<boolean>
// or
yield* Deferred.fail(d, new Error("oops")) // returns Effect<boolean>
```

Both return `Effect<boolean>` — `true` if this fiber was the one to set the value, `false` if another fiber already completed it. The "set exactly once" guarantee is enforced: subsequent calls are no-ops.

**Awaiting** — `Deferred.await` at `repos/effect/packages/effect/src/Deferred.ts:98-109`:

```ts
const value = yield* Deferred.await(d) // suspends until completed
```

If the `Deferred` was completed with `fail`, `await` re-raises the error in the waiting fiber. If the completing fiber is interrupted before it calls `succeed`, all waiting fibers are interrupted too.

**`Deferred.complete`** at `repos/effect/packages/effect/src/Deferred.ts:111-124` completes the deferred with the result of a full `Effect` — useful when the completion value is computed asynchronously. `completeWith` at `:126-136` is the faster variant that records the effect lazily rather than running it eagerly.

**`Deferred` vs a raw `Promise`.** A bare `Promise` passes `resolve` outside the type system and has no typed error channel. `Deferred` has a typed `E` parameter, participates in Effect's interruption model (completing fibers and waiting fibers are linked), and composes cleanly with `Effect.gen`.

---

## A production example

A bounded worker pool that processes typed jobs. A `Ref` tracks in-flight job count; a `Deferred` signals clean shutdown once the queue is drained and all workers have finished.

```ts
import { Chunk, Deferred, Effect, Queue, Ref } from "effect"

interface Job {
  readonly id: number
  readonly payload: string
}

interface JobResult {
  readonly jobId: number
  readonly output: string
}

const processJob = (job: Job): Effect.Effect<JobResult> =>
  Effect.gen(function* () {
    // Simulate work
    yield* Effect.sleep("10 millis")
    return { jobId: job.id, output: `processed:${job.payload}` }
  })

const workerPool = (
  queue: Queue.Queue<Job>,
  results: Queue.Queue<JobResult>,
  active: Ref.Ref<number>,
  done: Deferred.Deferred<void>
) =>
  Effect.gen(function* () {
    // Take a job; if the queue is shut down, fiber exits.
    const job = yield* queue.take
    yield* Ref.update(active, (n) => n + 1)
    const result = yield* processJob(job)
    yield* Queue.offer(results, result)
    const remaining = yield* Ref.updateAndGet(active, (n) => n - 1)
    const queueEmpty = yield* queue.isEmpty
    // Signal done when no more work is in-flight and queue is empty.
    if (remaining === 0 && queueEmpty) {
      yield* Deferred.succeed(done, void 0)
    }
  }).pipe(Effect.forever)

export const runPool = Effect.gen(function* () {
  // repos/effect/packages/effect/src/Queue.ts:423-435
  const jobQueue     = yield* Queue.bounded<Job>(256)
  // repos/effect/packages/effect/src/Queue.ts:467-473
  const resultQueue  = yield* Queue.unbounded<JobResult>()
  // repos/effect/packages/effect/src/Ref.ts:65-69
  const activeCount  = yield* Ref.make(0)
  // repos/effect/packages/effect/src/Deferred.ts:83-88
  const shutdownGate = yield* Deferred.make<void>()

  // Fork 4 workers — Chapter 17 covers Effect.fork in detail.
  yield* Effect.all(
    Array.from({ length: 4 }, () =>
      workerPool(jobQueue, resultQueue, activeCount, shutdownGate).pipe(
        Effect.fork
      )
    )
  )

  // Enqueue jobs
  const jobs: Job[] = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    payload: `item-${i}`
  }))
  yield* Queue.offerAll(jobQueue, jobs)

  // Wait for all work to finish, then collect results.
  // repos/effect/packages/effect/src/Deferred.ts:98-109
  yield* Deferred.await(shutdownGate)

  // repos/effect/packages/effect/src/Queue.ts:144-148
  const allResults = yield* resultQueue.takeAll
  yield* Effect.log(`Completed ${Chunk.size(allResults)} jobs`)
  return allResults
})
```

Key design decisions:
- `Queue.bounded(256)` provides backpressure: if workers fall behind, the enqueue loop suspends rather than allocating unboundedly.
- `Ref<number>` tracks in-flight count atomically — each worker increments on take and decrements on complete.
- `Deferred<void>` as a one-shot latch: once the last job is confirmed done, all fibers waiting on `Deferred.await` resume at once. This is preferable to polling the `Ref` in a `Schedule` loop.

---

## Variations

**Sliding window aggregator — last N log lines.**
Use `Queue.sliding` when you only care about recent items:

```ts
import { Effect, Queue } from "effect"

const tail = Effect.gen(function* () {
  // Holds the 100 most-recent lines; older ones are evicted automatically.
  // repos/effect/packages/effect/src/Queue.ts:452-465
  const ring = yield* Queue.sliding<string>(100)
  yield* Queue.offer(ring, "line-1")
  yield* Queue.offer(ring, "line-2")
  // ... 98 more lines
  const recent = yield* ring.takeAll
  return recent
})
```

**One-shot readiness latch via `Deferred`.**
A service that isn't ready to serve traffic until initialization completes:

```ts
import { Deferred, Effect } from "effect"

const makeReadinessGate = Effect.gen(function* () {
  const gate = yield* Deferred.make<void>()
  const waitUntilReady = Deferred.await(gate)
  const markReady = Deferred.succeed(gate, void 0)
  return { waitUntilReady, markReady }
})
```

**Broadcast with backpressure via `PubSub.bounded`.**
All slow subscribers create backpressure on the publisher — no messages are silently lost:

```ts
import { Effect, PubSub } from "effect"

// repos/effect/packages/effect/src/PubSub.ts:39-51
const hub = yield* PubSub.bounded<string>(32)
// If a subscriber's buffer is full, `publish` suspends until it drains.
yield* PubSub.publish(hub, "critical-event")
```

**Rate-limiting with `Ref` + `Schedule`.**
A token bucket that limits to N operations per window:

```ts
import { Effect, Ref, Schedule } from "effect"

const makeTokenBucket = (capacity: number) =>
  Effect.gen(function* () {
    const tokens = yield* Ref.make(capacity)
    const refill  = Ref.set(tokens, capacity)
    const acquire = Effect.gen(function* () {
      const available = yield* Ref.get(tokens)
      if (available === 0) yield* Effect.fail("RateLimited" as const)
      yield* Ref.update(tokens, (n) => n - 1)
    })
    // Refill every second
    yield* refill.pipe(
      Effect.repeat(Schedule.spaced("1 second")),
      Effect.fork
    )
    return { acquire }
  })
```

**`Ref.modify` for an atomic pop.**
Read the old value and derive both a return value and the new state in one lock-free step:

```ts
import { Effect, Ref } from "effect"

// repos/effect/packages/effect/src/Ref.ts:104-111
const pop = <A>(ref: Ref.Ref<ReadonlyArray<A>>) =>
  Ref.modify(ref, (arr) =>
    arr.length === 0 ? [undefined, arr] : [arr[0], arr.slice(1)]
  )
```

---

## Anti-patterns

### Shared `let` instead of `Ref`

```ts
// WRONG — race condition between read and write
let count = 0
const increment = Effect.sync(() => { count++ })
yield* Effect.all([increment, increment, increment], { concurrency: "unbounded" })
// count is unpredictably 1, 2, or 3
```

```ts
// CORRECT — atomic update
import { Effect, Ref } from "effect"
const count = yield* Ref.make(0)
const increment = Ref.update(count, (n) => n + 1)
yield* Effect.all([increment, increment, increment], { concurrency: "unbounded" })
// count is always 3
```

`Ref.update` is atomic across all concurrent fibers. No lost increments.

### `Queue.unbounded` in production without an external bound

```ts
// WRONG — queue grows without limit if producer is faster than consumer
const q = yield* Queue.unbounded<Job>()
```

```ts
// CORRECT — use bounded with a capacity that reflects your SLO
const q = yield* Queue.bounded<Job>(1024)
// producer fibers will suspend instead of growing memory
```

`Queue.bounded` turns memory pressure into fiber suspension, which is observable and recoverable. An unbounded queue is only appropriate in tests or when you have verified upstream rate limiting.

### `EventEmitter` for typed fan-out

```ts
// WRONG — untyped, no backpressure, listeners accumulate
import EventEmitter from "node:events"
const emitter = new EventEmitter()
emitter.on("data", (payload) => { /* wrong event name is a silent no-op */ })
emitter.emit("Data", "oops") // typo, listener never fires
```

```ts
// CORRECT — typed, scoped, backpressured
import { Effect, PubSub } from "effect"
// repos/effect/packages/effect/src/PubSub.ts:85-86
const hub = yield* PubSub.unbounded<{ type: "data"; payload: string }>()
const sub = yield* PubSub.subscribe(hub) // subscriber lifetime tied to Scope
yield* PubSub.publish(hub, { type: "data", payload: "hello" })
const msg = yield* sub.take // TypeScript knows the shape
```

### Polling a `Ref` instead of `Deferred.await`

```ts
// WRONG — busy-polls every 50 ms; wastes CPU; introduces latency jitter
const waitForReady = (flag: Ref.Ref<boolean>) =>
  Effect.gen(function* () {
    while (!(yield* Ref.get(flag))) {
      yield* Effect.sleep("50 millis")
    }
  })
```

```ts
// CORRECT — suspends with zero CPU cost; resumes the instant it is set
import { Deferred, Effect } from "effect"
// repos/effect/packages/effect/src/Deferred.ts:98-109
const waitForReady = (gate: Deferred.Deferred<void>) =>
  Deferred.await(gate)
```

`Deferred.await` parks the fiber in a wait-queue maintained by the runtime. No timer, no wasted cycles, no latency floor from the poll interval.

---

## See also

- [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — the fiber model, `Effect.fork`, `Fiber.join`, and structured concurrency that these primitives are built on top of. Read this first.
- [Chapter 35 — STM — software transactional memory](35-stm.md) — `TRef`, `TQueue`, `TPubSub`, and `TDeferred` are the transactional versions of all four primitives in this chapter. Use the STM variants when you need to update multiple cells atomically.
- [Chapter 37 — FiberRef, Semaphore, and advanced concurrency patterns](37-fiberref-semaphore.md) — `FiberRef` for fiber-local state that is inherited by children; `Semaphore` for async rate limiting; `SynchronizedRef` for effectful atomic updates.
- [Chapter 41 — Stream deep-dive](41-stream.md) — `Stream.fromQueue` and `Stream.fromPubSub` bridge these primitives into the streaming world; a `Queue` becomes a pull-based `Stream`, and a `PubSub` subscription becomes a broadcast `Stream`.
- [Ref — atomic mutable cell](../../research/02-patterns-catalog.md#ref--atomic-mutable-cell) — patterns catalog entry, including when to prefer `SynchronizedRef` or `SubscriptionRef`.
- [Queue — unbounded / bounded / sliding / dropping](../../research/02-patterns-catalog.md#queue--unbounded--bounded--sliding--dropping) — patterns catalog entry, including the comparison with `Mailbox` for actor-style inboxes.
- [PubSub — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast) — patterns catalog entry, including the `replay` option for late-binding subscribers.
- [Deferred — one-shot async value](../../research/02-patterns-catalog.md#deferred--one-shot-async-value) — patterns catalog entry, with the comparison to `Promise` and notes on multi-waiter semantics.
- [`research/packages/effect.md`](../../research/packages/effect.md) — per-package note covering `Ref`, `Queue`, `PubSub`, `Deferred`, and adjacent types (`SynchronizedRef`, `SubscriptionRef`, `Mailbox`, `FiberSet`/`FiberMap`/`FiberHandle`).
