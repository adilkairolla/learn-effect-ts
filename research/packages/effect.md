# effect

> Source: `repos/effect/packages/effect/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: core
> Effect deps: (none — this IS the foundation)

## What it does

The `effect` package is the entire Effect runtime for TypeScript: it defines the `Effect<A, E, R>` type and every primitive needed to compose, run, and test effectful programs. Every other package in the monorepo lists `effect` as a peer dependency — without this package, nothing else works. Application authors consume it directly for business logic; library authors extend it via the `internal/` patterns it establishes. Without `effect`, you would hand-write `async/await` functions that have no typed error channel, no composable dependency injection, and no cooperative fiber concurrency.

The package bundles far more than a single monad: it ships `Schema` (a full encode/decode/validate library), `Stream`/`Channel`/`Sink` (composable streaming), `STM` (software transactional memory), `Schedule` (declarative retry and repeat), `Layer`/`Context` (DI), and a complete collection library (`Array`, `Chunk`, `HashMap`, `HashSet`, `List`, `RedBlackTree`, `Trie`, etc.) — all in a single npm package with one import entry point.

See the inventory row for the one-line summary: [`research/01-package-inventory.md`](../01-package-inventory.md) lists `effect` as "The Effect runtime: the `Effect` type, `Layer`, `Context`, `Schema`, `Stream`, `Fiber`, `STM`, `Queue`, `Schedule`, `Config`, and the full standard library for TypeScript."

## Public API surface

The public surface is exposed through `repos/effect/packages/effect/src/index.ts` using the namespace-re-export pattern. Every module is a named namespace; six utility functions (`pipe`, `flow`, `identity`, `absurd`, `hole`, `unsafeCoerce`) are additionally lifted flat. There are ~100 public modules grouped conceptually below.

**Core effect type and runners**

- `Effect` (`src/Effect.ts`) — the primary export. ~14,000+ lines. The `Effect<A, E, R>` interface, all constructors (`succeed`, `fail`, `sync`, `promise`, `tryPromise`, `gen`), combinators (`map`, `flatMap`, `tap`, `catchTag`, `retry`, `repeat`, `fork`, `all`), concurrency tools (`Semaphore`, `Latch`, `makeSemaphore`), and runtime runners (`runPromise`, `runSync`, `runFork`). Also hosts `Effect.Service` (the DI class macro) and `Effect.fn` (auto-traced named functions).
- `Fiber` (`src/Fiber.ts`), `FiberId` (`src/FiberId.ts`), `FiberRef` (`src/FiberRef.ts`), `FiberRefs` (`src/FiberRefs.ts`), `FiberStatus` (`src/FiberStatus.ts`), `FiberSet` (`src/FiberSet.ts`), `FiberMap` (`src/FiberMap.ts`), `FiberHandle` (`src/FiberHandle.ts`) — the cooperative fiber concurrency model.
- `Runtime` (`src/Runtime.ts`), `RuntimeFlags` (`src/RuntimeFlags.ts`), `Scheduler` (`src/Scheduler.ts`), `ManagedRuntime` (`src/ManagedRuntime.ts`) — runtime execution environment.
- `Exit` (`src/Exit.ts`), `Cause` (`src/Cause.ts`) — the lossless error model. `Cause<E>` captures `Fail`, `Die`, `Interrupt`, `Parallel`, and `Sequential` variants; see `repos/effect/packages/effect/src/Cause.ts:1-22` for the module-level docstring establishing the "lossless failure" philosophy.

**Dependency injection trio**

- `Context` (`src/Context.ts`) — the type-safe service map. `Tag<Id, Value>` is a unique token; `Context<R>` is an immutable map from tags to services. `Tag` itself extends `Effect<Value, never, Id>` so tags are directly yieldable — `repos/effect/packages/effect/src/Context.ts:57-67`.
- `Layer` (`src/Layer.ts`) — recipes for building service graphs. `Layer<ROut, E, RIn>` describes how to produce services `ROut` from requirements `RIn`, possibly failing with `E`. Layers are memoized by default; `repos/effect/packages/effect/src/Layer.ts:1-18` has the module-level summary.
- `Scope` (`src/Scope.ts`), `Ref` (`src/Ref.ts`), `ScopedRef` (`src/ScopedRef.ts`), `ScopedCache` (`src/ScopedCache.ts`) — resource lifecycle and scope-based cleanup.

**Schema (validation / serialization)**

- `Schema` (`src/Schema.ts`) — the core schema library, ~8,800+ lines. Structural schemas (`Struct`, `Array`, `Union`, `Tuple`), class-based schemas (`Class`, `TaggedClass`), transforms (`transform`, `transformOrFail`), filters (`filter`, `brand`), and decode/encode entry points. Introduced at `@since 3.10.0` (before that, Schema lived in a separate `@effect/schema` package).
- `SchemaAST` (`src/SchemaAST.ts`) — the schema abstract syntax tree; usually not consumed directly.
- `ParseResult` (`src/ParseResult.ts`), `Pretty` (`src/Pretty.ts`), `Arbitrary` (`src/Arbitrary.ts`), `JSONSchema` (`src/JSONSchema.ts`) — derived schema capabilities.

**Streaming**

- `Stream` (`src/Stream.ts`) — pull-based lazy stream of `A` values. One-way data pipelines: sources (`make`, `fromIterable`, `fromEffect`, `asyncPush`, `paginate`, `fromQueue`, `fromPubSub`, `fromSchedule`), transformers (`map`, `flatMap`, `tap`, `groupBy`, `throttle`), sinks (`runCollect`, `runFold`, `run`).
- `Channel` (`src/Channel.ts`) — the bidirectional typed pipe that `Stream` and `Sink` are compiled to. Seven type parameters. Rarely used directly by application code.
- `Sink` (`src/Sink.ts`) — stream consumers and aggregators.
- `GroupBy` (`src/GroupBy.ts`), `Streamable` (`src/Streamable.ts`), `StreamEmit` (`src/StreamEmit.ts`), `Take` (`src/Take.ts`), `Mailbox` (`src/Mailbox.ts`) — stream supporting types.

**Software Transactional Memory (STM)**

- `STM` (`src/STM.ts`) — composable atomic transactions. `STM<A, E, R>` is a description of transactional work; `STM.commit` runs it atomically with retry-on-conflict semantics. Inspired by Haskell's `Control.Concurrent.STM`; see module docstring at `repos/effect/packages/effect/src/STM.ts:1-59`.
- `TRef` (`src/TRef.ts`), `TArray` (`src/TArray.ts`), `TMap` (`src/TMap.ts`), `TSet` (`src/TSet.ts`), `TQueue` (`src/TQueue.ts`), `TPubSub` (`src/TPubSub.ts`), `TDeferred` (`src/TDeferred.ts`), `TSemaphore` (`src/TSemaphore.ts`), `TRandom` (`src/TRandom.ts`), `TReentrantLock` (`src/TReentrantLock.ts`), `TPriorityQueue` (`src/TPriorityQueue.ts`), `TSubscriptionRef` (`src/TSubscriptionRef.ts`) — transactional equivalents of all fiber-level concurrency primitives.

**Scheduling and retry**

- `Schedule` (`src/Schedule.ts`) — composable recurring schedules. `Schedule<Out, In, R>` consumes values and produces delay decisions. Used by `Effect.retry`, `Effect.repeat`, `Stream.fromSchedule`, and `Reloadable`. See `repos/effect/packages/effect/src/Schedule.ts:47-88` for the full model description.
- `Cron` (`src/Cron.ts`) — cron expression parsing for use with `Schedule`.

**Concurrency primitives**

- `Ref` (`src/Ref.ts`) — an atomic mutable cell that itself extends `Effect<A>` (readable as an effect). See `repos/effect/packages/effect/src/Ref.ts:27-32`.
- `Queue` (`src/Queue.ts`) — bounded/unbounded/sliding/dropping async queues.
- `PubSub` (`src/PubSub.ts`) — multi-subscriber broadcast hub.
- `Deferred` (`src/Deferred.ts`) — a one-shot async value (like `Promise` but Effect-native).
- `SynchronizedRef` (`src/SynchronizedRef.ts`) — a `Ref` whose updates are sequentialized effects.
- `SubscriptionRef` (`src/SubscriptionRef.ts`) — a `Ref` you can subscribe to for changes.
- `KeyedPool` (`src/KeyedPool.ts`), `Pool` (re-exported via `Effect`) — connection pools.
- `RcRef` (`src/RcRef.ts`), `RcMap` (`src/RcMap.ts`) — reference-counted resource sharing.

**Configuration**

- `Config` (`src/Config.ts`), `ConfigError` (`src/ConfigError.ts`), `ConfigProvider` (`src/ConfigProvider.ts`), `ConfigProviderPathPatch` (`src/ConfigProviderPathPatch.ts`) — typed environment and config loading, supporting `.env` files, environment variables, and structured config trees.

**Observability**

- `Metric` (`src/Metric.ts`) + supporting files (`MetricBoundaries`, `MetricHook`, `MetricKey`, `MetricKeyType`, `MetricLabel`, `MetricPair`, `MetricPolling`, `MetricRegistry`) — built-in metrics (counters, gauges, histograms, summaries, frequencies) that integrate with `@effect/opentelemetry`.
- `Tracer` (`src/Tracer.ts`), `Logger` (`src/Logger.ts`), `LogLevel` (`src/LogLevel.ts`), `LogSpan` (`src/LogSpan.ts`) — distributed tracing and structured logging.

**Data and collections**

- `Data` (`src/Data.ts`), `Equal` (`src/Equal.ts`), `Hash` (`src/Hash.ts`) — structural equality and hashing protocol.
- `Option` (`src/Option.ts`), `Either` (`src/Either.ts`) — classic functional option/result types, both yieldable in `Effect.gen`.
- `Chunk` (`src/Chunk.ts`), `List` (`src/List.ts`), `HashMap` (`src/HashMap.ts`), `HashSet` (`src/HashSet.ts`), `SortedMap` (`src/SortedMap.ts`), `SortedSet` (`src/SortedSet.ts`), `RedBlackTree` (`src/RedBlackTree.ts`), `Trie` (`src/Trie.ts`), `Graph` (`src/Graph.ts`), `HashRing` (`src/HashRing.ts`) — persistent functional collections.
- `Array` (`src/Array.ts`), `Record` (`src/Record.ts`), `Struct` (`src/Struct.ts`), `Tuple` (`src/Tuple.ts`), `Iterable` (`src/Iterable.ts`) — utilities over standard JS types.

**Other utilities**

- `Brand` (`src/Brand.ts`), `Predicate` (`src/Predicate.ts`), `Equivalence` (`src/Equivalence.ts`), `Order` (implied by `SortedMap`), `Match` (`src/Match.ts`), `Function` (`src/Function.ts`), `Duration` (`src/Duration.ts`), `DateTime` (`src/DateTime.ts`), `BigDecimal` (`src/BigDecimal.ts`), `Encoding` (`src/Encoding.ts`), `Redacted` (`src/Redacted.ts`), `String` (`src/String.ts`), `Number` (`src/Number.ts`), `Boolean` (`src/Boolean.ts`), `RegExp` (`src/RegExp.ts`), `Symbol` (`src/Symbol.ts`) — typed functional utilities over primitives.
- `Cache` (`src/Cache.ts`), `Request` (`src/Request.ts`), `RequestResolver` (`src/RequestResolver.ts`), `RequestBlock` (`src/RequestBlock.ts`) — N+1 query solving via transparent request batching.
- `Reloadable` (`src/Reloadable.ts`), `Resource` (`src/Resource.ts`), `LayerMap` (`src/LayerMap.ts`) — advanced layer lifecycle.
- `TestClock` (`src/TestClock.ts`) + test support files — time control for deterministic testing.
- `HKT` (`src/HKT.ts`) — `TypeLambda` encoding for higher-kinded polymorphism (used by `@effect/typeclass`).
- `FastCheck` (`src/FastCheck.ts`) — re-exports `fast-check` for property-based testing; used by `Arbitrary`.
- `ExecutionPlan` (`src/ExecutionPlan.ts`) — adaptive execution strategy (e.g., run locally first, fall back to network).

## Patterns used

The `effect` package is the origin point for most patterns in the catalog. The entries below highlight which patterns it introduces or uses most pervasively.

- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — the primary composition API for all sequential business logic; implemented in `repos/effect/packages/effect/src/Effect.ts:2760-2776` using JavaScript generators and `YieldWrap`
- [Effect.succeed / fail / sync / promise / tryPromise](../02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise) — the leaf constructors; every Effect program begins here (`repos/effect/packages/effect/src/Effect.ts:3160`, `:2575`, `:3326`)
- [Effect.runPromise / runSync / runFork](../02-patterns-catalog.md#effectrunpromise--runsync--runfork) — the "end of the world" runners; type-checked to require `R = never` before execution (`repos/effect/packages/effect/src/Effect.ts:12136-12139`, `:12279`, `:12064-12067`)
- [Effect.all / Effect.repeat / Effect.retry — combinators](../02-patterns-catalog.md#effectall--effectrepeat--effectretry--combinators) — parallel and sequential combinators with `Schedule` integration (`repos/effect/packages/effect/src/Effect.ts:825-834`, `:4400-4410`, `:10178-10192`)
- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — the DI graph building blocks (`repos/effect/packages/effect/src/Layer.ts:772-775`, `:289-292`, `:727-735`)
- [Layer.merge / provide / fresh — Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — wiring service graphs together (`repos/effect/packages/effect/src/Layer.ts:567-572`, `:899-904`)
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — the identity tokens for dependency injection (`repos/effect/packages/effect/src/Context.ts:181-182`, `:582-585`)
- [Effect.Service class](../02-patterns-catalog.md#effectservice-class) — the one-declaration macro that collapses Tag + Layer + interface (`repos/effect/packages/effect/src/Effect.ts:13585-13637`)
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — discriminated error classes for the typed error channel (`repos/effect/packages/effect/src/Data.ts:580-585`)
- [Cause — fail / die / interrupt variants](../02-patterns-catalog.md#cause--fail--die--interrupt-variants) — the lossless failure tree (`repos/effect/packages/effect/src/Cause.ts:591-655`)
- [Effect.catchTag / catchTags / sandbox — error handling](../02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling) — structured error recovery (`repos/effect/packages/effect/src/Effect.ts:3882-3996`)
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — resource safety via scope registration (`repos/effect/packages/effect/src/Effect.ts:5453-5555`)
- [Structured concurrency via Scope](../02-patterns-catalog.md#structured-concurrency-via-scope) — the fundamental resource lifecycle mechanism (`repos/effect/packages/effect/src/Scope.ts:152-204`)
- [Effect.fork / forkDaemon / forkScoped / forkIn](../02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin) — structured fiber launching (`repos/effect/packages/effect/src/Effect.ts:6283-6507`)
- [dual data-first / data-last (dual and Pipeable trait)](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — every combinator in `Effect`, `Array`, `Option`, etc. uses the `dual` function from `repos/effect/packages/effect/src/Function.ts:95-139` and the `Pipeable` interface from `repos/effect/packages/effect/src/Pipeable.ts:11-60`
- [Schema.Struct](../02-patterns-catalog.md#schemastruct) — introduced in this package at `repos/effect/packages/effect/src/Schema.ts:2936-2944`
- [Schema.decode / encode / is entry points](../02-patterns-catalog.md#schemadecode--encode--is-entry-points) — validation entry points (`repos/effect/packages/effect/src/Schema.ts:534-607`)
- [Ref — atomic mutable cell](../02-patterns-catalog.md#ref--atomic-mutable-cell) — `Ref<A>` is itself an `Effect<A>` (`repos/effect/packages/effect/src/Ref.ts:27-32`)
- [STM.gen / STM.commit — Software Transactional Memory](../02-patterns-catalog.md#stmgen--stmcommit--software-transactional-memory) — composable atomic transactions (`repos/effect/packages/effect/src/STM.ts:1-59`)
- [Schedule.spaced / exponential / fixed / recurs](../02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) — declarative retry/repeat policies (`repos/effect/packages/effect/src/Schedule.ts:47-88`)

## What's unique about this package's design

The defining idea is the three-parameter type `Effect<A, E, R>` — success type, typed error type, and typed dependency requirement — combined with fiber-based cooperative concurrency. No other TypeScript library encodes both error handling and dependency injection directly in the type signature of every computation. The `R` parameter accumulates requirements as you compose effects, and providing those requirements (via `Effect.provide` or `Layer`) is checked at compile time: an unprovided service produces a type error, not a runtime crash. This is documented at `repos/effect/packages/effect/src/Effect.ts:89-115`.

The second uniqueness is the `Cause<E>` type as the backing error representation (`repos/effect/packages/effect/src/Cause.ts:1-22`). Unlike `Promise` which discards concurrent errors, `Cause` can represent parallel failures (`Cause.parallel`), sequential failures, typed user-domain errors (`Cause.fail`), unexpected defects (`Cause.die`), and fiber interruptions (`Cause.interrupt`) all at once — with no information loss. A fiber interrupted while two parallel children are both failing carries all three in a single `Cause` value.

Third, the generator-based `Effect.gen` protocol achieves `async/await`-like readability while preserving the full type system. The trick is that `Effect`, `Option`, `Either`, and `Context.Tag` all implement `[Symbol.iterator]()` returning a `SingleShotGen`/`YieldWrap` adapter (`repos/effect/packages/effect/src/internal/core.ts:158-160`). This means you can `yield*` any of them inside `Effect.gen` and the TypeScript compiler infers the union of all error types and the intersection of all requirements across the entire generator body — no explicit type annotations needed.

Finally, the `dual` function (`repos/effect/packages/effect/src/Function.ts:95-139`) is how every combinator supports both pipeline style (`effect.pipe(Effect.map(f))`) and direct call style (`Effect.map(effect, f)`) from a single implementation. No duplicated logic; the `arity`-based dispatch happens at runtime with near-zero overhead.

## Conventions observed

This package is the canonical reference for all conventions in [`research/03-conventions.md`](../03-conventions.md). Specific observations:

**File layout**: `src/` contains 101 `internal/` files and ~76 public files. The `internal/` directory has a sub-folder `opCodes/` for string-constant op-code tables (`repos/effect/packages/effect/src/internal/opCodes/effect.ts`). The split between a public module (types + re-exports) and its `internal/` implementation is strict: `Effect.ts` imports `* as core from "./internal/core.js"` and re-exports only the shapes it chooses.

**Exports map**: The monorepo dev build maps `"."` → `"./src/index.ts"` and `"./*"` → `"./src/*.ts"`, and sets `"./internal/*": null` to block all internal imports. Published builds rewrite this to dual ESM/CJS conditions.

**index.ts**: Hand-maintained (not auto-generated). Six functions lifted flat (`pipe`, `flow`, etc.); everything else is a namespace re-export with a per-export `@since` JSDoc block. See `repos/effect/packages/effect/src/index.ts:1-80`.

**JSDoc style**: Prose paragraphs using section headers `**Details**`, `**When to Use**`, `**Example**`. No `@param`/`@returns`; only `@since`, `@category`, `@example`, `@see`, and (rarely) `@experimental`. Representative example: `repos/effect/packages/effect/src/Effect.ts:89-115`.

**TypeIds**: Every public type has `export const FooTypeId: unique symbol = internal.FooTypeId` (value) and `export type FooTypeId = typeof FooTypeId` (type alias). The symbol is defined once in `internal/`, re-exported in the public module. Pattern established at `repos/effect/packages/effect/src/Effect.ts:81-87` and mirrored in every type in the package.

**Variance annotations**: All three variance positions are encoded via `Types.Covariant<A>`, `Types.Contravariant<A>`, and `Types.Invariant<A>` helper type aliases embedded in the `[TypeId]` variance struct. Example for `Layer`: `repos/effect/packages/effect/src/Layer.ts:75-80` — `_ROut` is contravariant (requirements consumed), `_E` and `_RIn` are covariant.

**Naming**: Constructors follow `.make` (allocate), `.succeed`/`.fail`/`.sync` (lift), `.from*` (convert). Error types follow `<Domain>Error` for domain errors and `<Action>Exception` for runtime exceptions. Layer variables are conventionally suffixed `Live` for real implementations.

**One divergence from sibling packages**: `effect`'s `index.ts` is hand-maintained while sibling packages like `@effect/cli` use `"effect": { "generateIndex": { "include": ["**/*"] } }` for auto-generation (`repos/effect/packages/cli/package.json`). This reflects the core package's greater surface area and intentional curation of what is exposed.

## "If you were authoring something similar, copy this"

- **The `dual` combinator for zero-cost dual API style.** Copy `dual` from `repos/effect/packages/effect/src/Function.ts:95-139` into any library. Declare your function signature as an overloaded object type (data-last first, data-first second) and pass `arity` or a predicate. Callers get pipeline style and direct call style from one implementation with no branching in user code.

- **The `Pipeable` interface mixin.** Copy the `Pipeable` interface from `repos/effect/packages/effect/src/Pipeable.ts:11-60` and implement `pipe()` via `pipeArguments(this, arguments)`. Any value type gains `.pipe(f, g, h)` method chaining for free. This is what makes `effect.pipe(Effect.map(f), Effect.tap(g))` work on the `Effect` value directly.

- **The `TypeId` / variance struct pattern.** For every data type: declare `export const FooTypeId: unique symbol` and `export type FooTypeId = typeof FooTypeId`. Embed variance via `{ readonly [FooTypeId]: { readonly _A: Covariant<A>; readonly _E: Covariant<E> } }`. This gives runtime brand-checking (no `instanceof` needed), variance tracking (TypeScript catches contravariant misuse), and a stable API surface that doesn't depend on the class hierarchy. See `repos/effect/packages/effect/src/Effect.ts:81-87` and `repos/effect/packages/effect/src/Layer.ts:53-80`.

- **The `internal/` folder + `exports: { "./internal/*": null }` lockout.** Place all implementation files in `src/internal/`, mark every declaration `/** @internal */`, add `"stripInternal": true` to `tsconfig.build.json`, and set `"./internal/*": null` in the package exports map. Users get no path to import internals even accidentally, yet you can refactor freely. Source: `repos/effect/packages/effect/tsconfig.build.json:8` and `repos/effect/packages/effect/package.json`.

- **The `@since` / `@category` JSDoc discipline.** Every exported symbol gets a `@since` tag with the semver version it was introduced, and a `@category` that groups it in generated docs. The categories in `Effect.ts` are descriptive (`"Creating Effects"`, `"Mapping"`, `"Error Handling"`, `"Supervision & Fibers"`, `"Semaphore"`) rather than structural. This makes the generated API docs navigable without reading source.

- **The `SingleShotGen` + `YieldWrap` + `[Symbol.iterator]()` trick.** Implementing `[Symbol.iterator]()` on a data type makes it `yield*`-able inside `Effect.gen`. The returned iterator yields exactly once (a `YieldWrap` of the value) and the result type is the type the effect produces. See `repos/effect/packages/effect/src/internal/core.ts:127-160`. Copy this pattern to make your own types usable in Effect generators.

- **The namespace-re-export index pattern.** `export * as Foo from "./Foo.js"` with a `@since` JSDoc on each line, in `index.ts`. This gives consumers `import { Effect, Layer, Stream } from "effect"` (namespace import) and `import * as Effect from "effect/Effect"` (deep import) from the same source — without any build duplication. Six flat exports (`pipe`, `flow`, etc.) are the only exceptions, hoisted for ergonomics. Source: `repos/effect/packages/effect/src/index.ts:1-80`.

## Open questions

1. **`Effect.Service` maturity.** The `Effect.Service` class macro is tagged `@experimental` at `repos/effect/packages/effect/src/Effect.ts:13581-13583`. The deprecation comment `/** @deprecated */` on the `ಠ_ಠ` guard field and the multiple overloaded call signatures suggest the API is still being refined. It's worth monitoring before recommending it as the canonical service definition pattern in the book.

2. **`ExecutionPlan` novelty.** `src/ExecutionPlan.ts` exists as a public module but has no corresponding catalog entry in `02-patterns-catalog.md`. It's referenced in `Stream.ts` and `Effect.ts` imports. The pattern (running a local computation first, falling back to a remote one if local can't satisfy) is interesting for edge/CDN scenarios but the docs are thin. Worth a dedicated worked example.

3. **Schema's `@since 3.10.0` migration.** `Schema.ts` was moved from the separate `@effect/schema` package into `effect` at 3.10.0. The book should clarify that pre-3.10.0 code importing `@effect/schema` needs a migration step. The `Schema.ts` module header at `repos/effect/packages/effect/src/Schema.ts:1-3` has no migration note.

4. **`Micro` module import in `fiberRuntime.ts`.** `repos/effect/packages/effect/src/internal/fiberRuntime.ts:30` imports `* as Micro from "../Micro.js"`, but `Micro.ts` is not in the public `index.ts` exports (as of the examined file listing). Is `Micro` an internal-only module or intentionally unlisted? If it's a public but undocumented escape hatch for minimal-overhead effects, it warrants a note.

5. **`Graph`, `HashRing`, `Trie` utility modules.** These specialized collection types (`src/Graph.ts`, `src/HashRing.ts`, `src/Trie.ts`) were added but lack catalog entries. Are they used internally by cluster/routing packages, or intended for direct application use? A short inventory of their intended consumers would help the book decide whether to cover them.
