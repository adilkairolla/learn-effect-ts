# Chapter 16 — Stream: pull-based async iteration

> **Patterns introduced:** [`Stream.make` / `fromIterable` / `fromEffect`](../../research/02-patterns-catalog.md#streammake--fromiterable--fromeffect), [`Stream.async*` family (`asyncPush`, `fromAsyncIterable`)](../../research/02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable), [`Stream.paginate`](../../research/02-patterns-catalog.md#streampaginate)
> **Reads from:** [Chapter 05 — Effect.gen](05-effect-gen.md), [Chapter 09 — Layer](09-layer.md)
> **Reads into:** [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md), Part II Chapter 41 (Stream deep-dive — Channel, Sink, GroupBy)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Async iteration in JavaScript is fragmented across several incompatible models.

**`for await...of` and `AsyncIterator`.** The language now has built-in `AsyncIterable`, and generator functions can `yield` values asynchronously. For simple cases this works fine. But `AsyncIterator` has no typed error channel — errors are thrown, which means they propagate through `try/catch` and are not part of any type signature. There is no built-in finalizer protocol: if you break out of a `for await` loop early, resources the iterator holds may not be released. Two `AsyncIterables` cannot be easily composed with backpressure between them; you must wire the plumbing yourself.

**Node.js `Readable`/`Writable` streams.** These support backpressure via `highWaterMark` and `pipe`, which handles `drain` events automatically. But the API is event-driven and baroque: errors arrive on `'error'` events, completion on `'end'` events, and cleanup requires careful teardown order. Composing two `Readable` streams into a single pipeline that also handles typed domain errors requires several non-obvious steps.

**Reactive libraries (RxJS, callbags, most.js).** These solve composition elegantly, but they bring their own ecosystems, error models, and operator vocabularies. Wiring an RxJS `Observable` into an Effect-based service layer is friction-heavy — you must bridge two error-handling worlds and two resource-lifecycle models.

None of these options:
- Thread typed errors through every transformation operator
- Carry service dependencies (the `R` parameter) through the pipeline
- Integrate with `Scope` for declarative resource cleanup
- Interoperate naturally with `Effect.gen`, Layers, or the rest of the Effect ecosystem

Effect's answer is `Stream<A, E, R>`.

A `Stream<A, E, R>` is a typed pull-based async iterable that emits zero or more values of type `A`, may fail with a typed error `E`, and requires services `R` from the environment — the same three-parameter shape as `Effect<A, E, R>`, but with `A` as the **element type** rather than a single return value. Every operator on a `Stream` propagates `E` and `R` exactly as Effect operators do. Resource cleanup ties to `Scope` without any manual event listener wiring. Backpressure is handled internally by the runtime. And because a `Stream` is just a description — not an active computation — it composes freely before any execution happens.

The lower-level primitives `Channel` and `Sink`, which underpin `Stream`'s implementation, are deferred to Part II Chapter 41. This chapter focuses entirely on the high-level `Stream` API.

---

## The minimal example

```ts
import { Effect, Stream } from "effect"

const numbers = Stream.fromIterable([1, 2, 3, 4, 5])
//    numbers : Stream<number, never, never>

const program = numbers.pipe(
  Stream.map((n) => n * 2),
  Stream.filter((n) => n % 4 === 0),
  Stream.runCollect,  // collect all remaining elements into a Chunk
)
//   program : Effect<Chunk<number>, never, never>

Effect.runPromise(program).then((chunk) => {
  console.log([...chunk])  // [4, 8]
})
```

`Stream.fromIterable` wraps an in-memory iterable as a `Stream`. `Stream.map` and `Stream.filter` are lazy — they describe transformations without executing them. `Stream.runCollect` is a *runner*: it converts the `Stream` into an `Effect` that, when executed, drives the pipeline and collects all emitted elements into a `Chunk`. Nothing runs until `Effect.runPromise`.

---

## How it works

### Part A — Constructors: building a stream from data you already have

**`Stream.make`** is a variadic constructor for small finite streams.

`repos/effect/packages/effect/src/Stream.ts:2684-2700`:

```ts
export const make: <As extends Array<any>>(...as: As) => Stream<As[number]>
```

```ts
import { Stream, Effect } from "effect"

const s = Stream.make(1, 2, 3)
// Stream<number, never, never>

Effect.runPromise(Stream.runCollect(s)).then((c) => console.log([...c]))
// [1, 2, 3]
```

**`Stream.fromIterable`** wraps any `Iterable<A>` — arrays, `Set`, `Map` values, custom iterators.

`repos/effect/packages/effect/src/Stream.ts:2068-2086`:

```ts
export const fromIterable: <A>(iterable: Iterable<A>) => Stream<A>
```

The resulting stream has `E = never` and `R = never` because the source is pure in-memory data — no effects, no dependencies.

**`Stream.fromEffect`** turns a single-valued `Effect<A, E, R>` into a one-element stream.

`repos/effect/packages/effect/src/Stream.ts:2002-2019`:

```ts
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Stream<A, E, R>
```

This is useful when one stage of a streaming pipeline is a single database query whose result then feeds into downstream operators. Note that the `E` and `R` of the source `Effect` flow directly into the resulting `Stream`'s type parameters.

All three constructors mirror the `Effect<A, E, R>` parameter shape, but `A` is the *element type*, not a final return value. A `Stream<number>` emits multiple `number`s; an `Effect<number>` produces exactly one.

### Part B — Async sources: bridging push-based and callback-based APIs

These constructors answer the question: "I have a callback API — how do I get a `Stream` out of it?"

**`Stream.asyncPush`** is the primary bridge for event-driven sources.

`repos/effect/packages/effect/src/Stream.ts:381-421`:

```ts
export const asyncPush: <A, E = never, R = never>(
  register: (emit: Emit.EmitOpsPush<E, A>) => Effect.Effect<unknown, E, R | Scope.Scope>,
  options?: { readonly bufferSize: "unbounded" } | {
    readonly bufferSize?: number | undefined
    readonly strategy?: "dropping" | "sliding" | undefined
  } | undefined
) => Stream<A, E, Exclude<R, Scope.Scope>>
```

The `register` callback receives an `emit` handle and returns an `Effect` that runs for the stream's lifetime. Calling `emit.single(value)` pushes one element; `emit.end()` terminates the stream normally; `emit.fail(error)` terminates with a typed error. The `bufferSize` and `strategy` options control backpressure: `"dropping"` discards new values when the buffer is full, `"sliding"` evicts the oldest. The stream ends and cleanup runs when the `register` Effect finalizes — no manual listener teardown needed.

Here is how `@effect/sql-pg` uses `asyncPush` to turn PostgreSQL's `LISTEN` notification callbacks into a typed stream (`repos/effect/packages/sql-pg/src/PgClient.ts:362-380`):

```ts
import { Effect, Stream } from "effect"
import { SqlError } from "@effect/sql"

// Simplified version of the actual pg LISTEN implementation
const listenChannel = (channelName: string) =>
  Stream.asyncPush<string, SqlError>(
    Effect.fnUntraced(function* (emit) {
      // acquire the client and register the notification handler
      yield* Effect.addFinalizer(() =>
        // cleanup runs when the stream is interrupted or ends
        Effect.promise(() => client.query(`UNLISTEN ${channelName}`))
      )
      yield* Effect.tryPromise({
        try: () => client.query(`LISTEN ${channelName}`),
        catch: (cause) => new SqlError({ cause, message: "Failed to listen" }),
      })
      client.on("notification", (msg) => {
        if (msg.channel === channelName && msg.payload) {
          emit.single(msg.payload)
        }
      })
    })
  )
```

**`Stream.fromAsyncIterable`** wraps a standard JavaScript `AsyncIterable` — Node.js `Readable` streams exposed as async iterators, Web streams via `Symbol.asyncIterator`, or async generator functions.

`repos/effect/packages/effect/src/Stream.ts:1879-1904`:

```ts
export const fromAsyncIterable: <A, E>(
  iterable: AsyncIterable<A>,
  onError: (e: unknown) => E
) => Stream<A, E>
```

The `onError` function maps thrown errors into the typed `E` channel. The stream respects interruption — if the consumer is interrupted, the iterator's `return()` method is called to trigger cleanup.

**`Stream.fromReadableStream`** adapts a Web Platform `ReadableStream`.

`repos/effect/packages/effect/src/Stream.ts:2164-2181`:

```ts
export const fromReadableStream: {
  <A, E>(options: {
    readonly evaluate: LazyArg<ReadableStream<A>>
    readonly onError: (error: unknown) => E
    readonly releaseLockOnEnd?: boolean | undefined
  }): Stream<A, E>
  <A, E>(evaluate: LazyArg<ReadableStream<A>>, onError: (error: unknown) => E): Stream<A, E>
}
```

The `evaluate` thunk is called lazily when the stream is consumed, not when it is constructed — consistent with Effect's deferred-execution model.

### Part C — Pagination: cursor-based APIs

**`Stream.paginate`** unfolds a paginated API into a stream.

`repos/effect/packages/effect/src/Stream.ts:3359-3380`:

```ts
export const paginate: <S, A>(
  s: S,
  f: (s: S) => readonly [A, Option.Option<S>]
) => Stream<A>
```

`S` is the cursor/state type. `f` receives the current cursor and returns a tuple `[currentValue, Option<nextCursor>]`. Returning `Option.some(cursor)` continues; returning `Option.none()` terminates the stream. Because the unfolding is lazy, pagination stops as soon as the consumer stops pulling — useful with `Stream.take(100)` to fetch only the first page without loading the entire dataset.

**`Stream.paginateChunk`** (`repos/effect/packages/effect/src/Stream.ts:3390-3393`) is the batch variant: `f` returns `[Chunk<A>, Option<S>]`, emitting a whole page of elements at once. This is more efficient for APIs that return arrays per page.

For async pagination — where each page fetch is an Effect — use `Stream.paginateEffect` (`repos/effect/packages/effect/src/Stream.ts:3416-3419`), which has the same shape but `f` returns `Effect.Effect<readonly [A, Option<S>], E, R>`.

### Part D — Transformers and runners

Transformers produce a new `Stream` from an existing one. Runners terminate the pipeline and produce an `Effect`.

**Key transformers:**

- `Stream.map(f)` — `repos/effect/packages/effect/src/Stream.ts:2702-2721`: applies a pure function to every element.
- `Stream.filter(predicate)` — `repos/effect/packages/effect/src/Stream.ts:1607-1628`: keeps only elements that satisfy the predicate. TypeScript's refinement types are supported: `Stream.filter((x): x is B => ...)` narrows the stream's element type.
- `Stream.flatMap(f)` — `repos/effect/packages/effect/src/Stream.ts:1764-1789`: maps each element to a new `Stream` and concatenates all resulting streams. The `concurrency` option allows parallel execution of the inner streams.
- `Stream.take(n)` — `repos/effect/packages/effect/src/Stream.ts:4788-4807`: emits at most `n` elements, then terminates. Composing `take` with `paginate` allows early termination of an otherwise infinite pagination loop.
- `Stream.takeUntil(predicate)` — `repos/effect/packages/effect/src/Stream.ts:4830-4850`: emits elements until the predicate returns `true`, then terminates (including the element that triggered the predicate).
- `Stream.tap(f)` — `repos/effect/packages/effect/src/Stream.ts:4893-4924`: runs an effectful function on each element for side effects (logging, metrics) and passes the element through unchanged.

**Key runners** (all produce an `Effect`):

- `Stream.runCollect` — `repos/effect/packages/effect/src/Stream.ts:4123-4129`: collects all elements into a `Chunk<A>`. Only appropriate for bounded streams.
- `Stream.runForEach(f)` — `repos/effect/packages/effect/src/Stream.ts:4285-4300`: calls the effectful function `f` on each element; returns `Effect<void>`. The right choice when you want to process each element without accumulating them.
- `Stream.runDrain` — `repos/effect/packages/effect/src/Stream.ts:4139-4145`: consumes the stream solely for its side effects and discards all emitted values.
- `Stream.repeatEffect(eff)` — `repos/effect/packages/effect/src/Stream.ts:3887-3904`: turns a repeatedly-evaluating Effect into an infinite stream; typically paired with `Stream.take(n)` or `Stream.takeUntil`.

The separation between transformers and runners is the same insight as Chapter 03 (running Effects): a `Stream` is a description, not an active computation. Running is a separate phase that happens exactly once.

---

## A production example

The following example paginates a hypothetical cursor-based HTTP API — the shape used by GitHub's REST API, DynamoDB's `scan`, and many others — filtering and transforming the results before collecting them.

```ts
import { Effect, Option, Stream, Chunk, Data } from "effect"

// ---- domain types ----------------------------------------------------------

interface ApiItem {
  readonly id: string
  readonly name: string
  readonly active: boolean
}

interface ApiPage {
  readonly items: ReadonlyArray<ApiItem>
  readonly nextCursor: string | null
}

class FetchError extends Data.TaggedError("FetchError")<{
  readonly url: string
  readonly cause: unknown
}> {}

// ---- cursor type -----------------------------------------------------------

// The cursor state: null means "fetch the first page"
type Cursor = string | null

// ---- paginated stream -------------------------------------------------------

const fetchPage = (cursor: Cursor): Effect.Effect<ApiPage, FetchError> =>
  Effect.tryPromise({
    try: async () => {
      const url = cursor
        ? `https://api.example.com/items?cursor=${cursor}`
        : `https://api.example.com/items`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json() as Promise<ApiPage>
    },
    catch: (cause) => new FetchError({ url: "https://api.example.com/items", cause }),
  })

// Stream.paginateEffect: each "page" is fetched by an Effect; the step
// function returns [currentPageItems, Option<nextCursor>].
// The stream emits each *individual item* after flatMapping over the pages.
const allActiveNames: Stream.Stream<string, FetchError> = Stream.paginateEffect(
  null as Cursor,
  (cursor) =>
    Effect.map(fetchPage(cursor), (page) => {
      const nextCursor = page.nextCursor !== null
        ? Option.some(page.nextCursor as Cursor)
        : Option.none<Cursor>()
      return [page.items, nextCursor] as const
    })
).pipe(
  // paginateEffect emits one array per page; flatMap flattens each array into
  // individual items using Stream.fromIterable.
  Stream.flatMap((items) => Stream.fromIterable(items)),
  // Only active items
  Stream.filter((item) => item.active),
  // Project to just the name
  Stream.map((item) => item.name),
)

// Run: collect the first 50 active names.  Stream.take(50) ensures we stop
// pagination as soon as we have enough data — no unnecessary page fetches.
const program: Effect.Effect<Chunk.Chunk<string>, FetchError> = allActiveNames.pipe(
  Stream.take(50),
  Stream.runCollect,
)

Effect.runPromise(program).then((names) => {
  console.log(`Fetched ${names.length} active items:`, [...names].slice(0, 5))
})
```

A few design points worth noting. `Stream.paginateEffect` (rather than the pure `Stream.paginate`) is used because each page fetch is an async HTTP call. The step function returns `[page.items, nextCursor]` — an array and an `Option<Cursor>`. `Stream.flatMap` then explodes each array into individual elements via `Stream.fromIterable`. The `Stream.take(50)` before `runCollect` is critical: it terminates the stream after fifty elements, so subsequent page fetches are never issued. Without `take`, the entire dataset would be fetched before any result is returned.

---

## Variations

**`Stream.make(1, 2, 3)`** — literal finite stream from varargs.

```ts
import { Effect, Stream } from "effect"
const s = Stream.make("a", "b", "c")
Effect.runPromise(Stream.runCollect(s)).then(console.log)
```

**`Stream.fromIterable(arr)`** — adapt any `Iterable` to a `Stream`.

```ts
import { Effect, Stream } from "effect"
const s = Stream.fromIterable(new Set([1, 2, 3]))
Effect.runPromise(Stream.runCollect(s)).then(console.log)
```

**`Stream.fromEffect(eff)`** — single-element stream from an `Effect`.

```ts
import { Effect, Stream } from "effect"
declare const fetchConfig: Effect.Effect<{ maxRetries: number }>
const s = Stream.fromEffect(fetchConfig)
// Stream<{ maxRetries: number }, never, never>
```

**`Stream.asyncPush((emit) => ...)`** — callback-based emitter with backpressure.

```ts
import { Effect, Stream } from "effect"
const ticks = Stream.asyncPush<number>((emit) =>
  Effect.acquireRelease(
    Effect.sync(() => setInterval(() => emit.single(Date.now()), 500)),
    (handle) => Effect.sync(() => clearInterval(handle))
  )
)
```

**`Stream.fromAsyncIterable(iter, onErr)`** — adapt an `AsyncIterable` such as a Node.js readable or an async generator.

```ts
import { Stream } from "effect"
async function* countdown(n: number) {
  for (let i = n; i >= 0; i--) yield i
}
const s = Stream.fromAsyncIterable(countdown(10), (e) => new Error(String(e)))
```

**`Stream.paginate(initial, step)`** — cursor-based lazy pagination over a pure step function.

```ts
import { Option, Stream } from "effect"
const pageNumbers = Stream.paginate(1, (page) =>
  [page, page < 10 ? Option.some(page + 1) : Option.none()] as const
)
// Emits 1, 2, 3, ..., 10
```

**`Stream.repeatEffect(eff)`** — turns a repeatedly-evaluated Effect into an infinite stream.

```ts
import { Effect, Stream, Random } from "effect"
const randoms = Stream.repeatEffect(Random.nextInt).pipe(Stream.take(5))
Effect.runPromise(Stream.runCollect(randoms)).then(console.log)
```

---

## Anti-patterns

### Collecting unbounded or large streams into memory with `runCollect`

`Stream.runCollect` materializes every element into a `Chunk` before returning. For a paginated API with millions of rows, or an infinite stream, this causes out-of-memory errors.

```ts
import { Effect, Stream } from "effect"

// Wrong: runCollect on an infinite (or very large) stream.
const bad = Stream.repeatEffect(Effect.succeed(1)).pipe(
  Stream.runCollect  // never finishes; consumes unbounded memory
)

// Right: bound the stream first, or process elements without accumulating.
const good1 = Stream.repeatEffect(Effect.succeed(1)).pipe(
  Stream.take(1000),
  Stream.runCollect  // collects exactly 1000 elements
)

const good2 = Stream.repeatEffect(Effect.succeed(1)).pipe(
  Stream.take(1000),
  Stream.runForEach((n) => Effect.log(`value: ${n}`))  // processes without accumulating
)
```

### Using `Stream.async` (or `asyncPush`) when the source is already an `AsyncIterable`

If your source exposes an async iterator — a Node.js `Readable` accessed via `Symbol.asyncIterator`, a web stream reader, or an async generator — `Stream.fromAsyncIterable` handles the conversion correctly, including cleanup via the iterator's `return()` protocol. Writing manual `asyncPush` emission over an `AsyncIterable` duplicates that protocol and risks missing cleanup on interruption.

```ts
import { Effect, Stream } from "effect"

// Wrong: manually emitting from an AsyncIterable using asyncPush.
async function* nums() { yield 1; yield 2; yield 3 }
const bad = Stream.asyncPush<number>((emit) =>
  Effect.promise(async () => {
    for await (const n of nums()) emit.single(n)  // misses interruption cleanup
    emit.end()
  })
)

// Right: fromAsyncIterable handles iteration, errors, and cleanup.
const good = Stream.fromAsyncIterable(nums(), (e) => new Error(String(e)))
```

### Reaching for an `Array` when the source is unbounded or large

If you are processing a large paginated API or an infinite event stream, collecting everything into an array first defeats the purpose of streaming: the entire dataset must be in memory simultaneously, and early termination is impossible.

```ts
import { Effect, Stream, Option } from "effect"

// Wrong: collect all pages into an array, then process.
// async function fetchAllPages(): Promise<Item[]> { /* accumulates everything */ }

// Right: Stream.paginate + Stream.take lets you stop early and processes
// items lazily without holding the full dataset in memory.
const firstHundred = Stream.paginate(
  null as string | null,
  (cursor) => [cursor, cursor ? Option.some(cursor) : Option.none<string | null>()] as const
).pipe(
  Stream.take(100),
  Stream.runCollect
)
```

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the `Effect<A, E, R>` type whose parameter shape `Stream` mirrors
- [Chapter 05 — Effect.gen](05-effect-gen.md) — generator composition; use inside `Stream.asyncPush` register functions and `tap` callbacks
- [Chapter 09 — Layer](09-layer.md) — wiring service dependencies that appear in a stream's `R` parameter
- [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md) — resource-bound streams; `Stream.asyncPush`'s register Effect runs inside a `Scope`
- [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md) — forking stream consumption; `Stream.flatMap` concurrency options
- [Part II Chapter 41 — Stream deep-dive](../part-2-tour/41-stream-deep-dive.md) — `Channel`, `Sink`, `GroupBy`, and back-pressure internals
- [Patterns Catalog: Stream.make / fromIterable / fromEffect](../../research/02-patterns-catalog.md#streammake--fromiterable--fromeffect)
- [Patterns Catalog: Stream.async* family](../../research/02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable)
- [Patterns Catalog: Stream.paginate](../../research/02-patterns-catalog.md#streampaginate)
- [Per-package note: effect](../../research/packages/effect.md)
