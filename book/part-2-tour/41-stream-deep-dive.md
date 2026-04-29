# Chapter 41 — Stream deep-dive — Channel, Sink, GroupBy, and back-pressure

> **Package(s):** `effect`
> **Patterns introduced:** [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](../../research/02-patterns-catalog.md#streamfrompubsub--fromqueue--fromschedule--groupby), [Channel — bidirectional stream primitive (Stream's underlying type)](../../research/02-patterns-catalog.md#channel--bidirectional-stream-primitive-streams-underlying-type), [Sink — Stream consumer / aggregator](../../research/02-patterns-catalog.md#sink--stream-consumer--aggregator)
> **Reads from:** [Chapter 16 — Stream: pull-based async iteration](../part-1-foundations/16-stream.md), [Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends](36-concurrency-primitives.md), [Chapter 37 — FiberRef, Semaphore, and advanced concurrency patterns](37-fiber-ref-and-semaphore.md)
> **Reads into:** nothing — this closes the core deep-dive section
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 16 introduced `Stream<A, E, R>` as a typed pull-based pipeline: sources, transformers, and terminal runners. That level of API is enough for most work. But three recurring situations push past it.

**Back-pressure from external sources.** Suppose you have a message queue, an EventEmitter, or a PubSub hub driving your stream. You cannot pull from these on demand — they push. You need a way to absorb incoming messages into Effect's pull model without dropping items or growing memory without bound. Async iterables have no typed cancellation. EventEmitters have no built-in back-pressure. A hand-rolled `setInterval` poll has no clean shutdown. None of them integrate with `Scope` for resource cleanup.

```ts
// Typical Node.js — no back-pressure, no typed errors, no cleanup
const emitter = new EventEmitter()
const messages: unknown[] = []

emitter.on("message", (msg) => messages.push(msg)) // unbounded — OOM waiting to happen

async function processLoop() {
  while (true) {
    const item = messages.shift()
    if (item) await process(item)
    else await sleep(10) // polling — wasteful and laggy
  }
}
// No way to stop cleanly. No typed error propagation. Memory grows until crash.
```

**Routing by key.** Once a stream carries mixed events — user actions, system events, messages from many users — you need to split it by key and process each bucket independently. With async iterables you hand-write a `Map<string, AsyncQueue>`, spawn workers per key, and pray nothing leaks. There is no standard operator.

**Custom consumers.** The high-level `Stream.runCollect` / `Stream.runFold` shortcuts are not composable — you cannot combine "give me the first element" with "also count how many you consumed" without a custom accumulator. The effect ecosystem needs a first-class consumer abstraction.

Effect's answer is three primitives that compose with everything else: `Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy` for sourcing and routing; `Channel` as the raw bidirectional typed pipe that underlies the whole system; and `Sink` as the composable consumer abstraction.

This chapter assumes you have read Chapter 16 (Stream basics). The focus here is on the lower-level machinery and the production patterns it enables.

---

## The minimal example

Back-pressure via a bounded queue: the producer offers items, the consumer takes them via a `Stream`, and the queue capacity is the pressure valve.

```ts
import { Effect, Queue, Stream } from "effect"

const program = Effect.gen(function* () {
  // Bounded queue — capacity 4 is the back-pressure point.
  // When the queue is full, Queue.offer suspends the producer fiber
  // until the consumer drains at least one slot.
  // repos/effect/packages/effect/src/Queue.ts — Queue.bounded
  const queue = yield* Queue.bounded<number>(4)

  // Producer: offers 1..10.  When the queue fills, it back-pressures automatically.
  const producer = Effect.gen(function* () {
    for (let i = 1; i <= 10; i++) {
      yield* Queue.offer(queue, i)
    }
    yield* Queue.shutdown(queue)  // signals end-of-stream to consumer
  })

  // Consumer: turns the queue into a Stream, processes each item.
  // repos/effect/packages/effect/src/Stream.ts:2148-2154
  const consumer = Stream.fromQueue(queue).pipe(
    Stream.mapEffect((n) => Effect.succeed(n * 2)),
    Stream.runForEach((n) =>
      Effect.sync(() => console.log("consumed:", n))
    )
  )

  // Run both concurrently — producer back-pressures against consumer speed
  yield* Effect.all([producer, consumer], { concurrency: 2 })
})

Effect.runPromise(program)
// consumed: 2  consumed: 4  ... consumed: 20
```

The bounded queue is the only moving part for back-pressure. `Stream.fromQueue` drains it lazily; the runtime handles interleaving.

---

## Tour

### Pattern 1 — Stream from sources: `fromPubSub`, `fromQueue`, `fromSchedule`, `groupBy`

These four constructors bridge the gap between external push sources and Effect's pull model.

**`Stream.fromPubSub`** turns a `PubSub<A>` subscription into a stream. The subscription is acquired inside the stream's scope, so it is automatically released when the stream terminates or its parent scope closes. Because PubSub is a broadcast hub, multiple subscribers each get every message — standard fan-out.

```ts
// repos/effect/packages/effect/src/Stream.ts:2031-2058
// fromPubSub: the stream acquires a subscription to the hub on start.
// When the stream's scope closes, the subscription is released.
export const fromPubSub: {
  <A>(pubsub: PubSub.PubSub<A>, options: { readonly scoped: true; ... }): Effect.Effect<Stream<A>, never, Scope.Scope>
  <A>(pubsub: PubSub.PubSub<A>, options?: { readonly scoped?: false; ... }): Stream<A>
}
```

Use `fromPubSub` for fan-out: every listener gets every published message. If messages published before the subscription was created must be seen, use a persistent queue or `Mailbox` instead — PubSub delivers only to active subscribers (Chapter 36).

**`Stream.fromQueue`** drains a `Queue.Dequeue<A>` into a stream. The stream ends when the queue is shut down (`Queue.shutdown`). This is the canonical pattern for queue-based worker loops — the queue provides both back-pressure (bounded capacity) and a clean shutdown signal.

```ts
// repos/effect/packages/effect/src/Stream.ts:2137-2154
// fromQueue: drains the queue; ends when the queue shuts down.
export const fromQueue: <A>(
  queue: Queue.Dequeue<A>,
  options?: { readonly maxChunkSize?: number; readonly shutdown?: boolean }
) => Stream<A>
```

The `shutdown: true` option automatically shuts down the queue when the stream finishes — useful for single-consumer patterns where the stream owns the queue's lifecycle.

**`Stream.fromSchedule`** converts a `Schedule` into a stream of tick values. Every time the schedule fires it emits one element. The stream ends when the schedule does.

```ts
// repos/effect/packages/effect/src/Stream.ts:2208-2232
// fromSchedule: emits an element each time the schedule fires.
export const fromSchedule: <A, R>(schedule: Schedule.Schedule<A, unknown, R>) => Stream<A, never, R>
```

A common use: polling every five seconds is `Stream.fromSchedule(Schedule.spaced("5 seconds")).pipe(Stream.flatMap(() => doFetch))`. This replaces `setInterval` with a composable, cancellable, back-pressure-aware poll.

**`Stream.groupBy` and `Stream.groupByKey`** partition a stream by a computed key and deliver each group as its own independent sub-stream. `groupBy` accepts an effectful key-value extractor; `groupByKey` accepts a pure key function.

```ts
// repos/effect/packages/effect/src/Stream.ts:2246-2293
// groupBy: returns a GroupBy<K, V, E, R> — a partitioned stream handle.
// repos/effect/packages/effect/src/Stream.ts:2295-2344
// groupByKey: pure key version.
```

The resulting `GroupBy<K, V, E, R>` value is not a stream itself — it is a routing table. You call `GroupBy.evaluate` (from `repos/effect/packages/effect/src/GroupBy.ts:61-71`) to run a handler per group and merge the results. The `GroupBy` interface exposes:

- `GroupBy.evaluate(f)` — run `f(key, stream)` for every group in parallel; merge results (`repos/effect/packages/effect/src/GroupBy.ts:61-71`).
- `GroupBy.first(n)` — only process the first `n` distinct keys; discard the rest (`repos/effect/packages/effect/src/GroupBy.ts:90-93`).
- `GroupBy.filter(pred)` — include only groups whose key matches the predicate (`repos/effect/packages/effect/src/GroupBy.ts:79-82`).

Each group is backed by an internal queue. The `bufferSize` option on `groupBy` sets that queue's capacity — the back-pressure point for each per-key lane. If a group queue fills, the producer is suspended until the group consumer drains it.

The `GroupBy` type is defined at `repos/effect/packages/effect/src/GroupBy.ts:32-34`. Its `grouped` field is a `Stream<readonly [K, Queue.Dequeue<Take.Take<V, E>>], E, R>` — each emitted pair is a key plus a dequeue that carries the group's items as `Take` values (end-of-stream or element chunks).

---

### Pattern 2 — Channel: the bidirectional primitive

`Channel` is the machinery that `Stream` and `Sink` compile to. You rarely write `Channel` code in application logic — the high-level APIs cover almost everything — but understanding the type unlocks two things: reading error messages from complex stream types, and writing custom operators when `Stream`'s combinators fall short.

The `Channel` interface is defined at `repos/effect/packages/effect/src/Channel.ts:48-98`:

```ts
// repos/effect/packages/effect/src/Channel.ts:48-98
// A Channel is a nexus of I/O operations supporting both reading and writing.
export interface Channel<
  out OutElem,   // type of values emitted downstream
  in  InElem  = unknown,  // type of values read from upstream
  out OutErr  = never,    // error type going downstream
  in  InErr   = unknown,  // error type expected from upstream
  out OutDone = void,     // terminal value emitted when done
  in  InDone  = unknown,  // terminal value expected from upstream
  out Env     = never     // services required
>
```

Seven type parameters. The variance annotations (`out` / `in`) enforce composability at compile time: two channels can be piped only if the downstream's `InElem` matches the upstream's `OutElem`, and the downstream's `InErr` matches the upstream's `OutErr`.

**Composing channels with `Channel.pipeTo`** (`repos/effect/packages/effect/src/Channel.ts:1690-1711`):

```ts
// repos/effect/packages/effect/src/Channel.ts:1690-1711
// pipeTo: connects two channels — upstream's OutElem must match downstream's InElem.
export const pipeTo: {
  <OutElem2, OutElem, OutErr2, OutErr, OutDone2, OutDone, Env2>(
    that: Channel<OutElem2, OutElem, OutErr2, OutErr, OutDone2, OutDone, Env2>
  ): <InElem, InErr, InDone, Env>(
    self: Channel<OutElem, InElem, OutErr, InErr, OutDone, InDone, Env>
  ) => Channel<OutElem2, InElem, OutErr2, InErr, OutDone2, InDone, Env2 | Env>
  ...
}
```

**Reading and writing.** The two fundamental channel operations are `Channel.read` (consume one element from upstream, `repos/effect/packages/effect/src/Channel.ts:1833`) and `Channel.write` (emit one element downstream, `repos/effect/packages/effect/src/Channel.ts:2193-2199`):

```ts
// repos/effect/packages/effect/src/Channel.ts:1833
export const read: <In>() => Channel<never, In, Option.Option<never>, unknown, In, unknown>

// repos/effect/packages/effect/src/Channel.ts:2193-2199
// write: emits a single value downstream.
export const write: <OutElem>(out: OutElem) => Channel<OutElem>
```

**Running a channel.** `Channel.runScoped` executes a channel that emits no elements and returns its terminal value, registering cleanup with the current `Scope` (`repos/effect/packages/effect/src/Channel.ts:1960-1968`).

In practice, `Stream` is a `Channel<Chunk<A>, unknown, E, unknown, unknown, unknown, R>` and `Sink` is a `Channel<never, Chunk<In>, E, unknown, A, unknown, R>`. `Stream.run(sink)` is `Channel.pipeTo(stream.channel, sink.channel)` followed by `Channel.runScoped`. The `Stream.pipeThroughChannel` combinator exposes this escape hatch when you need to insert a raw `Channel` into a `Stream` pipeline (`repos/effect/packages/effect/src/Stream.ts:3576-3590`).

---

### Pattern 3 — Sink: the composable consumer

A `Sink<A, In, L, E, R>` consumes elements of type `In` from a stream, accumulates state, and eventually produces a result of type `A`. Type parameter `L` is the "leftover" type — elements the sink did not consume and that should be returned to the stream for further processing. `E` and `R` carry the usual error and requirement channels.

The interface is at `repos/effect/packages/effect/src/Sink.ts:38-50`:

```ts
// repos/effect/packages/effect/src/Sink.ts:38-50
// A Sink consumes variable amounts of In, may fail with E, yields A plus leftover L.
export interface Sink<out A, in In = unknown, out L = never, out E = never, out R = never>
  extends Sink.Variance<A, In, L, E, R>, Pipeable {}
```

**Built-in sinks.** The built-in sinks cover the common aggregation patterns:

- `Sink.drain` — consume all input, discard every element, return `void`. The default for run-for-effects patterns (`repos/effect/packages/effect/src/Sink.ts:436-442`).
- `Sink.count` — count every element fed in; returns `number` (`repos/effect/packages/effect/src/Sink.ts:323-329`).
- `Sink.fold(s, contFn, f)` — accumulate with a state and a stop predicate. The lower-level equivalent of `Stream.runFold` that you can compose with other sinks (`repos/effect/packages/effect/src/Sink.ts:644-651`).
- `Sink.head()` — take only the first element; returns `Option<In>` (`repos/effect/packages/effect/src/Sink.ts:1041-1047`).
- `Sink.last()` — take only the last element; returns `Option<In>` (`repos/effect/packages/effect/src/Sink.ts:1058-1064`).
- `Sink.collectAll()` — accumulate every element into a `Chunk<In>`. Equivalent to `Stream.runCollect` (`repos/effect/packages/effect/src/Sink.ts:129`).
- `Sink.forEach(f)` — execute an effectful function for every element. The composable form of `Stream.runForEach` (`repos/effect/packages/effect/src/Sink.ts:905-912`).

**Running a stream with a sink.** `Stream.run(sink)` is the general combinator — it accepts any `Sink` and returns the sink's result as an `Effect` (`repos/effect/packages/effect/src/Stream.ts:4108-4121`). The convenience aliases (`runCollect`, `runFold`, `runForEach`, `runCount`) are wrappers around `run` with the corresponding built-in sink baked in.

**Composing sinks.** Sinks compose with `Sink.zip` — run two sinks simultaneously over the same elements and return both results as a tuple (`repos/effect/packages/effect/src/Sink.ts:1388-1403`):

```ts
import { Sink, Stream } from "effect"

// Run both sinks over the same stream in a single pass.
// repos/effect/packages/effect/src/Sink.ts:1388-1403
const countAndHead = Sink.zip(Sink.count, Sink.head<number>())
// Sink<[number, Option<number>], number, number, never, never>

// Stream.run with the composed sink
// repos/effect/packages/effect/src/Stream.ts:4108-4121
const result = Stream.fromIterable([1, 2, 3]).pipe(
  Stream.run(countAndHead)
)
// Effect<[3, Option.some(1)], never, never>
```

`Sink.zip` drives both sinks with the same incoming chunks. Neither sink sees elements the other does not. This is the composability that `let acc = 0; let first: number | undefined` hand-rolling cannot match.

**`Stream.pipeThrough`** threads the stream through a sink and re-emits the leftover elements (`L`) as a new stream — useful for parsers that consume a prefix of the input and leave the rest for downstream (`repos/effect/packages/effect/src/Stream.ts:3565-3574`).

---

## A production example

A realistic back-pressure pipeline: a PubSub of raw user events is subscribed to as a stream, grouped by `userId`, rate-limited per group via a Semaphore (introduced in Chapter 37), enriched, and dispatched to a telemetry sink.

```ts
import { Effect, GroupBy, PubSub, Queue, Schedule, Semaphore, Sink, Stream } from "effect"

// --- Domain types ---

interface UserEvent {
  readonly userId: string
  readonly kind: "click" | "view" | "purchase"
  readonly payload: unknown
}

interface TelemetryRecord {
  readonly userId: string
  readonly processedKind: string
}

// --- Services (simplified) ---

declare const telemetryDb: {
  readonly insert: (record: TelemetryRecord) => Effect.Effect<void, never, never>
}

declare const enrichEvent: (
  event: UserEvent
) => Effect.Effect<TelemetryRecord, never, never>

// --- Main pipeline ---

const pipeline = Effect.gen(function* () {
  // Bounded PubSub — capacity 64 is the system-level back-pressure point.
  // Chapter 36: PubSub.bounded creates a bounded broadcast hub.
  const hub = yield* PubSub.bounded<UserEvent>(64)

  // One permit per user-group: at most one concurrent enrichment per userId.
  // Chapter 37: Semaphore.make gives an async-aware counting semaphore.
  const sem = yield* Effect.makeSemaphore(1)

  // Subscribe to the hub as a Stream.
  // repos/effect/packages/effect/src/Stream.ts:2031-2058
  // The subscription is acquired inside the stream's scope.
  const events: Stream.Stream<UserEvent> = Stream.fromPubSub(hub)

  const result = yield* events.pipe(
    // Partition by userId — each group gets its own fiber and internal queue.
    // repos/effect/packages/effect/src/Stream.ts:2295-2344
    Stream.groupByKey((e) => e.userId, { bufferSize: 16 }),

    // Process first 1000 distinct user groups; ignore the rest.
    // repos/effect/packages/effect/src/GroupBy.ts:90-93
    GroupBy.first(1000),

    // For each (userId, userStream) group, rate-limit processing with the semaphore,
    // enrich each event, and emit telemetry records.
    GroupBy.evaluate((userId, userStream) =>
      userStream.pipe(
        // mapEffect: concurrency:1 per group stream — sequential within each user.
        // Chapter 37: sem.withPermits(1) provides the rate-limit.
        // repos/effect/packages/effect/src/Stream.ts:2900-2923
        Stream.mapEffect(
          (event) =>
            sem.withPermits(1)(enrichEvent(event)),
          { concurrency: 1 }
        )
      )
    ),

    // Consume the merged results with a Sink that writes to the telemetry DB.
    // repos/effect/packages/effect/src/Sink.ts:905-912
    // repos/effect/packages/effect/src/Stream.ts:4108-4121
    Stream.run(
      Sink.forEach((record: TelemetryRecord) => telemetryDb.insert(record))
    )
  )

  return result
})
```

Key points:

1. **Back-pressure chain.** The `PubSub` is bounded to 64 — publishers block when the hub is full. Each group queue (`bufferSize: 16`) blocks the group dispatcher if the per-user consumer is slow. The `Semaphore` further throttles concurrent enrichment. Back-pressure propagates end-to-end without any hand-written code.

2. **`GroupBy.first(1000)`** caps the number of active group fibers. Without it, an unbounded stream of distinct `userId` values would spawn a fiber per user, potentially thousands.

3. **`Sink.forEach`** is the composable consumer — it accepts a `TelemetryRecord => Effect<void>` and drives the stream to completion, propagating errors through the typed error channel.

4. **`Stream.fromPubSub`** manages the subscription lifecycle. When the outer `Effect` is interrupted or the stream's scope closes, the subscription is automatically released — no `emitter.removeListener` required.

---

## Variations

**1. Drain and count simultaneously with `Sink.zip`.**

```ts
import { Chunk, Effect, Sink, Stream } from "effect"

// repos/effect/packages/effect/src/Sink.ts:1388-1403
const [count, items] = await Effect.runPromise(
  Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
    Stream.run(Sink.zip(Sink.count, Sink.collectAll<number>()))
  )
)
// count = 5, items = Chunk(1, 2, 3, 4, 5)
```

**2. Polling with `Stream.fromSchedule`.**

```ts
import { Effect, Schedule, Stream } from "effect"

// repos/effect/packages/effect/src/Stream.ts:2208-2232
const pollingStream = Stream.fromSchedule(Schedule.spaced("5 seconds")).pipe(
  Stream.mapEffect(() => Effect.tryPromise(() => fetch("/api/status").then((r) => r.json()))),
  Stream.take(12) // stop after 12 polls (one minute)
)
```

**3. Raw `Channel` for a custom framing protocol.**

```ts
import { Channel, Chunk } from "effect"

// repos/effect/packages/effect/src/Channel.ts:1690-1711
// Frame a byte stream: read until newline, emit lines.
const framingChannel = Channel.readWith({
  onInput: (chunk: Uint8Array) =>
    Channel.write(Chunk.unsafeFromArray(Array.from(chunk))).pipe(
      Channel.zipRight(Channel.identity())
    ),
  onFailure: Channel.fail,
  onDone: Channel.succeed
})
```

**4. `GroupBy.filter` to route by event kind.**

```ts
import { GroupBy, Stream } from "effect"

// repos/effect/packages/effect/src/GroupBy.ts:79-82
// Only process "purchase" groups; skip clicks and views.
const purchasesOnly = Stream.fromIterable(events).pipe(
  Stream.groupByKey((e) => e.kind),
  GroupBy.filter((kind) => kind === "purchase"),
  GroupBy.evaluate((_kind, stream) => stream.pipe(Stream.map(processPurchase)))
)
```

**5. `Stream.fromQueue` with `shutdown: true` for single-owner queues.**

```ts
import { Effect, Queue, Stream } from "effect"

// repos/effect/packages/effect/src/Stream.ts:2137-2154
// The stream shuts down the queue when it finishes — no separate cleanup needed.
const ownedStream = (queue: Queue.Queue<number>) =>
  Stream.fromQueue(queue, { shutdown: true })
```

**6. `Sink.fold` for windowed aggregation.**

```ts
import { Sink, Stream } from "effect"

// repos/effect/packages/effect/src/Sink.ts:644-651
// Sum elements until the running total exceeds 100.
const windowSink = Sink.fold<number, number>(
  0,
  (acc) => acc <= 100, // contFn — continue while true
  (acc, n) => acc + n
)
```

---

## Anti-patterns

**Anti-pattern 1 — Unbounded queue as an "easy" back-pressure solution.**

```ts
// WRONG: unbounded queue — producer can fill memory before consumer catches up
const queue = await Queue.unbounded<UserEvent>()
```

```ts
// CORRECT: bounded queue — producer suspends when full, giving genuine back-pressure
// repos/effect/packages/effect/src/Queue.ts — Queue.bounded
const queue = yield* Queue.bounded<UserEvent>(64)
```

An unbounded queue never blocks the producer. If the consumer is slow, items accumulate until the process is OOM-killed. Always choose a capacity that reflects your acceptable latency budget.

**Anti-pattern 2 — `setInterval` polling instead of `Stream.fromSchedule`.**

```ts
// WRONG: no cancellation, no typed errors, no back-pressure, no Effect integration
setInterval(async () => {
  const data = await fetchData()
  processData(data) // errors swallowed if processData throws
}, 5000)
```

```ts
// CORRECT: repos/effect/packages/effect/src/Stream.ts:2208-2232
import { Effect, Schedule, Stream } from "effect"

const poll = Stream.fromSchedule(Schedule.spaced("5 seconds")).pipe(
  Stream.mapEffect(() => Effect.tryPromise({ try: fetchData, catch: (e) => new FetchError(e) })),
  Stream.runForEach(processData)
)
// Cancellable, typed errors, integrates with Scope for clean shutdown.
```

**Anti-pattern 3 — Running a stream outside of Effect.**

```ts
// WRONG: creates an eager computation that bypasses Effect's resource management
const result = Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runCollect
)
// result is an Effect<Chunk<number>, never, never> — it is NOT yet running.
// Calling it as a function or awaiting it directly is a type error.
```

```ts
// CORRECT: pass the Effect to a runner
import { Effect, Stream } from "effect"

const result = await Effect.runPromise(
  Stream.fromIterable([1, 2, 3]).pipe(Stream.runCollect)
)
```

A `Stream` and its terminal runner return an `Effect` — a description, not an execution. The description only runs when passed to `Effect.runPromise`, `Effect.runSync`, or `Effect.runFork`.

**Anti-pattern 4 — Unbounded `groupBy` without `GroupBy.first`.**

```ts
// WRONG: if userId is unique per request, this spawns one fiber per user — unbounded
Stream.fromPubSub(hub).pipe(
  Stream.groupByKey((e) => e.userId),
  GroupBy.evaluate((userId, s) => s.pipe(Stream.mapEffect(enrich)))
)
```

```ts
// CORRECT: cap the number of active groups
// repos/effect/packages/effect/src/GroupBy.ts:90-93
Stream.fromPubSub(hub).pipe(
  Stream.groupByKey((e) => e.userId),
  GroupBy.first(500), // at most 500 concurrent group fibers
  GroupBy.evaluate((userId, s) => s.pipe(Stream.mapEffect(enrich)))
)
```

Every distinct key spawns a fiber with an associated internal queue. With an unbounded key space you get unbounded fibers. Always bound the key space or drop groups explicitly with `GroupBy.filter`.

---

## See also

- [Chapter 16 — Stream: pull-based async iteration](../part-1-foundations/16-stream.md) — the prerequisite chapter. Covers `Stream.make`, `fromIterable`, `fromEffect`, `asyncPush`, `map`, `filter`, `flatMap`, `runCollect`, `runFold`, `runForEach`. This chapter builds directly on those foundations.
- [Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends](36-concurrency-primitives.md) — `Queue.bounded`, `PubSub.bounded`, and `Deferred` are the back-pressure building blocks used throughout this chapter's production example.
- [Chapter 37 — FiberRef, Semaphore, and advanced concurrency patterns](37-fiber-ref-and-semaphore.md) — `Effect.makeSemaphore` and `sem.withPermits` are the rate-limiting tools used in the production example's `groupBy` pipeline.
- [Patterns catalog — `Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](../../research/02-patterns-catalog.md#streamfrompubsub--fromqueue--fromschedule--groupby) — signatures, source citations, when-to-use, and anti-pattern replacements for all four source constructors.
- [Patterns catalog — Channel — bidirectional stream primitive (Stream's underlying type)](../../research/02-patterns-catalog.md#channel--bidirectional-stream-primitive-streams-underlying-type) — the `Channel` type, when to reach for it, and its relationship to `Stream` and `Sink`.
- [Patterns catalog — Sink — Stream consumer / aggregator](../../research/02-patterns-catalog.md#sink--stream-consumer--aggregator) — the `Sink` interface, `drain`, `fold`, `fromEffect`, and composition guidance.
- Part III (worked examples) — shows a full event-processing service that combines `Stream.fromPubSub`, `groupBy`, `mapEffect`, and `Sink.forEach` in a tested, production-shaped context. Forward reference: consult that section once you have worked through the core deep-dive chapters.
- Per-package note: `research/packages/effect.md` (Streaming section) — lists all `Stream`/`Channel`/`Sink`/`GroupBy` modules and their source files in the pinned tree at `39c934c1`.
