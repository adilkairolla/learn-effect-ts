# Effect TS Patterns Catalog

> Source: `repos/effect/` pinned at `39c934c1476be389f7469433910fdf30fc4dad82` (see `book/00-toc.md`).
> Every pattern entry below cites a file path inside `repos/`. If a pattern has no citation, it is not yet verified — see the "Unverified" list at the bottom.

## How patterns are documented

Each pattern follows this fixed schema:

- **Name** — short canonical name
- **Signature** — TypeScript shape
- **Where it appears** — `repos/<path>:<line-range>`, with at least one cite
- **When to use / when not to**
- **Anti-pattern it replaces**
- **Related patterns** — links to other entries by name

## Index

- [Constructors](#constructors)
- [Effects](#effects)
- [Layers & Context](#layers--context)
- [Errors & Cause](#errors--cause)
- [Option & Either](#option--either)
- [Schema](#schema)
- [Streams & Concurrency](#streams--concurrency)
- [Resources & Scope](#resources--scope)
- [API style (pipeable, dual)](#api-style-pipeable-dual)
- [Data, Equal, Hash, Brand](#data-equal-hash-brand)
- [Module / file conventions](#module--file-conventions)
- [Concurrency primitives](#concurrency-primitives)
- [Observability](#observability)
- [State management](#state-management)
- [Time & Scheduling](#time--scheduling)
- [Pattern matching](#pattern-matching)
- [Configuration](#configuration)
- [Request batching & Caching](#request-batching--caching)
- [Immutable Collections](#immutable-collections)

## Constructors

### `.make` / `.of` constructors

### `.from*` family

## Effects

### `Effect.gen` + `yield*`

### `Effect.fn` (named effect functions with auto-tracing)

### `Effect.succeed` / `fail` / `sync` / `promise` / `tryPromise`

### `Effect.runPromise` / `runSync` / `runFork`

### `Effect.all` / `Effect.repeat` / `Effect.retry` — combinators

## Layers & Context

### `Layer.succeed` / `effect` / `scoped` — Layer constructors

### `Layer.merge` / `provide` / `fresh` — Layer composition

### `Context.GenericTag` / `Tag` class / `Reference` — tag variants

### `Effect.Service` class

### `ManagedRuntime.make`

### Runtime — pre-built runtime for executing Effects

### RuntimeFlags — concurrency, tracing, interruption controls

### LayerMap — keyed map of layers (per-tenant / per-request)

### Reloadable — hot-reload a service layer at runtime

## Errors & Cause

### `Data.TaggedError`

### `Cause` — `fail` / `die` / `interrupt` variants

### `Effect.catchTag` / `catchTags` / `sandbox` — error handling

### Exit — Effect outcome value (Success / Failure of Cause)

## Option & Either

### Option — Some / None and combinators

### Either — Left / Right and combinators

### Bridging Option/Either ↔ Effect (fromOption, fromEither, getOrFail)

## Schema

### `Schema.Struct`

### `Schema.Class` and `Schema.TaggedClass`

### `Schema.brand` / `filter` — constraints

### `Schema.transform` / `transformOrFail`

### `Schema.decode` / `encode` / `is` entry points

## Streams & Concurrency

### `Stream.make` / `fromIterable` / `fromEffect`

### `Stream.async*` family (`asyncPush`, `fromAsyncIterable`)

### `Stream.paginate`

### `Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`

### `Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`

### Fiber — joining, interrupting, racing (Effect.fork return type)

### FiberId — fiber identity and lineage

### Supervisor — observe and react to fiber lifecycle

### Structured concurrency via `Scope`

### Channel — bidirectional stream primitive (Stream's underlying type)

### Sink — Stream consumer / aggregator

## Resources & Scope

### `Effect.acquireRelease` / `acquireUseRelease`

### `Layer.scoped` (resource layers)

### `Scope.make` / `Scope.fork` / `Scope.close`

### `RcRef` and `RcMap` — reference-counted resources

### `Pool.make` / `Pool.makeWithTTL` and `KeyedPool`

### ScopedRef — scope-attached mutable reference

## API style (pipeable, dual)

### Dual data-first / data-last (`dual(...)`) and Pipeable trait

### `pipe` vs method chaining

## Data, Equal, Hash, Brand

### `Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`

### `Data.TaggedEnum` — discriminated union constructors

### `Brand.nominal` / `refined` / `all`

### `Equal.equals` interface and `Hash` — structural equality

## Module / file conventions

### The `internal/` folder and `index.ts` re-export shape

### Dual ESM/CJS export pattern

### `JSDoc` `@since`, `@category`, `@example` tags

## Concurrency primitives

### `Ref` — atomic mutable cell

### `SubscriptionRef` — observable Ref

### `Queue` — unbounded / bounded / sliding / dropping

### `PubSub` — multi-subscriber broadcast

### `FiberRef` — fiber-local state

### `Semaphore` — async resource limiting

### `Deferred` — one-shot async value

### `Mailbox` — ordered message inbox

### `FiberSet` / `FiberMap` / `FiberHandle` — fiber lifecycle tracking

### SynchronizedRef — atomic effectful update

### RateLimiter — token-bucket rate limiting

## Observability

### `Logger.make` / `withMinimumLogLevel` and `Effect.log*` family

### `Metric.counter` / `gauge` / `histogram` / `summary`

### `Effect.withSpan` / `annotateCurrentSpan` — distributed tracing

## State management

### `STM.gen` / `STM.atomically` — software transactional memory

### `TRef` / `TQueue` / `TMap` / `TSemaphore` — STM-aware variants

## Time & Scheduling

### `Schedule.spaced` / `exponential` / `fixed` / `recurs`

### `Schedule.jittered` / `compose` — combinators

### `Cron.parse` / `make` and `DateTime.now` / `make` / `format`

### Random — testable seed-based RNG service

## Pattern matching

### `Match.value` / `Match.type` — starting a match

### `Match.when` / `not` / `exhaustive` — clauses and finalizers

## Configuration

### `Config.string` / `integer` / `boolean` / `nested` / `all`

### `ConfigProvider.fromEnv` / `fromMap` / `fromJson`

### Redacted — prevent secret values from leaking to logs/spans

### Secret — memory-safe secret string

### Encoding — Base64 / hex / UTF-8 codecs

## Request batching & Caching

### `Request.of` / `RequestResolver.make` / `Effect.request` — request batching

### `Cache.make` / `ScopedCache.make` — effect-based memoization

## Immutable Collections

### Chunk — typed array container (Stream's element type)

### HashMap — structural-equality keyed map

### HashSet — structural-equality set

### List — persistent linked list

### SortedMap / SortedSet (with Order)

### RedBlackTree

### Trie

## Unverified (not yet cited)

(Tasks 8 and 9 will move any pattern without verified citations down here.)
