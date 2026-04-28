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

- [Constructors](#make--of-constructors)
- [Effects](#effectgen--yield)
- [Layers & Context](#layersucceed--effect--scoped--layer-constructors)
- [Errors & Cause](#datataggederror)
- [Option & Either](#option--some--none-and-combinators)
- [Schema](#schemastruct)
- [Streams & Concurrency](#streammake--fromiterable--fromeffect)
- [Resources & Scope](#effectacquirerelease--acquireuserelease)
- [API style (pipeable, dual)](#dual-data-first--data-last-dual-and-pipeable-trait)
- [Data, Equal, Hash, Brand](#datastruct--tuple--array--class--taggedclass)
- [Module / file conventions](#the-internal-folder-and-indexts-re-export-shape)
- [Concurrency primitives](#ref--atomic-mutable-cell)
- [Observability](#loggermake--withminimumloglevel-and-effectlog-family)
- [State management](#stmgen--stmcommit--software-transactional-memory)
- [Time & Scheduling](#schedulespaced--exponential--fixed--recurs)
- [Pattern matching](#matchvalue--matchtype--starting-a-match)
- [Configuration](#configstring--integer--boolean--nested--all)
- [Request batching & Caching](#requestof--requestresolvermake--effectrequest--request-batching)
- [Immutable Collections](#chunk--typed-array-container-streams-element-type)

## Constructors

### `.make` / `.of` constructors

**Signature:**
```ts
// Context.make
export const make: <I, S>(tag: Tag<I, S>, service: Types.NoInfer<S>) => Context<I>

// Ref.make
export const make: <A>(value: A) => Effect.Effect<Ref<A>>

// Deferred.make
export const make: <A, E = never>() => Effect.Effect<Deferred<A, E>>

// Chunk.of
export const of = <A>(a: A): NonEmptyChunk<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Context.ts:290-290` — `Context.make` creates a single-service context from a tag and value
- `repos/effect/packages/effect/src/Ref.ts:69-69` — `Ref.make` builds an atomic mutable cell returning an Effect
- `repos/effect/packages/effect/src/Deferred.ts:88-88` — `Deferred.make` creates a one-shot async value
- `repos/effect/packages/effect/src/Chunk.ts:242-242` — `Chunk.of` wraps a single element into a NonEmptyChunk

**When to use:** Use `.make` whenever Effect's modules offer a typed constructor rather than writing a plain `new` call — `Context.make(Tag, service)`, `Ref.make(value)`, `Deferred.make()`. The name is consistent across modules so it is the first thing to reach for when creating an instance of a module's primary type. Use `.of` (e.g., `Chunk.of`) when you have a single element and want a non-empty typed container.

**When NOT to use:** Don't use `Context.make` to compose multiple services together; use `Context.add` or build a `Layer` instead. Don't call `Ref.make` directly at top-level module scope — wrap it in an `Effect.gen` or `Layer` so it runs lazily inside the Effect runtime.

**Anti-pattern it replaces:** Direct `new` construction or plain object literals without Effect's type safety: `const ref = { value: 0 }` instead of `Ref.make(0)`, or building a `Context` by hand as a plain `Map`.

**Related:** [`.from*` family](#from-family), [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`Deferred` — one-shot async value](#deferred--one-shot-async-value)

### `.from*` family

**Signature:**
```ts
// Chunk.fromIterable
export const fromIterable = <A>(self: Iterable<A>): Chunk<A>

// HashMap.fromIterable
export const fromIterable: <K, V>(entries: Iterable<readonly [K, V]>) => HashMap<K, V>

// Stream.fromIterable
export const fromIterable: <A>(iterable: Iterable<A>) => Stream<A>

// Stream.fromEffect
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Stream<A, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Chunk.ts:250-251` — convert any `Iterable<A>` to a typed `Chunk<A>`
- `repos/effect/packages/effect/src/HashMap.ts:129-129` — build a `HashMap` from key-value iterable entries
- `repos/effect/packages/effect/src/Stream.ts:2086-2087` — lift an iterable into a pure stream
- `repos/effect/packages/effect/src/Stream.ts:2019-2019` — lift a single Effect value into a one-element stream

**When to use:** Use `.fromIterable` when you already have a standard JS iterable (array, `Set`, generator, etc.) and need to convert it to Effect's collection type — `Chunk.fromIterable(arr)`, `HashMap.fromIterable(entries)`, `Stream.fromIterable(arr)`. This is the idiomatic interop point between JS data and Effect data structures.

**When NOT to use:** If you only need one element, use `.of` or `.make` instead of wrapping in an array. If you're building a `Stream` from a push-based source (event emitter, WebSocket), use `Stream.asyncPush` not `Stream.fromIterable`.

**Anti-pattern it replaces:** Manual for-loops that convert arrays into Effect collections: `let c = Chunk.empty(); for (const x of arr) c = Chunk.append(c, x)` — replace with `Chunk.fromIterable(arr)`.

**Related:** [`.make` / `.of` constructors](#make--of-constructors), [`Stream.make` / `fromIterable` / `fromEffect`](#streammake--fromiterable--fromeffect), [`Chunk — typed array container`](#chunk--typed-array-container-streams-element-type)

## Effects

### `Effect.gen` + `yield*`

**Signature:**
```ts
export const gen: {
  <Eff extends YieldWrap<Effect<any, any, any>>, AEff>(
    f: (resume: Adapter) => Generator<Eff, AEff, never>
  ): Effect<
    AEff,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect<infer _A, infer E, infer _R>>] ? E : never,
    ...
  >
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:2760-2776` — generator-based sequential composition; `yield*` unwraps each `Effect` value

**When to use:** Use `Effect.gen` whenever you need to sequence two or more Effects and want the result to read like synchronous imperative code. It is the primary composition tool for business logic — reading from services, transforming data, branching on results. `yield*` unwraps any `Effect`, `Option`, or `Either` inside the generator.

**When NOT to use:** For a single transformation with no sequencing, use `Effect.map` or `Effect.flatMap` in a pipeline — `Effect.gen` adds a generator frame for no benefit. For fire-and-forget side effects that don't need their results, `Effect.tap` inside a pipeline is cleaner.

**Anti-pattern it replaces:** The `async/await` + `try/catch` pyramid: `try { const a = await fetchA(); const b = await fetchB(a); return b; } catch (e) { ... }` — this has no typed errors, no dependency injection, and no interruption support. `Effect.gen` provides all three.

**Related:** [`Effect.fn` (named effect functions with auto-tracing)](#effectfn-named-effect-functions-with-auto-tracing), [`Effect.succeed` / `fail` / `sync` / `promise` / `tryPromise`](#effectsucceed--fail--sync--promise--trypromise), [`Effect.all` / `Effect.repeat` / `Effect.retry`](#effectall--effectrepeat--effectretry--combinators)

### `Effect.fn` (named effect functions with auto-tracing)

**Signature:**
```ts
export const fn:
  & fn.Gen
  & fn.NonGen
  & ((
    name: string,
    options?: Tracer.SpanOptions
  ) => fn.Gen & fn.NonGen)
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:14630-14640` — wraps a generator function with a span name, enabling auto-tracing of named Effect functions

**When to use:** Use `Effect.fn("myService.doThing")` when defining a named function that returns an Effect and you want it to appear as a named span in traces without writing `Effect.withSpan` manually on every call site. It is the recommended way to define service methods in production code.

**When NOT to use:** Don't use `Effect.fn` for small, anonymous, internal helper lambdas where tracing adds noise. For anonymous one-off generators, use `Effect.gen` directly. If you don't have an observability system set up, `Effect.fn` still works but the tracing benefit is invisible.

**Anti-pattern it replaces:** Manually wrapping every generator in `Effect.withSpan`: `const doThing = (x: number) => Effect.withSpan("doThing")(Effect.gen(function*() { ... }))` — `Effect.fn("doThing")` fuses the name and the generator into one declaration.

**Related:** [`Effect.gen` + `yield*`](#effectgen--yield), [`Effect.withSpan` / `annotateCurrentSpan`](#effectwithspan--annotatecurrentspan--distributed-tracing)

### `Effect.succeed` / `fail` / `sync` / `promise` / `tryPromise`

**Signature:**
```ts
export const succeed: <A>(value: A) => Effect<A>
export const fail: <E>(error: E) => Effect<never, E>
export const sync: <A>(thunk: LazyArg<A>) => Effect<A>
export const promise: <A>(evaluate: (signal: AbortSignal) => PromiseLike<A>) => Effect<A>
export const tryPromise: {
  <A, E>(options: { readonly try: ...; readonly catch: (error: unknown) => E }): Effect<A, E>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:3160-3160` — `succeed` lifts a pure value into Effect
- `repos/effect/packages/effect/src/Effect.ts:2575-2575` — `fail` creates a failed Effect with typed error
- `repos/effect/packages/effect/src/Effect.ts:3326-3326` — `sync` defers a synchronous computation
- `repos/effect/packages/effect/src/Effect.ts:3131-3133` — `promise` wraps a Promise (no error channel)
- `repos/effect/packages/effect/src/Effect.ts:4677-4685` — `tryPromise` wraps a Promise with error mapping

**When to use:** These are the leaf constructors — the boundary where plain values and existing async APIs enter the Effect world. Use `succeed` for pure constant values, `fail` to represent known error conditions, `sync` for thunks that may throw (e.g., `JSON.parse`), `promise` for third-party async APIs you trust not to throw, and `tryPromise` when the Promise may reject and you want a typed error channel.

**When NOT to use:** Don't use `promise` for anything that can fail with a meaningful typed error — use `tryPromise` with a `catch` that maps to a `Data.TaggedError`. Don't use `sync` for async operations; it will throw at runtime. Don't use `succeed` inside a generator when you can just return the value directly.

**Anti-pattern it replaces:** Untyped promise chains: `fetch(url).then(r => r.json()).catch(e => { console.error(e); return null; })` — errors are `unknown`, failures are swallowed. `tryPromise({ try: () => fetch(url).then(r => r.json()), catch: (e) => new FetchError({ message: String(e) }) })` gives typed errors and composable recovery.

**Related:** [`Effect.gen` + `yield*`](#effectgen--yield), [`Effect.runPromise` / `runSync` / `runFork`](#effectrunpromise--runsync--runfork), [`Data.TaggedError`](#datataggederror)

### `Effect.runPromise` / `runSync` / `runFork`

**Signature:**
```ts
export const runPromise: <A, E>(
  effect: Effect<A, E, never>,
  options?: { readonly signal?: AbortSignal | undefined } | undefined
) => Promise<A>

export const runSync: <A, E>(effect: Effect<A, E>) => A

export const runFork: <A, E>(
  effect: Effect<A, E>,
  options?: Runtime.RunForkOptions
) => Fiber.RuntimeFiber<A, E>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:12136-12139` — `runPromise` executes an Effect as a `Promise`
- `repos/effect/packages/effect/src/Effect.ts:12279-12279` — `runSync` executes an Effect synchronously (throws on async/failure)
- `repos/effect/packages/effect/src/Effect.ts:12064-12067` — `runFork` starts an Effect as a detached fiber

**When to use:** These are the "end of the world" functions — call them only at your application's entry point (e.g., `main`, an HTTP handler adapter, a test runner). Use `runPromise` when integrating with an existing Promise-based framework (Express, Next.js). Use `runSync` only for fully synchronous Effects in CLIs or scripts. Use `runFork` when you need to start a background fiber and manage its lifecycle manually.

**When NOT to use:** Don't call any `run*` inside another Effect — use `flatMap` or `gen` instead. Don't use `runSync` if your Effect might be async (it will throw a `Die` defect). In frameworks like `@effect/platform` that provide a runtime integration, use their adapters (e.g., `HttpApp.toWebHandler`) rather than calling `runPromise` on each request.

**Anti-pattern it replaces:** Calling `runPromise` deep inside business logic: `const result = await Effect.runPromise(someEffect)` inside another async function — this breaks the Effect runtime's interruption, tracing, and context propagation. All `run*` calls should be at the top of the call stack.

**Related:** [`Effect.gen` + `yield*`](#effectgen--yield), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin), [`ManagedRuntime.make`](#managedruntimemake)

### `Effect.all` / `Effect.repeat` / `Effect.retry` — combinators

**Signature:**
```ts
export const all: <
  const Arg extends Iterable<Effect<any, any, any>> | Record<string, Effect<any, any, any>>,
  O extends { readonly concurrency?: Concurrency; readonly mode?: "default" | "validate" | "either" }
>(arg: Arg, options?: O) => Effect<...>

export const retry: {
  <A, E, R, O extends Retry.Options<E>>(options: O): (self: Effect<A, E, R>) => Effect.Retry<A, E, R, O>
  <A, E, R, O extends Retry.Options<E>>(self: Effect<A, E, R>, options: O): Effect.Retry<A, E, R, O>
}

export const repeat: {
  <A, E, R, O extends Repeat.Options<A>>(options: O): (self: Effect<A, E, R>) => Effect.Repeat<A, E, R, O>
  <A, E, R, O extends Repeat.Options<A>>(self: Effect<A, E, R>, options: O): Effect.Repeat<A, E, R, O>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:825-834` — `all` runs many Effects, optionally in parallel
- `repos/effect/packages/effect/src/Effect.ts:4400-4410` — `retry` retries a failing Effect with a `Schedule`
- `repos/effect/packages/effect/src/Effect.ts:10178-10192` — `repeat` repeats a successful Effect with a `Schedule`

**When to use:** Use `Effect.all([a, b, c])` when you have independent Effects that can run concurrently — pass `{ concurrency: "unbounded" }` or a number. Use `retry` with a `Schedule` to add automatic retry logic to any flaky operation (network calls, database queries). Use `repeat` to turn a one-shot Effect into a polling loop or heartbeat.

**When NOT to use:** Don't use `Effect.all` in sequential mode (the default) when you actually want concurrency — it processes elements sequentially by default, and the silent performance cost can be surprising. Don't use `retry` without a `Schedule` limit (e.g., `recurs(3)`) in production — infinite retry can turn transient errors into perpetual hangs. Don't use `repeat` for time-based scheduling; use `Schedule.cron` or `Stream.fromSchedule` instead.

**Anti-pattern it replaces:** `Promise.all([a(), b(), c()])` with no error handling, no retries, and no way to cancel: `const [x, y] = await Promise.all([fetchUser(), fetchOrders()])`. There is no typed error, no retry, and if one rejects the other keeps running. `Effect.all` propagates typed errors and interrupts siblings on first failure by default.

**Related:** [`Effect.gen` + `yield*`](#effectgen--yield), [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](#schedulespaced--exponential--fixed--recurs), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin)

## Layers & Context

### `Layer.succeed` / `effect` / `scoped` — Layer constructors

**Signature:**
```ts
export const succeed: {
  <I, S>(tag: Context.Tag<I, S>): (resource: Types.NoInfer<S>) => Layer<I>
  <I, S>(tag: Context.Tag<I, S>, resource: Types.NoInfer<S>): Layer<I>
}

export const effect: {
  <I, S>(tag: Context.Tag<I, S>): <E, R>(effect: Effect.Effect<Types.NoInfer<S>, E, R>) => Layer<I, E, R>
  <I, S, E, R>(tag: Context.Tag<I, S>, effect: Effect.Effect<Types.NoInfer<S>, E, R>): Layer<I, E, R>
}

export const scoped: {
  <I, S>(tag: Context.Tag<I, S>): <E, R>(effect: Effect.Effect<Types.NoInfer<S>, E, R>) => Layer<I, E, Exclude<R, Scope.Scope>>
  <I, S, E, R>(tag: Context.Tag<I, S>, effect: Effect.Effect<Types.NoInfer<S>, E, R>): Layer<I, E, Exclude<R, Scope.Scope>>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Layer.ts:772-775` — `Layer.succeed` creates a layer from a constant value
- `repos/effect/packages/effect/src/Layer.ts:289-292` — `Layer.effect` creates a layer from an effectful acquisition
- `repos/effect/packages/effect/src/Layer.ts:727-735` — `Layer.scoped` creates a layer that manages a scoped resource

**When to use:** Use `Layer.succeed(Tag, value)` for services with no async initialization (pure values, in-memory implementations, test doubles). Use `Layer.effect(Tag, effect)` when the service must be created asynchronously (database connections, config loading). Use `Layer.scoped(Tag, scopedEffect)` when the service owns a resource that needs cleanup (file handles, connections using `acquireRelease`).

**When NOT to use:** Don't use `Layer.succeed` for services that hold mutable resources requiring cleanup — they will leak. Don't use `Layer.effect` when your acquisition also needs cleanup — use `Layer.scoped` instead. Don't define layers inline at call sites; define them as top-level named exports so they can be memoized and reused across the layer graph.

**Anti-pattern it replaces:** Manually passing constructed objects through function parameters: `function makeApp(db: Database, cache: Cache) { ... }`. With Layers, each service is declared once and the runtime wires dependencies automatically — no constructor arguments to thread through the call stack.

**Related:** [`Layer.merge` / `provide` / `fresh`](#layermerge--provide--fresh--layer-composition), [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease), [`Effect.Service` class](#effectservice-class)

### `Layer.merge` / `provide` / `fresh` — Layer composition

**Signature:**
```ts
export const merge: {
  <RIn2, E2, ROut2>(that: Layer<ROut2, E2, RIn2>): <RIn, E1, ROut>(self: Layer<ROut, E1, RIn>) => Layer<ROut2 | ROut, E2 | E1, RIn2 | RIn>
  <RIn, E1, ROut, RIn2, E2, ROut2>(self: Layer<ROut, E1, RIn>, that: Layer<ROut2, E2, RIn2>): Layer<ROut2 | ROut, E2 | E1, RIn2 | RIn>
}

export const provide: {
  <RIn, E, ROut>(that: Layer<ROut, E, RIn>): <RIn2, E2, ROut2>(self: Layer<ROut2, E2, RIn2>) => Layer<ROut2, E | E2, RIn | Exclude<RIn2, ROut>>
  ...
}

export const fresh: <A, E, R>(self: Layer<A, E, R>) => Layer<A, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Layer.ts:567-572` — `merge` combines two layers side-by-side (union of outputs)
- `repos/effect/packages/effect/src/Layer.ts:899-904` — `provide` wires one layer's output into another's requirements
- `repos/effect/packages/effect/src/Layer.ts:397-398` — `fresh` disables memoization so a layer is rebuilt each time

**When to use:** Use `Layer.merge(A, B)` to combine two independent service layers into one layer that provides both. Use `Layer.provide(upstream)` to satisfy a layer's requirements from another layer (the fundamental wiring operation). Use `Layer.fresh` in tests when you need each test to get its own fresh instance of a shared service (e.g., an in-memory database).

**When NOT to use:** Don't use `Layer.fresh` in production — layers are memoized by default for a reason, and `fresh` doubles resource usage by building separate instances. Don't manually merge many layers with repeated `merge` calls — compose them into a single `AppLayer` using `Layer.provide` chains, which Effect optimizes.

**Anti-pattern it replaces:** DI container registration boilerplate: `container.register('Database', DatabaseImpl); container.register('Cache', CacheImpl); container.resolve('App')` — Layer composition is typed end-to-end and checked at compile time; missing services are a type error, not a runtime crash.

**Related:** [`Layer.succeed` / `effect` / `scoped`](#layersucceed--effect--scoped--layer-constructors), [`Context.GenericTag` / `Tag` class / `Reference`](#contextgenerictag--tag-class--reference--tag-variants), [`ManagedRuntime.make`](#managedruntimemake)

### `Context.GenericTag` / `Tag` class / `Reference` — tag variants

**Signature:**
```ts
export const GenericTag: <Identifier, Service = Identifier>(key: string) => Tag<Identifier, Service>

// Reference (default-value tag)
export const Reference: <Self>() => <const Id extends string, Service>(
  id: Id,
  options: { readonly defaultValue: () => Service }
) => ReferenceClass<Self, Id, Service>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Context.ts:181-182` — `GenericTag` creates a unique context tag by string key
- `repos/effect/packages/effect/src/Context.ts:582-585` — `Reference` creates a tag with a built-in default value

**When to use:** Use `Context.GenericTag` when you need a service tag without a class — for simple service shapes or when interoperating with existing objects. Use the `Tag` class pattern (via `Effect.Service`) for the majority of application services; it co-locates the tag and the interface. Use `Reference` for optional config values that have sensible defaults — the service resolves without requiring the layer to be explicitly provided.

**When NOT to use:** Don't use `GenericTag` as a stringly-typed substitute for proper service definitions in large codebases — the string key is required to be unique globally but TypeScript cannot enforce this. Prefer `Effect.Service` which generates a unique class-based tag. Don't use `Reference` when the default value is expensive to compute or has side effects.

**Anti-pattern it replaces:** Global singletons or module-level constants passed as implicit dependencies: `import { db } from './database'` — these couple modules, make testing hard, and cannot be swapped per-environment. A `Tag` makes the dependency explicit in the Effect's `R` type parameter.

**Related:** [`Effect.Service` class](#effectservice-class), [`Layer.succeed` / `effect` / `scoped`](#layersucceed--effect--scoped--layer-constructors), [`Layer.merge` / `provide` / `fresh`](#layermerge--provide--fresh--layer-composition)

### `Effect.Service` class

**Signature:**
```ts
export const Service: <Self = never>() => [Self] extends [never] ? MissingSelfGeneric : {
  <const Id extends string, Shape>(
    id: Id,
    fields: Shape & ServiceFields<Shape, Id>
  ): ServiceClass<Self, Id, Shape>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:13585-13630` — `Effect.Service` generates a tag + layer class from a plain object definition

**When to use:** Use `Effect.Service` as the standard way to define application services. It generates the `Tag`, the `Layer`, and the service interface in one declaration, eliminating the boilerplate of manually creating a tag and a separate layer constructor. It is the recommended approach for any service that doesn't need unusual layer lifecycle (use `Layer.scoped` directly for those).

**When NOT to use:** Don't use `Effect.Service` for highly dynamic services that need to be built from runtime configuration — use `Layer.effect` directly for more control. Don't use it for pure values or constants; `Layer.succeed` with a `GenericTag` is simpler.

**Anti-pattern it replaces:** The three-file boilerplate pattern common in older Effect codebases: a `ServiceTag.ts` declaring the tag, a `ServiceImpl.ts` implementing it, and a `ServiceLayer.ts` wiring them together. `Effect.Service` collapses all three into one class declaration.

**Related:** [`Context.GenericTag` / `Tag` class / `Reference`](#contextgenerictag--tag-class--reference--tag-variants), [`Layer.succeed` / `effect` / `scoped`](#layersucceed--effect--scoped--layer-constructors), [`Layer.merge` / `provide` / `fresh`](#layermerge--provide--fresh--layer-composition)

### `ManagedRuntime.make`

**Signature:**
```ts
export const make: <R, E>(
  layer: Layer.Layer<R, E, never>,
  memoMap?: Layer.MemoMap | undefined
) => ManagedRuntime<R, E>
```

**Where it appears:**
- `repos/effect/packages/effect/src/ManagedRuntime.ts:177-180` — creates a runtime whose lifetime is tied to the provided layer (used in React/Node integrations)

**When to use:** Use `ManagedRuntime.make(AppLayer)` at the application boundary when you need to run Effects from non-Effect code repeatedly — for example, in a React component tree where you call Effect-based services from event handlers, or in a long-running Node.js server where you want a single shared runtime with the full service layer. The runtime is disposed when the layer's scope closes.

**When NOT to use:** Don't use `ManagedRuntime` when `Effect.runPromise` or `Effect.runFork` on a fully-provided Effect is sufficient (no repeated calls). Don't create a new `ManagedRuntime` per request in a server — create one at startup and share it.

**Anti-pattern it replaces:** Calling `Effect.runPromise(effect.pipe(Effect.provide(AppLayer)))` on every invocation — this rebuilds and tears down the entire service layer on each call, destroying connection pools and other stateful services.

**Related:** [`Runtime — pre-built runtime`](#runtime--pre-built-runtime-for-executing-effects), [`Layer.merge` / `provide` / `fresh`](#layermerge--provide--fresh--layer-composition), [`Effect.runPromise` / `runSync` / `runFork`](#effectrunpromise--runsync--runfork)

### Runtime — pre-built runtime for executing Effects

**Signature:**
```ts
export interface Runtime<in R> extends Pipeable {
  readonly context: Context.Context<R>
  readonly runtimeFlags: RuntimeFlags.RuntimeFlags
  readonly fiberRefs: FiberRefs.FiberRefs
}

export const defaultRuntime: Runtime<never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Runtime.ts:40-57` — `Runtime` interface definition
- `repos/effect/packages/effect/src/Runtime.ts:205-205` — `defaultRuntime` is the standard runtime with no requirements

**When to use:** Use `Runtime` (via `ManagedRuntime` or `Effect.runtime()`) when you need to run Effects from a context that has already provided its dependencies — for example, within a React component that receives the runtime from a context provider, or a route handler that receives a pre-built runtime at startup. `defaultRuntime` is useful for running Effects with no dependencies in scripts and tests.

**When NOT to use:** Don't reach for the `Runtime` interface directly in application code — use `ManagedRuntime.make` which handles lifecycle. Don't use `defaultRuntime` for Effects that require services (the type system will catch this as a `never` requirement mismatch).

**Anti-pattern it replaces:** Storing constructed services in a global `let` variable and importing them in handlers: `let db: Database; async function init() { db = await createDb(); }` — the `Runtime` carries the context safely and makes dependencies explicit.

**Related:** [`ManagedRuntime.make`](#managedruntimemake), [`RuntimeFlags — concurrency, tracing, interruption controls`](#runtimeflags--concurrency-tracing-interruption-controls), [`Effect.runPromise` / `runSync` / `runFork`](#effectrunpromise--runsync--runfork)

### RuntimeFlags — concurrency, tracing, interruption controls

**Signature:**
```ts
export type RuntimeFlags = number & { readonly RuntimeFlags: unique symbol }

export const make: (...flags: ReadonlyArray<RuntimeFlag>) => RuntimeFlags
export const none: RuntimeFlags
```

**Where it appears:**
- `repos/effect/packages/effect/src/RuntimeFlags.ts:19-21` — `RuntimeFlags` is a bitset controlling runtime features
- `repos/effect/packages/effect/src/RuntimeFlags.ts:275-275` — `make` builds a flags bitset from individual `RuntimeFlag` values
- `repos/effect/packages/effect/src/RuntimeFlags.ts:281-281` — `none` is an empty flags value

**When to use:** Use `RuntimeFlags` only when customizing the runtime for specific performance or behavior needs — for example, disabling interruption in a critical section via `Effect.uninterruptible`, or enabling cooperative yielding. In most applications you never construct `RuntimeFlags` directly; the defaults are appropriate.

**When NOT to use:** Don't disable tracing or interruption globally to "improve performance" without profiling — you'll lose observability and safety. Don't manipulate `RuntimeFlags` to work around correctness issues; those are signs of a deeper design problem.

**Anti-pattern it replaces:** Using raw `setImmediate` or `process.nextTick` hacks to yield control in Node.js tight loops — Effect's cooperative scheduling (controlled by runtime flags) handles yielding automatically.

**Related:** [`Runtime — pre-built runtime`](#runtime--pre-built-runtime-for-executing-effects), [`ManagedRuntime.make`](#managedruntimemake)

### LayerMap — keyed map of layers (per-tenant / per-request)

**Signature:**
```ts
export const make: <
  K,
  L extends Layer.Layer<any, any, any>,
  PreloadKeys extends Iterable<K> | undefined = undefined
>(
  lookup: (key: K) => L,
  options?: { ... }
) => Effect<LayerMap<K, Layer.Success<L>, Layer.Error<L>>, Layer.Error<L>, Layer.Context<L>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/LayerMap.ts:114-120` — `LayerMap.make` creates a keyed collection of on-demand layers, useful for per-tenant service instantiation

**When to use:** Use `LayerMap` in multi-tenant SaaS applications where each tenant needs an isolated instance of a service (e.g., a separate database connection pool per tenant), and tenants are created dynamically at runtime based on request data. The map lazily initializes and caches the layer for each key.

**When NOT to use:** Don't use `LayerMap` when the set of keys is known at startup — build separate named layers instead, which are simpler and compose better. Don't use it for per-request isolation where you want no caching; use `Layer.fresh` or build a scoped layer per request.

**Anti-pattern it replaces:** A plain `Map<string, Database>` maintained as global mutable state, with manual initialization guards: `if (!dbMap.has(tenantId)) dbMap.set(tenantId, await createDb(tenantId))` — this has race conditions, no resource cleanup, and no type safety.

**Related:** [`Layer.succeed` / `effect` / `scoped`](#layersucceed--effect--scoped--layer-constructors), [`Reloadable — hot-reload a service layer at runtime`](#reloadable--hot-reload-a-service-layer-at-runtime), [`RcMap`](#rcref-and-rcmap--reference-counted-resources)

### Reloadable — hot-reload a service layer at runtime

**Signature:**
```ts
export const auto: <I, S, E, In, R>(
  tag: Context.Tag<I, S>,
  options: { readonly layer: Layer.Layer<I, E, In>; readonly schedule: Schedule.Schedule<unknown, unknown, R> }
) => Layer.Layer<Reloadable<I>, E, R | In>

export const manual: <I, S, In, E>(
  tag: Context.Tag<I, S>,
  options: { readonly layer: Layer.Layer<I, E, In> }
) => Layer.Layer<Reloadable<I>, E, In>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Reloadable.ts:65-68` — `Reloadable.auto` schedules periodic layer reloads
- `repos/effect/packages/effect/src/Reloadable.ts:101-104` — `Reloadable.manual` allows on-demand reload via `Reloadable.reload`

**When to use:** Use `Reloadable.auto` for services that must be refreshed periodically — rotating API keys, refreshing OAuth tokens, reloading a feature flag configuration. Use `Reloadable.manual` when you want to trigger reloads explicitly (e.g., on a SIGHUP signal or an admin API call) rather than on a schedule.

**When NOT to use:** Don't use `Reloadable` for services that are already stateless and idempotent to recreate — just replace the layer directly. Don't use it when the reload can fail and you need the old version to remain active on failure; `Reloadable` replaces the layer regardless of whether the new one succeeds.

**Anti-pattern it replaces:** A cron job that restarts the entire process to pick up new configuration or credentials — `Reloadable` reloads only the affected service in place, with zero downtime and proper resource cleanup of the old instance.

**Related:** [`Layer.succeed` / `effect` / `scoped`](#layersucceed--effect--scoped--layer-constructors), [`LayerMap — keyed map of layers`](#layermap--keyed-map-of-layers-per-tenant--per-request), [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](#schedulespaced--exponential--fixed--recurs)

## Errors & Cause

### `Data.TaggedError`

**Signature:**
```ts
export const TaggedError = <Tag extends string>(tag: Tag): new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P] }>
) => Cause.YieldableError & { readonly _tag: Tag } & Readonly<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Data.ts:580-585` — creates a typed error class with a discriminant `_tag`, making it yieldable inside `Effect.gen`

**When to use:** Use `Data.TaggedError` for every recoverable, domain-specific error in your application — `NetworkError`, `NotFoundError`, `ValidationError`. The `_tag` discriminant lets `Effect.catchTag` handle specific variants without an `instanceof` check, and it works cleanly in a union of multiple error types.

**When NOT to use:** Don't use `TaggedError` for defects (unexpected bugs that should crash) — let those surface as `Die` via `Effect.die` or unhandled exceptions. Don't add a `_tag` that duplicates the class name in a way that's ambiguous across modules — use namespaced tag strings like `"Database.ConnectionError"`.

**Anti-pattern it replaces:** Throwing plain `Error` subclasses: `throw new Error("Not found")` or `throw new NetworkError()` — these have no typed error channel, no `_tag` for discriminated pattern matching, and cannot be `yield*`'d inside `Effect.gen`.

**Related:** [`Effect.catchTag` / `catchTags` / `sandbox`](#effectcatchtag--catchtags--sandbox--error-handling), [`Cause` — `fail` / `die` / `interrupt` variants](#cause--fail--die--interrupt-variants), [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](#datastruct--tuple--array--class--taggedclass)

### `Cause` — `fail` / `die` / `interrupt` variants

**Signature:**
```ts
export const fail: <E>(error: E) => Cause<E>
export const die: (defect: unknown) => Cause<never>
export const interrupt: (fiberId: FiberId.FiberId) => Cause<never>
export const parallel: <E, E2>(left: Cause<E>, right: Cause<E2>) => Cause<E | E2>
export const sequential: <E, E2>(left: Cause<E>, right: Cause<E2>) => Cause<E | E2>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Cause.ts:591-591` — `fail` wraps a typed error into a Cause
- `repos/effect/packages/effect/src/Cause.ts:607-607` — `die` represents an unexpected defect (no error type)
- `repos/effect/packages/effect/src/Cause.ts:623-623` — `interrupt` represents fiber interruption
- `repos/effect/packages/effect/src/Cause.ts:639-639` — `parallel` composes two simultaneous causes
- `repos/effect/packages/effect/src/Cause.ts:655-655` — `sequential` composes two sequential causes

**When to use:** Work directly with `Cause` when you need to inspect or transform the full failure context — for example, in a top-level error reporter that logs the full cause tree including defects, interrupts, and parallel causes. `Cause.parallel` and `Cause.sequential` appear when you run concurrent Effects and need to understand multi-failure scenarios.

**When NOT to use:** Don't construct `Cause` values by hand in business logic — use `Effect.fail`, `Effect.die`, and `Data.TaggedError` instead. Don't use `Cause.die` to wrap user-facing errors; `die` is for unexpected defects that should propagate uncaught.

**Anti-pattern it replaces:** A single `catch (e: unknown)` block that cannot distinguish "user typed the wrong password" (recoverable) from "database connection dropped" (retry) from "null pointer bug" (defect). `Cause` encodes the distinction structurally: `Fail` for typed errors, `Die` for defects, `Interrupt` for cancellation.

**Related:** [`Data.TaggedError`](#datataggederror), [`Effect.catchTag` / `catchTags` / `sandbox`](#effectcatchtag--catchtags--sandbox--error-handling), [`Exit — Effect outcome value`](#exit--effect-outcome-value-success--failure-of-cause)

### `Effect.catchTag` / `catchTags` / `sandbox` — error handling

**Signature:**
```ts
export const catchTag: {
  <E, const K extends RA.NonEmptyReadonlyArray<E extends { _tag: string } ? E["_tag"] : never>, A1, E1, R1>(
    ...args: [...tags: K, f: (e: Extract<NoInfer<E>, { _tag: K[number] }>) => Effect<A1, E1, R1>]
  ): <A, R>(self: Effect<A, E, R>) => Effect<A | A1, Exclude<E, { _tag: K[number] }> | E1, R | R1>
  ...
}

export const sandbox: <A, E, R>(self: Effect<A, E, R>) => Effect<A, Cause.Cause<E>, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:3882-3885` — `catchTag` handles one or more tagged error variants, narrowing the error channel
- `repos/effect/packages/effect/src/Effect.ts:3948-3996` — `catchTags` handles multiple variants via a case record
- `repos/effect/packages/effect/src/Effect.ts:4246-4246` — `sandbox` exposes the full `Cause` for inspection

**When to use:** Use `catchTag("NotFound", handler)` when you need to recover from a specific tagged error while letting others propagate. Use `catchTags({ NotFound: h1, Timeout: h2 })` when handling multiple variants from a union in one place. Use `sandbox` when you need to intercept defects or interrupts that don't appear in the typed error channel — for example, in a global error boundary that logs everything before re-raising.

**When NOT to use:** Don't use `catchTag` to silently swallow errors and return `undefined` — model the absence explicitly with `Option` or a `{ success: false }` type. Don't use `sandbox` routinely in business logic; it is an escape hatch for observability code at layer boundaries.

**Anti-pattern it replaces:** `try { ... } catch (e) { if (e instanceof NotFoundError) { ... } else throw e }` — this requires `instanceof` checks, loses type information on the re-throw, and cannot catch `Effect` typed errors at all.

**Related:** [`Data.TaggedError`](#datataggederror), [`Cause` — `fail` / `die` / `interrupt` variants](#cause--fail--die--interrupt-variants), [`Exit — Effect outcome value`](#exit--effect-outcome-value-success--failure-of-cause)

### Exit — Effect outcome value (Success / Failure of Cause)

**Signature:**
```ts
export const succeed: <A>(value: A) => Exit<A>
export const fail: <E>(error: E) => Exit<never, E>
export const die: (defect: unknown) => Exit<never, never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Exit.ts:359-359` — `Exit.succeed` wraps a successful value
- `repos/effect/packages/effect/src/Cause.ts:591-591` — `Cause.fail` (used inside `Exit.fail`) wraps a typed failure

**When to use:** Use `Exit` when you need to inspect the final outcome of an Effect outside the Effect runtime — for example, in a test assertion (`expect(exit).toEqual(Exit.succeed(42))`), or when storing the result of a fiber for later inspection. `Exit` is what `Fiber.join` produces and what `Effect.runSync` would throw if it weren't for the runtime converting it.

**When NOT to use:** Don't use `Exit` as a return type in business logic inside the Effect world — use the Effect error channel directly. The only time `Exit` appears in application code is at fiber boundaries (joining a forked fiber) or at the boundary with testing frameworks.

**Anti-pattern it replaces:** Catching all errors in a try/catch and returning a discriminated union: `type Result<A> = { ok: true; value: A } | { ok: false; error: unknown }` — `Exit` is Effect's built-in version of this pattern, with structural equality and pattern matching via `Exit.match`.

**Related:** [`Cause` — `fail` / `die` / `interrupt` variants](#cause--fail--die--interrupt-variants), [`Effect.catchTag` / `catchTags` / `sandbox`](#effectcatchtag--catchtags--sandbox--error-handling), [`Fiber — joining, interrupting, racing`](#fiber--joining-interrupting-racing-effectfork-return-type)

## Option & Either

### Option — Some / None and combinators

**Signature:**
```ts
export const some: <A>(value: A) => Option<A>
export const none = <A = never>(): Option<A>
export const fromNullable = <A>(nullableValue: A | null | undefined): Option<NonNullable<A>>
export const map: { <A, B>(f: (a: A) => B): (self: Option<A>) => Option<B>; ... }
export const flatMap: { <A, B>(f: (a: A) => Option<B>): (self: Option<A>) => Option<B>; ... }
export const getOrElse: { <A, B>(onNone: LazyArg<B>): (self: Option<A>) => A | B; ... }
```

**Where it appears:**
- `repos/effect/packages/effect/src/Option.ts:187-187` — `some` wraps a value
- `repos/effect/packages/effect/src/Option.ts:162-162` — `none` represents absence
- `repos/effect/packages/effect/src/Option.ts:684-686` — `fromNullable` converts a nullable value
- `repos/effect/packages/effect/src/Option.ts:923-930` — `map` transforms the wrapped value
- `repos/effect/packages/effect/src/Option.ts:1047-1054` — `flatMap` chains Option-returning functions
- `repos/effect/packages/effect/src/Option.ts:500-505` — `getOrElse` extracts with a fallback

**When to use:** Use `Option` for any value that is genuinely optional — a field that may not be present, a lookup that may find nothing, a parsing step that may produce no result. Use `Option.fromNullable` at the boundary with APIs that return `null` or `undefined`. `Option` is the right type when absence is not an error — when there is nothing more to say about "why" the value is missing.

**When NOT to use:** Don't use `Option` when absence has a reason — use `Either` (for a reason value) or the Effect error channel (for a typed domain error). Don't use `Option` inside `Effect` when you plan to immediately `yield*` it and want to propagate the failure — use `Effect.fromNullable` or yield the Option and catch `NoSuchElementException`.

**Anti-pattern it replaces:** Returning `null` or `undefined` for "not found": `function findUser(id: string): User | null { ... }` — callers forget the null check, TypeScript's strictNullChecks is the only guard, and chaining requires nested null checks: `user?.profile?.avatar ?? defaultAvatar`.

**Related:** [`Either — Left / Right and combinators`](#either--left--right-and-combinators), [`Bridging Option/Either ↔ Effect`](#bridging-optioneither--effect-yield-option-either), [`Match.value` / `Match.type`](#matchvalue--matchtype--starting-a-match)

### Either — Left / Right and combinators

**Signature:**
```ts
export const right: <A>(a: A) => Either<A>
export const left: <E>(e: E) => Either<never, E>
export const map: { <A, B>(f: (a: A) => B): <E>(self: Either<A, E>) => Either<B, E>; ... }
export const flatMap: { <A, E, B>(f: (a: A) => Either<B, E>): (self: Either<A, E>) => Either<B, E>; ... }
export const all: <const I extends Iterable<Either<any, any>> | Record<string, Either<any, any>>>(input: I) => Either<...>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Either.ts:120-120` — `right` represents a success value
- `repos/effect/packages/effect/src/Either.ts:138-138` — `left` represents an error value
- `repos/effect/packages/effect/src/Either.ts:365-372` — `map` transforms the right value
- `repos/effect/packages/effect/src/Either.ts:647-654` — `flatMap` chains Either-returning functions
- `repos/effect/packages/effect/src/Either.ts:734-745` — `all` sequences multiple Eithers

**When to use:** Use `Either<A, E>` when a synchronous computation can fail with a typed reason and you want to chain operations without throwing. It is the right choice for pure validation functions, parsing, and transformations where failure is a first-class result value — no async involved, no services needed. Use `Either.all` to validate a record of fields where all errors are collected.

**When NOT to use:** Don't use `Either` when your operation is async — use the `Effect` error channel instead (`Effect<A, E, never>`). Don't use `Either` for errors that need to be `yield*`'d inside `Effect.gen` with service access — the error just becomes an Effect failure. Use `Either` only for pure, synchronous transformations.

**Anti-pattern it replaces:** Throwing inside a pure function: `function parseAge(s: string): number { const n = parseInt(s); if (isNaN(n)) throw new Error("bad age"); return n; }` — callers must remember to `try/catch` a function that looks pure. `Either.right(n)` or `Either.left(new ParseError())` makes failure visible in the type.

**Related:** [`Option — Some / None and combinators`](#option--some--none-and-combinators), [`Bridging Option/Either ↔ Effect`](#bridging-optioneither--effect-yield-option-either), [`Schema.decode` / `encode` / `is` entry points`](#schemadecode--encode--is-entry-points)

### Bridging Option/Either ↔ Effect (yield*, option, either)

> **Editorial note:** The functions `Effect.fromOption`, `Effect.fromEither`, and `Effect.getOrFail` do not exist as named exports in Effect. The idiomatic way to lift an `Option` or `Either` into an `Effect` is to `yield*` them directly inside `Effect.gen` — `Option` and `Either` both implement the `EffectPrototype` (they are yieldable). A `None` causes the generator to fail with `Cause.NoSuchElementException`; a `Left(e)` fails with `e`. The functions documented below work in the **other direction**: wrapping an `Effect`'s outcome into an `Option`/`Either`.

**Signature:**
```ts
// Lift Option/Either into Effect by yielding them directly in Effect.gen:
// const value = yield* someOption  // fails with NoSuchElementException if None
// const value = yield* someEither  // fails with the Left value if Left

// Wrap an Effect's result into Option/Either (inverse direction):
export const option: <A, E, R>(self: Effect<A, E, R>) => Effect<Option.Option<A>, never, R>
export const either: <A, E, R>(self: Effect<A, E, R>) => Effect<Either.Either<A, E>, never, R>

// Exit conversions (Exit, not Effect):
export const fromEither: <R, L>(either: Either.Either<R, L>) => Exit<R, L>
export const fromOption: <A>(option: Option.Option<A>) => Exit<A, void>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:8109-8109` — `Effect.option` turns a failing Effect into `Effect<Option<A>, never, R>`
- `repos/effect/packages/effect/src/Effect.ts:8180-8180` — `Effect.either` captures errors as `Either<A, E>` removing the error channel
- `repos/effect/packages/effect/src/Exit.ts:234-234` — `Exit.fromEither` converts an `Either` into an `Exit` value
- `repos/effect/packages/effect/src/Exit.ts:242-242` — `Exit.fromOption` converts an `Option` into an `Exit` value

**When to use:** Use `yield* someOption` or `yield* someEither` inside `Effect.gen` to lift pure values into the Effect world inline — `None` becomes a `NoSuchElementException` failure, `Left(e)` becomes a typed failure `e`. Use `Effect.option(effect)` when you want to convert a possibly-failing Effect into one that always succeeds with `Some(value)` or `None`, so you can handle absence without pattern matching on the error channel.

**When NOT to use:** Don't use `Effect.either` as a general error-handling mechanism — use `catchTag` for structured recovery. Use `Effect.either` only when you need to pass both the success and error case to some downstream function that expects an `Either` (e.g., a `RequestResolver` that must fill both resolved and rejected requests).

**Anti-pattern it replaces:** `const result = await promise.catch(() => null)` — swallowing all errors by returning `null` loses the error information. `Effect.option(effect)` instead distinguishes "no value" (None) from "failure" cleanly, and `Effect.either` preserves the full error type.

**Related:** [`Option — Some / None and combinators`](#option--some--none-and-combinators), [`Either — Left / Right and combinators`](#either--left--right-and-combinators), [`Effect.catchTag` / `catchTags` / `sandbox`](#effectcatchtag--catchtags--sandbox--error-handling)

## Schema

### `Schema.Struct`

**Signature:**
```ts
export function Struct<Fields extends Struct.Fields>(fields: Fields): Struct<Fields>
export function Struct<Fields extends Struct.Fields, const Records extends IndexSignature.NonEmptyRecords>(
  fields: Fields,
  ...records: Records
): TypeLiteral<Fields, Records>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schema.ts:2936-2944` — `Struct` defines an object schema with typed fields; the primary structural schema constructor

**When to use:** Use `Schema.Struct` as the starting point for any object schema — API request bodies, database rows, configuration objects. It is the Schema equivalent of a TypeScript `interface` or `type { ... }` and supports nested structs, optional fields (via `Schema.optional`), and index signatures.

**When NOT to use:** Don't use `Schema.Struct` when you need class instances with methods — use `Schema.Class` instead. Don't reach for `Schema.Struct` for flat primitive data that has no object shape; use `Schema.string`, `Schema.number`, etc. directly.

**Anti-pattern it replaces:** Manual `z.object({...})` (Zod) or `yup.object({...})` without Effect integration — those validation libraries don't compose with Effect's error channel and require separate type definitions. `Schema.Struct` generates both the TypeScript type and the runtime validator from a single declaration.

**Related:** [`Schema.Class` and `Schema.TaggedClass`](#schemaclass-and-schemataggedclass), [`Schema.brand` / `filter` — constraints`](#schemabrand--filter--constraints), [`Schema.decode` / `encode` / `is` entry points](#schemadecode--encode--is-entry-points)

### `Schema.Class` and `Schema.TaggedClass`

**Signature:**
```ts
export const Class = <Self = never>(identifier: string) =>
  <Fields extends Struct.Fields>(
    fieldsOr: Fields | HasFields<Fields>,
    annotations?: ClassAnnotations<Self, Simplify<Struct.Type<Fields>>>
  ): [Self] extends [never] ? MissingSelfGeneric<"Class"> : Class<...>

export const TaggedClass = <Self = never>(identifier?: string) =>
  <Tag extends string, Fields extends Struct.Fields>(
    tag: Tag,
    fieldsOr: Fields | HasFields<Fields>,
    annotations?: ClassAnnotations<...>
  ): [Self] extends [never] ? MissingSelfGeneric<"TaggedClass"> : ...
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schema.ts:8713-8717` — `Schema.Class` generates a class with Schema encode/decode support
- `repos/effect/packages/effect/src/Schema.ts:8771-8776` — `Schema.TaggedClass` adds a `_tag` discriminant field automatically

**When to use:** Use `Schema.Class` when you need domain model objects that carry methods (e.g., `user.fullName()`), or when you want constructor validation — `new User({ name: "Alice", age: -1 })` throws a parse error if the schema doesn't pass. Use `Schema.TaggedClass` for discriminated union members that also need schema encode/decode support.

**When NOT to use:** Don't use `Schema.Class` for simple data transfer objects that don't need methods — `Schema.Struct` is lighter. Don't use it for value objects that need structural equality — `Schema.Class` instances use reference equality by default; combine with `Data.Class` or implement `Equal` if you need `equals`.

**Anti-pattern it replaces:** Separate DTO classes with hand-written validators: `class UserDto { static parse(raw: unknown): User { if (typeof raw.name !== 'string') throw ... } }` — `Schema.Class` generates the validator and the constructor in one declaration with typed parse errors.

**Related:** [`Schema.Struct`](#schemastruct), [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](#datastruct--tuple--array--class--taggedclass), [`Data.TaggedError`](#datataggederror)

### `Schema.brand` / `filter` — constraints

**Signature:**
```ts
export const brand = <S extends Schema.Any, B extends string | symbol>(
  brand: B,
  annotations?: Annotations.Schema<Schema.Type<S> & Brand<B>>
) => (self: S): BrandSchema<Schema.Type<S> & Brand<B>, Schema.Encoded<S>, Schema.Context<S>>

export function filter<A, B extends A>(
  refinement: (a: A, options: ParseOptions, self: AST.Refinement) => a is B,
  annotations?: Annotations.Filter<B, A>
): <I, R>(self: Schema<A, I, R>) => refine<B, Schema<A, I, R>>
export function filter<S extends Schema.Any>(
  predicate: (a: Types.NoInfer<Schema.Type<S>>, options: ParseOptions, self: AST.Refinement) => FilterReturnType,
  annotations?: Annotations.Filter<Types.NoInfer<Schema.Type<S>>>
): (self: S) => filter<S>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schema.ts:3197-3200` — `brand` attaches a nominal brand to a schema type
- `repos/effect/packages/effect/src/Schema.ts:3695-3711` — `filter` adds a predicate-based refinement to a schema
- `repos/effect/packages/cluster/src/EntityId.ts:10-10` — `Schema.brand` used to mark a `string` as a typed `EntityId` (usage example: `Schema.NonEmptyTrimmedString.pipe(Schema.brand("EntityId"))`)

**When to use:** Use `Schema.brand` to create nominal types like `UserId`, `EmailAddress`, `PositiveInt` — types that are structurally `string` or `number` but cannot be accidentally passed where the branded version is required. Use `Schema.filter` to add runtime constraints that can't be expressed as a type (e.g., "integer between 1 and 100", "non-empty string"). Combine them for validated nominal types.

**When NOT to use:** Don't use `Schema.brand` when the distinction is already captured by a different structural type — only brand when you need nominal safety for types that look the same. Don't use `Schema.filter` for complex transformations — use `Schema.transform` instead; `filter` is only for yes/no predicates on the same type.

**Anti-pattern it replaces:** Type aliases that provide false safety: `type UserId = string` — this doesn't prevent `sendEmail(userId)` where `sendEmail` expects `EmailAddress`. `Schema.brand` makes the type actually distinct: passing a `string` where `UserId` is required is a type error.

**Related:** [`Schema.Struct`](#schemastruct), [`Brand.nominal` / `refined` / `all`](#brandnominal--refined--all), [`Schema.transform` / `transformOrFail`](#schematransform--transformorfail)

### `Schema.transform` / `transformOrFail`

**Signature:**
```ts
export const transform: {
  <To extends Schema.Any, From extends Schema.Any>(
    to: To,
    options: {
      readonly decode: (fromA: Schema.Type<From>, fromI: Schema.Encoded<From>) => Schema.Encoded<To>
      readonly encode: (toI: Schema.Encoded<To>, toA: Schema.Type<To>) => Schema.Type<From>
    }
  ): (self: From) => transform<From, To>
  ...
}

export const transformOrFail: {
  <To extends Schema.Any, From extends Schema.Any, RD, RE>(
    to: To,
    options: {
      readonly decode: (fromA: Schema.Type<From>, ...) => Effect.Effect<Schema.Encoded<To>, ParseResult.ParseError, RD>
      readonly encode: ...
    }
  ): (self: From) => transformOrFail<From, To, RD | RE>
  ...
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schema.ts:3940-3948` — `transform` maps between two schemas with pure functions
- `repos/effect/packages/effect/src/Schema.ts:3831-3838` — `transformOrFail` maps between schemas with effectful (fallible) decode/encode

**When to use:** Use `Schema.transform` when the wire format differs from the domain type and the conversion is pure — for example, mapping an ISO date string (encoded) to a `Date` object (decoded), or mapping a snake_case API response to a camelCase domain object. Use `transformOrFail` when the transformation can fail, such as parsing a string into a validated struct.

**When NOT to use:** Don't use `transform` for constraints alone — use `filter` or `brand` for predicates. Don't use `transformOrFail` for async lookups (database calls to validate an ID exists) — schemas are meant to be run as synchronous validation, not as Effects with service dependencies.

**Anti-pattern it replaces:** Writing separate `toWire()` and `fromWire()` functions on a class: `User.fromWire(raw: unknown)` and `user.toWire()` with no shared type guarantee. `Schema.transform` encodes both directions in one place and ensures they are inverses.

**Related:** [`Schema.brand` / `filter` — constraints`](#schemabrand--filter--constraints), [`Schema.decode` / `encode` / `is` entry points](#schemadecode--encode--is-entry-points), [`Schema.Struct`](#schemastruct)

### `Schema.decode` / `encode` / `is` entry points

**Signature:**
```ts
export const decode: <A, I, R>(
  schema: Schema<A, I, R>,
  options?: ParseOptions
) => (i: I, overrideOptions?: ParseOptions) => Effect.Effect<A, ParseResult.ParseError, R>

export const encode: <A, I, R>(
  schema: Schema<A, I, R>,
  options?: ParseOptions
) => (a: A, overrideOptions?: ParseOptions) => Effect.Effect<I, ParseResult.ParseError, R>

export const decodeUnknown: <A, I, R>(
  schema: Schema<A, I, R>,
  options?: ParseOptions
) => (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<A, ParseResult.ParseError, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schema.ts:534-537` — `encode` converts typed value → encoded form as an Effect
- `repos/effect/packages/effect/src/Schema.ts:599-607` — `decode` converts encoded form → typed value as an Effect
- `repos/effect/packages/effect/src/Schema.ts:561-565` — `decodeUnknown` accepts `unknown` input, useful at API boundaries

**When to use:** Use `Schema.decodeUnknown(MySchema)` at every external boundary where data enters your application — HTTP request bodies, JSON files, environment variables, database query results. Use `Schema.decode` when the input is already typed to the schema's encoded form. Use `Schema.encode` when serializing domain objects back to their wire format for responses or storage.

**When NOT to use:** Don't call `Schema.decode` in hot paths without caching — decoding allocates parse error objects even on the happy path. Use `Schema.is` (a type predicate) for runtime type guards when you don't need the full parse error, just a boolean.

**Anti-pattern it replaces:** `JSON.parse(body)` followed by manual property checks: `if (typeof body.name !== 'string') throw new Error(...)` — untyped, repetitive, error messages are poor. `Schema.decodeUnknown(MySchema)(JSON.parse(body))` returns a typed `ParseError` with full field-level detail.

**Related:** [`Schema.Struct`](#schemastruct), [`Schema.transform` / `transformOrFail`](#schematransform--transformorfail), [`Schema.brand` / `filter` — constraints`](#schemabrand--filter--constraints)

## Streams & Concurrency

### `Stream.make` / `fromIterable` / `fromEffect`

**Signature:**
```ts
export const make: <As extends Array<any>>(...as: As) => Stream<As[number]>
export const fromIterable: <A>(iterable: Iterable<A>) => Stream<A>
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Stream<A, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Stream.ts:2700-2700` — `make` creates a finite stream from varargs
- `repos/effect/packages/effect/src/Stream.ts:2086-2087` — `fromIterable` creates a pure stream from any iterable
- `repos/effect/packages/effect/src/Stream.ts:2019-2019` — `fromEffect` emits a single value produced by an Effect

**When to use:** Use `Stream.make(a, b, c)` for small finite sequences in tests or static data. Use `Stream.fromIterable(arr)` when you have an existing in-memory collection to process as a stream. Use `Stream.fromEffect(effect)` to turn a single-valued Effect into a one-element stream — useful when composing stream pipelines where one source is a single DB query result.

**When NOT to use:** Don't use `Stream.fromIterable` for large arrays that are already in memory when you just need `Array.map/filter` — use those directly. Don't use `Stream.fromEffect` just to flatten a stream of Effects — use `Stream.flatMap` instead.

**Anti-pattern it replaces:** Converting an array to an Observable or async generator with boilerplate: `async function* fromArray(arr) { for (const x of arr) yield x; }` — `Stream.fromIterable(arr)` is one line, typed, and integrates with Effect's interruption and resource management.

**Related:** [`Stream.async*` family](#streamasync-family-asyncpush-fromasynciterable), [`Stream.paginate`](#streampaginate), [`.from*` family](#from-family)

### `Stream.async*` family (`asyncPush`, `fromAsyncIterable`)

**Signature:**
```ts
export const asyncPush: <A, E = never, R = never>(
  register: (emit: Emit.EmitOpsPush<E, A>) => Effect.Effect<unknown, E, R | Scope.Scope>,
  options?: { readonly bufferSize: "unbounded" } | { readonly bufferSize?: number | undefined }
) => Stream<A, E, Exclude<R, Scope.Scope>>

export const fromAsyncIterable: <A, E>(
  iterable: AsyncIterable<A>,
  onError: (e: unknown) => E
) => Stream<A, E>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Stream.ts:415-419` — `asyncPush` creates a stream that emits values pushed from a callback/event handler
- `repos/effect/packages/effect/src/Stream.ts:1903-1904` — `fromAsyncIterable` wraps an `AsyncIterable` (e.g., `for await` sources) into a Stream

**When to use:** Use `Stream.asyncPush` for event-driven sources — WebSocket messages, DOM events, Redis Pub/Sub channels, or any callback-based emitter. The `register` function receives an `emit` handle and returns an Effect that runs for the stream's lifetime; returning from that Effect closes the stream. Use `Stream.fromAsyncIterable` when the source already exposes an async iterator (`for await...of`).

**When NOT to use:** Don't use `asyncPush` for pull-based paginated APIs — use `Stream.paginate` instead. Don't use `fromAsyncIterable` for sources that also need resource cleanup beyond what the iterator provides — wrap them in `acquireRelease` instead.

**Anti-pattern it replaces:** Converting EventEmitter to an Observable manually: `new Observable(observer => { emitter.on('data', x => observer.next(x)); emitter.on('error', e => observer.error(e)); return () => emitter.off('data', ...) })` — `asyncPush` does the same with Effect's typed error channel and structured scope for cleanup.

**Related:** [`Stream.make` / `fromIterable` / `fromEffect`](#streammake--fromiterable--fromeffect), [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](#streamfrompubsub--fromqueue--fromschedule--groupby), [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease)

### `Stream.paginate`

**Signature:**
```ts
export const paginate: <S, A>(
  s: S,
  f: (s: S) => readonly [A, Option.Option<S>]
) => Stream<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Stream.ts:3380-3380` — unfolds a paginated data source; returns `[element, Some(nextCursor)]` or `[element, None]` to terminate

**When to use:** Use `Stream.paginate` for cursor-based or page-based APIs — GitHub's `Link: rel="next"` pagination, DynamoDB's `LastEvaluatedKey`, any API where you get the next page's cursor from the current response. The unfold state `S` carries the cursor; returning `None` stops the stream.

**When NOT to use:** Don't use `paginate` for offset-based pagination when you don't know upfront how many items exist — `Stream.unfold` is more general. Don't use it when each "page" is itself a stream of items (nested); use `Stream.flatMap` to flatten after paginating.

**Anti-pattern it replaces:** A recursive async function that accumulates results: `async function fetchAll(cursor?) { const { items, next } = await api.list(cursor); return next ? [...items, ...await fetchAll(next)] : items; }` — this loads everything into memory before returning. `paginate` produces items lazily, enabling backpressure and early termination.

**Related:** [`Stream.async*` family`](#streamasync-family-asyncpush-fromasynciterable), [`Stream.make` / `fromIterable` / `fromEffect`](#streammake--fromiterable--fromeffect), [`Cache.make` / `ScopedCache.make`](#cachemake--scopedcachemake--effect-based-memoization)

### `Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`

**Signature:**
```ts
export const fromPubSub: {
  <A>(pubsub: PubSub.PubSub<A>): Stream<A, never, Scope.Scope>
  ...
}

export const fromQueue: <A>(
  queue: Queue.Dequeue<A>,
  options?: { readonly shutdown?: boolean | undefined }
) => Stream<A, never, never>

export const fromSchedule: <A, R>(schedule: Schedule.Schedule<A, unknown, R>) => Stream<A, never, R>

export const groupBy: {
  <A, K, V, E2, R2>(f: (a: A) => Effect.Effect<readonly [K, V], E2, R2>): ...
  ...
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Stream.ts:2041-2044` — `fromPubSub` subscribes to a PubSub and drains its messages
- `repos/effect/packages/effect/src/Stream.ts:2148-2151` — `fromQueue` drains a Queue into a Stream
- `repos/effect/packages/effect/src/Stream.ts:2231-2232` — `fromSchedule` ticks on a schedule
- `repos/effect/packages/effect/src/Stream.ts:2283-2286` — `groupBy` partitions stream elements into keyed sub-streams

**When to use:** Use `fromPubSub` when you want multiple subscribers to receive the same broadcast messages as a stream (fan-out). Use `fromQueue` to turn a worker queue into a stream that processes items as they arrive — the standard pattern for queue-based worker loops. Use `fromSchedule` to create a tick stream for polling: `Stream.fromSchedule(Schedule.spaced("5 seconds"))`. Use `groupBy` to partition a stream by key and process each group independently in parallel.

**When NOT to use:** Don't use `fromQueue` when you only have one consumer and want backpressure — a bounded `Queue` already provides backpressure. Don't use `fromPubSub` if you need guaranteed delivery (messages emitted before subscription are lost) — use a persistent queue or `Mailbox`. Don't use `groupBy` when the number of keys is unbounded without a limit — each group spawns a fiber.

**Anti-pattern it replaces:** `setInterval(() => processQueue(), 1000)` for polling — no backpressure, no error handling, no clean shutdown. `Stream.fromSchedule(Schedule.spaced("1 second")).flatMap(() => processQueue)` integrates fully with Effect's lifecycle.

**Related:** [`PubSub` — multi-subscriber broadcast](#pubsub--multi-subscriber-broadcast), [`Queue` — unbounded / bounded / sliding / dropping](#queue--unbounded--bounded--sliding--dropping), [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](#schedulespaced--exponential--fixed--recurs)

### `Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`

**Signature:**
```ts
export const fork: <A, E, R>(self: Effect<A, E, R>) => Effect<Fiber.RuntimeFiber<A, E>, never, R>
export const forkDaemon: <A, E, R>(self: Effect<A, E, R>) => Effect<Fiber.RuntimeFiber<A, E>, never, R>
export const forkScoped: <A, E, R>(self: Effect<A, E, R>) => Effect<Fiber.RuntimeFiber<A, E>, never, Scope.Scope | R>
export const forkIn: {
  (scope: Scope.Scope): <A, E, R>(self: Effect<A, E, R>) => Effect<Fiber.RuntimeFiber<A, E>, never, R>
  <A, E, R>(self: Effect<A, E, R>, scope: Scope.Scope): Effect<Fiber.RuntimeFiber<A, E>, never, R>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:6283-6284` — `fork` starts a fiber scoped to the current fiber
- `repos/effect/packages/effect/src/Effect.ts:6334-6335` — `forkDaemon` starts a fiber scoped to the root (not interrupted by parent)
- `repos/effect/packages/effect/src/Effect.ts:6506-6507` — `forkScoped` ties the fiber to the current Scope
- `repos/effect/packages/effect/src/Effect.ts:6433-6435` — `forkIn` ties the fiber to an explicit Scope

**When to use:** Use `fork` when you want to run two Effects concurrently and the child fiber's lifetime is bounded by the parent — the standard pattern for structured concurrency. Use `forkDaemon` for background services (heartbeats, metric reporters) that must continue even if the spawning fiber completes. Use `forkScoped` inside a `Layer` or resource block to tie a background fiber to the layer's scope so it stops when the layer tears down. Use `forkIn` when you need explicit control over which scope owns the fiber.

**When NOT to use:** Don't use `forkDaemon` casually — daemon fibers can leak if the program exits without draining them. For most concurrent workflows, prefer `Effect.all({ concurrency: n })` which handles fiber management automatically. Don't use `fork` + manual `join` when `Effect.race` or `Effect.raceFirst` is what you want.

**Anti-pattern it replaces:** `Promise` fire-and-forget: `someAsyncFn().catch(console.error)` — the error is swallowed, the promise is not joined, and there is no way to cancel it. `fork` gives you a `Fiber` handle you can `join` or `interrupt`, with errors propagated structurally.

**Related:** [`Fiber — joining, interrupting, racing`](#fiber--joining-interrupting-racing-effectfork-return-type), [`Structured concurrency via Scope`](#structured-concurrency-via-scope), [`FiberSet` / `FiberMap` / `FiberHandle`](#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking)

### Fiber — joining, interrupting, racing (Effect.fork return type)

**Signature:**
```ts
export const join: <A, E>(self: Fiber<A, E>) => Effect.Effect<A, E>
export const interrupt: <A, E>(self: Fiber<A, E>) => Effect.Effect<Exit.Exit<A, E>>
export const all: <A, E>(fibers: Iterable<Fiber<A, E>>) => Fiber<ReadonlyArray<A>, E>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Fiber.ts:527-527` — `join` awaits a fiber's completion and extracts its value
- `repos/effect/packages/effect/src/Fiber.ts:451-451` — `interrupt` sends an interruption signal and waits for exit
- `repos/effect/packages/effect/src/Fiber.ts:378-378` — `all` creates a composite fiber that joins all fibers in a collection

**When to use:** Use `Fiber.join(fiber)` to await a forked fiber's result and re-raise any errors. Use `Fiber.interrupt(fiber)` to cancel a background computation — for example, cancelling a slow search when the user types again. Use `Fiber.all(fibers)` to race or join a dynamic collection of fibers (e.g., processing a batch where the count is unknown at compile time).

**When NOT to use:** Don't use `Fiber.interrupt` as a substitute for proper resource cleanup — always use `Scope` or `acquireRelease` to ensure finalizers run. Don't manually manage a collection of fibers with `Fiber.all` when `FiberSet` handles lifecycle automatically.

**Anti-pattern it replaces:** `AbortController` + `AbortSignal` passed through every function call to cancel async work: `const ac = new AbortController(); fetch(url, { signal: ac.signal }); ac.abort()` — `Fiber.interrupt` cancels the entire fiber tree, including nested Effects, automatically.

**Related:** [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin), [`FiberSet` / `FiberMap` / `FiberHandle`](#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking), [`Deferred` — one-shot async value](#deferred--one-shot-async-value)

### FiberId — fiber identity and lineage

**Signature:**
```ts
export const make: (id: number, startTimeSeconds: number) => FiberId
export const none: None
export const composite: (left: FiberId, right: FiberId) => Composite
```

**Where it appears:**
- `repos/effect/packages/effect/src/FiberId.ts:162-162` — `make` creates a runtime fiber ID with a timestamp
- `repos/effect/packages/effect/src/FiberId.ts:71-71` — `none` is the empty/sentinel fiber ID
- `repos/effect/packages/effect/src/FiberId.ts:83-83` — `composite` merges two fiber IDs (for parallel forks)

**When to use:** Use `FiberId` when implementing observability or debugging tools — a Supervisor that logs which fiber spawned which, or a trace system that annotates spans with fiber IDs. In most application code you never construct `FiberId` directly; the runtime assigns IDs automatically.

**When NOT to use:** Don't use `FiberId` as an application-level correlation ID — it is a runtime artifact, not a domain concept. For request tracing, use `Effect.withSpan` and the tracer instead.

**Anti-pattern it replaces:** Thread IDs or task IDs in a thread-pool executor for debugging: `Thread.currentThread().getId()` — `FiberId` provides the same identity concept but for Effect's cooperative fiber scheduler.

**Related:** [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin), [`Supervisor — observe and react to fiber lifecycle`](#supervisor--observe-and-react-to-fiber-lifecycle)

### Supervisor — observe and react to fiber lifecycle

**Signature:**
```ts
export interface Supervisor<out T> extends Supervisor.Variance<T> {
  readonly value: Effect.Effect<T>
  onStart<A, E, R>(context: Context.Context<R>, effect: Effect.Effect<A, E, R>, parent: Option.Option<Fiber.RuntimeFiber<any, any>>, fiber: Fiber.RuntimeFiber<A, E>): void
  onEnd<A, E>(value: Exit.Exit<A, E>, fiber: Fiber.RuntimeFiber<A, E>): void
}

export const track: Effect.Effect<Supervisor<Array<Fiber.RuntimeFiber<any, any>>>>
export const fromEffect: <A>(effect: Effect.Effect<A>) => Supervisor<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Supervisor.ts:36-58` — `Supervisor` interface definition with lifecycle hooks
- `repos/effect/packages/effect/src/Supervisor.ts:141-141` — `track` creates a supervisor that collects all live fibers
- `repos/effect/packages/effect/src/Supervisor.ts:125-125` — `fromEffect` builds a supervisor from a polling Effect

**When to use:** Use `Supervisor.track` in tests to assert that all fibers have terminated (no leaks) after a test completes. Use a custom `Supervisor` for production APM instrumentation — counting active fibers, measuring fiber lifetimes, or detecting fiber starvation. Attach a supervisor with `Effect.supervised(supervisor)(effect)`.

**When NOT to use:** Don't use `Supervisor` for application business logic — it is an observability and testing tool. Don't implement rate limiting or concurrency control with a Supervisor; use `Semaphore` or `Effect.all({ concurrency: n })` instead.

**Anti-pattern it replaces:** `process.on('uncaughtException', ...)` and similar global hooks for tracking async tasks — these have no access to which Promise spawned which, and cannot track hierarchies. A `Supervisor` sees the full fiber tree with parent-child relationships.

**Related:** [`FiberId — fiber identity and lineage`](#fiberid--fiber-identity-and-lineage), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin), [`FiberSet` / `FiberMap` / `FiberHandle`](#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking)

### Structured concurrency via `Scope`

**Signature:**
```ts
export const make: (executionStrategy?: ExecutionStrategy.ExecutionStrategy) => Effect.Effect<CloseableScope>
export const fork: (self: Scope, strategy: ExecutionStrategy.ExecutionStrategy) => Effect.Effect<CloseableScope>
export const close: (self: CloseableScope, exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Scope.ts:202-204` — `Scope.make` creates a closeable scope for resource management
- `repos/effect/packages/effect/src/Scope.ts:175-177` — `Scope.fork` creates a child scope
- `repos/effect/packages/effect/src/Scope.ts:152-152` — `Scope.close` finalizes all resources registered with the scope

**When to use:** Use the `Scope` pattern (via `Effect.scoped`, `acquireRelease`, or `Layer.scoped`) whenever you need automatic resource cleanup — the scope is the mechanism that ensures finalizers run on success, failure, and interruption. Reach for `Scope.make` + `Scope.close` only when you are building low-level combinators that need manual scope control.

**When NOT to use:** Don't use `Scope.make` directly in application code — prefer `Effect.scoped(effect)` which creates, uses, and closes a scope automatically. Don't rely on `Scope.fork` manually; `forkScoped` on a fiber does this for you.

**Anti-pattern it replaces:** `try/finally` blocks for resource cleanup: `const conn = await db.connect(); try { return await query(conn); } finally { await conn.close(); }` — this doesn't compose (you can't add more resources without nesting), and it doesn't handle interruption. `acquireRelease(db.connect(), conn => conn.close())` composes cleanly.

**Related:** [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease), [`Layer.scoped` (resource layers)](#layerscoped-resource-layers), [`RcRef` and `RcMap`](#rcref-and-rcmap--reference-counted-resources)

### Channel — bidirectional stream primitive (Stream's underlying type)

**Signature:**
```ts
export interface Channel<
  out Elem,
  in InElem = unknown,
  out Err = never,
  in InErr = unknown,
  out Done = unknown,
  in InDone = unknown,
  out Env = never
> { ... }

export const succeed: <A>(value: A) => Channel<never, unknown, never, unknown, A, unknown>
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Channel<never, unknown, E, unknown, A, unknown, R>
export const identity: <Elem, Err, Done>() => Channel<Elem, Elem, Err, Err, Done, Done>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Channel.ts:75-85` — `Channel` interface definition (bidirectional typed pipe)
- `repos/effect/packages/effect/src/Channel.ts:2015-2015` — `succeed` creates a channel that completes immediately with a value
- `repos/effect/packages/effect/src/Channel.ts:1084-1086` — `fromEffect` lifts an Effect into a Channel
- `repos/effect/packages/effect/src/Channel.ts:1151-1151` — `identity` passes all inputs through unchanged

**When to use:** Use `Channel` when you are implementing a custom `Stream` or `Sink` combinator that `Stream`'s high-level API doesn't provide — for example, a custom framing protocol over a TCP byte stream. `Stream` and `Sink` are built on `Channel` internally, so you rarely need to reach for it directly.

**When NOT to use:** Don't use `Channel` for application-level streaming — the high-level `Stream` API covers almost every use case. Don't build `Channel` pipelines directly just to process arrays — use `Stream` with its richer combinator set. If you find yourself writing `Channel` code in a business logic module, there is almost certainly a `Stream` or `Sink` combinator that does what you need.

**Anti-pattern it replaces:** Low-level `Transform` stream implementations in Node.js: `class MyTransform extends Transform { _transform(chunk, enc, cb) { ... } }` — fragile, untyped, and manual. `Channel` (or `Stream`) provides a typed, composable alternative.

**Related:** [`Sink — Stream consumer / aggregator`](#sink--stream-consumer--aggregator), [`Stream.make` / `fromIterable` / `fromEffect`](#streammake--fromiterable--fromeffect), [`Stream.async*` family`](#streamasync-family-asyncpush-fromasynciterable)

### Sink — Stream consumer / aggregator

**Signature:**
```ts
export interface Sink<out A, in In = unknown, out L = never, out E = never, out R = never> { ... }

export const drain: Sink<void, unknown>
export const fold: <S, In>(s: S, contFn: Predicate<S>, f: (s: S, input: In) => S) => Sink<S, In, In>
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Sink<A, unknown, never, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Sink.ts:48-50` — `Sink` interface definition
- `repos/effect/packages/effect/src/Sink.ts:442-442` — `drain` consumes all elements and discards them
- `repos/effect/packages/effect/src/Sink.ts:651-651` — `fold` accumulates stream elements into a summary value
- `repos/effect/packages/effect/src/Sink.ts:992-993` — `fromEffect` creates a sink from a constant Effect result

**When to use:** Use `Sink.drain` to run a stream for its side effects and discard the values. Use `Sink.fold` to aggregate a stream into a summary — total, count, or any accumulator. Use `Sink.fromEffect` when the "consumption" of the stream is a fixed Effect that ignores the actual stream elements (rare).

**When NOT to use:** Don't use `Sink` for simple terminal operations on a finite stream — `Stream.runFold`, `Stream.runCollect`, and `Stream.runForEach` are more ergonomic one-liners that wrap the corresponding Sink. Use `Sink` directly only when you need to compose multiple sinks (e.g., `Sink.zip` to drain and count simultaneously).

**Anti-pattern it replaces:** `let total = 0; for await (const chunk of stream) { total += chunk.length; }` — manual accumulation with no backpressure or error propagation. `stream.pipe(Stream.run(Sink.fold(0, () => true, (acc, x) => acc + x.length)))` is composable and integrates with Effect's error channel.

**Related:** [`Channel — bidirectional stream primitive`](#channel--bidirectional-stream-primitive-streams-underlying-type), [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](#streamfrompubsub--fromqueue--fromschedule--groupby), [`Stream.make` / `fromIterable` / `fromEffect`](#streammake--fromiterable--fromeffect)

## Resources & Scope

### `Effect.acquireRelease` / `acquireUseRelease`

**Signature:**
```ts
export const acquireRelease: {
  <A, X, R2>(
    release: (a: A, exit: Exit.Exit<unknown, unknown>) => Effect<X, never, R2>
  ): <E, R>(acquire: Effect<A, E, R>) => Effect<A, E, Scope.Scope | R2 | R>
  ...
}

export const acquireUseRelease: {
  <A2, E2, R2, A, X, R3>(
    use: (a: A) => Effect<A2, E2, R2>,
    release: (a: A, exit: Exit.Exit<A2, E2>) => Effect<X, never, R3>
  ): <E, R>(acquire: Effect<A, E, R>) => Effect<A2, E | E2, R | R2 | R3>
  ...
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:5453-5458` — `acquireRelease` registers a cleanup action into the current `Scope`
- `repos/effect/packages/effect/src/Effect.ts:5550-5555` — `acquireUseRelease` manages a resource for a `use` block, then releases it regardless of outcome

**When to use:** Use `acquireRelease(acquire, release)` for any resource that must be cleaned up — database connections, file handles, temporary directories, network sockets. The `release` function runs on success, failure, and interruption. Use `acquireUseRelease(acquire, use, release)` when you want a "bracket" pattern: acquire → use → release, where the resource doesn't escape the `use` block.

**When NOT to use:** Don't use `acquireUseRelease` when the resource needs to outlive a single operation — use `acquireRelease` inside a `Scope` (via `Effect.scoped` or `Layer.scoped`) so the scope controls the lifetime. Don't use these for resources that Effect already manages (e.g., don't manually acquire/release a `Pool` item — use `Pool.get` which handles it).

**Anti-pattern it replaces:** `try/finally` and `using` keyword patterns: `const handle = fs.openSync(path); try { return process(handle); } finally { fs.closeSync(handle); }` — this doesn't handle async operations, doesn't compose with other resources, and is lost on interruption. `acquireRelease` handles all cases.

**Related:** [`Structured concurrency via Scope`](#structured-concurrency-via-scope), [`Layer.scoped` (resource layers)](#layerscoped-resource-layers), [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](#poolmake--poolmakewithttl-and-keyedpool)

### `Layer.scoped` (resource layers)

**Signature:**
```ts
export const scoped: {
  <I, S>(tag: Context.Tag<I, S>): <E, R>(effect: Effect.Effect<Types.NoInfer<S>, E, R>) => Layer<I, E, Exclude<R, Scope.Scope>>
  <I, S, E, R>(tag: Context.Tag<I, S>, effect: Effect.Effect<Types.NoInfer<S>, E, R>): Layer<I, E, Exclude<R, Scope.Scope>>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Layer.ts:727-735` — wraps a scoped acquisition into a Layer; scope is managed by the Layer's own lifetime

**When to use:** Use `Layer.scoped(Tag, acquireRelease(...))` for any service that owns a resource — a database connection pool, a gRPC channel, a Redis client. The layer acquires the resource on startup and releases it when the application shuts down. This is the standard pattern for any service with a lifecycle.

**When NOT to use:** Don't use `Layer.scoped` for resources that should be acquired and released per-request — those belong in `Effect.scoped` inside the request handler. Don't use it when the service has no cleanup (use `Layer.effect` instead).

**Anti-pattern it replaces:** Global initialization with a `close()` call in a `process.on('SIGTERM', ...)` handler: `const pool = new PgPool(); process.on('SIGTERM', () => pool.end())` — this misses `SIGINT`, crashes, and other termination signals. `Layer.scoped` integrates cleanup into Effect's managed shutdown.

**Related:** [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease), [`Layer.succeed` / `effect` / `scoped`](#layersucceed--effect--scoped--layer-constructors), [`Structured concurrency via Scope`](#structured-concurrency-via-scope)

### `Scope.make` / `Scope.fork` / `Scope.close`

**Signature:**
```ts
export const make: (executionStrategy?: ExecutionStrategy.ExecutionStrategy) => Effect.Effect<CloseableScope>
export const fork: (self: Scope, strategy: ExecutionStrategy.ExecutionStrategy) => Effect.Effect<CloseableScope>
export const close: (self: CloseableScope, exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Scope.ts:202-204` — `make` creates a top-level scope
- `repos/effect/packages/effect/src/Scope.ts:175-177` — `fork` creates a child scope that will be closed when the parent closes
- `repos/effect/packages/effect/src/Scope.ts:152-152` — `close` runs all registered finalizers

**When to use:** Use `Scope.make` / `Scope.close` only when writing Effect library code that needs to create a scope manually — for example, when integrating Effect with a framework that has its own lifecycle and you need to close the scope explicitly on framework shutdown. In application code, prefer `Effect.scoped(effect)` which wraps scope creation and closing automatically.

**When NOT to use:** Don't use `Scope.make` + `Scope.close` in business logic — the higher-level patterns (`acquireRelease`, `Effect.scoped`, `Layer.scoped`) handle this more safely. Forgetting to call `Scope.close` on error is a resource leak.

**Anti-pattern it replaces:** Manual cleanup tracking with a list of teardown functions: `const cleanups = []; cleanups.push(() => conn.close()); // ... later: await Promise.all(cleanups.map(f => f()))` — `Scope` handles ordering (LIFO), error handling, and parallelism in finalizers automatically.

**Related:** [`Structured concurrency via Scope`](#structured-concurrency-via-scope), [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease), [`Layer.scoped` (resource layers)](#layerscoped-resource-layers)

### `RcRef` and `RcMap` — reference-counted resources

**Signature:**
```ts
// RcRef.make
export const make: <A, E, R>(
  options: {
    readonly acquire: Effect.Effect<A, E, R>
    readonly idleTimeToLive?: Duration.DurationInput | undefined
  }
) => Effect.Effect<RcRef<A, E>, never, Scope.Scope | R>

// RcMap.make
export const make: {
  <K, A, E, R>(
    options: {
      readonly lookup: (key: K) => Effect.Effect<A, E, R>
      readonly idleTimeToLive?: Duration.DurationInput | ((key: K) => Duration.DurationInput) | undefined
      readonly capacity?: undefined
    }
  ): Effect.Effect<RcMap<K, A, E>, never, Scope.Scope | R>
  ...
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/RcRef.ts:100-105` — `RcRef.make` creates a reference-counted handle to a single resource
- `repos/effect/packages/effect/src/RcMap.ts:85-90` — `RcMap.make` creates a reference-counted map for per-key resources

**When to use:** Use `RcRef` when multiple consumers need to share a single expensive resource (e.g., a database connection or TLS context) and you want the resource to be released only when the last consumer is done — without a fixed pool size. Use `RcMap` for the same pattern but keyed — per-host TLS contexts, per-tenant configs. Both support `idleTimeToLive` for automatic eviction of unused resources.

**When NOT to use:** Don't use `RcRef` when you need a fixed-size pool with concurrency limits — use `Pool.make` instead. Don't use `RcMap` when the number of keys is bounded and known at startup — a fixed set of `Layer`s is simpler.

**Anti-pattern it replaces:** Manual reference counting: `let refCount = 0; let sharedConn; function acquire() { if (!sharedConn) sharedConn = createConn(); refCount++; return sharedConn; } function release() { if (--refCount === 0) sharedConn.close(); }` — this has race conditions in async code. `RcRef` handles this atomically.

**Related:** [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](#poolmake--poolmakewithttl-and-keyedpool), [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease), [`LayerMap — keyed map of layers`](#layermap--keyed-map-of-layers-per-tenant--per-request)

### `Pool.make` / `Pool.makeWithTTL` and `KeyedPool`

**Signature:**
```ts
export const make: <A, E, R>(
  options: {
    readonly acquire: Effect.Effect<A, E, R>
    readonly size: number
    readonly concurrency?: number | undefined
    readonly targetUtilization?: number | undefined
  }
) => Effect.Effect<Pool<A, E>, never, Scope.Scope | R>

export const makeWithTTL: <A, E, R>(
  options: {
    readonly acquire: Effect.Effect<A, E, R>
    readonly min: number
    readonly max: number
    ...
  }
) => Effect.Effect<Pool<A, E>, never, Scope.Scope | R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Pool.ts:115-121` — `Pool.make` creates a fixed-size resource pool
- `repos/effect/packages/effect/src/Pool.ts:171-177` — `makeWithTTL` creates a pool with min/max sizing and TTL eviction
- `repos/effect/packages/effect/src/KeyedPool.ts:73-78` — `KeyedPool.make` creates a per-key resource pool (e.g., per-host connection pools)

**When to use:** Use `Pool.make` for database connection pools, HTTP keep-alive pools, or any resource that is expensive to create, safe to reuse, and needed concurrently. Use `makeWithTTL` when you want the pool to scale between a minimum and maximum size based on demand, evicting idle connections after a TTL. Use `KeyedPool` for per-host connection pools (e.g., one pool per upstream service in a service mesh).

**When NOT to use:** Don't use `Pool.make` for resources that are cheap to create per-request (stateless HTTP clients with no connection reuse). Don't use a `Pool` of size 1 to serialize access — use a `Semaphore` with 1 permit instead, which is semantically clearer.

**Anti-pattern it replaces:** Third-party pool libraries like `pg-pool` or `generic-pool` that don't integrate with Effect's error channel or interruption: `pool.connect().then(client => { try { ... } finally { client.release(); } })` — the `finally` isn't called on interruption. `Pool.get` returns a scoped resource that releases on scope close.

**Related:** [`RcRef` and `RcMap`](#rcref-and-rcmap--reference-counted-resources), [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease), [`Semaphore` — async resource limiting](#semaphore--async-resource-limiting)

### ScopedRef — scope-attached mutable reference

**Signature:**
```ts
export const make: <A>(evaluate: LazyArg<A>) => Effect.Effect<ScopedRef<A>, never, Scope.Scope>
```

**Where it appears:**
- `repos/effect/packages/effect/src/ScopedRef.ts:101-102` — `ScopedRef.make` creates a mutable reference whose resources are managed by a Scope; replacing the value releases the old one

**When to use:** Use `ScopedRef` when you need a mutable slot that holds a resource — where updating the slot should automatically close the old resource. The canonical use case is a hot-reloadable connection: replacing the current connection with a new one automatically closes the old one via the scope finalizer.

**When NOT to use:** Don't use `ScopedRef` for simple mutable state with no resource cleanup — use `Ref` instead. Don't use it when you need multiple simultaneous readers accessing the resource concurrently — `RcRef` is better suited for shared ownership.

**Anti-pattern it replaces:** Manually tracking and closing the "old" resource before setting a new one: `if (currentConn) await currentConn.close(); currentConn = await createConn();` — `ScopedRef.set` handles the cleanup atomically.

**Related:** [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`RcRef` and `RcMap`](#rcref-and-rcmap--reference-counted-resources), [`Effect.acquireRelease` / `acquireUseRelease`](#effectacquirerelease--acquireuserelease)

## API style (pipeable, dual)

### Dual data-first / data-last (`dual(...)`) and Pipeable trait

**Signature:**
```ts
export const dual: {
  <DataLast extends (...args: Array<any>) => any, DataFirst extends (...args: Array<any>) => any>(
    arity: Parameters<DataFirst>["length"],
    body: DataFirst
  ): DataLast & DataFirst
  <DataLast extends (...args: Array<any>) => any, DataFirst extends (...args: Array<any>) => any>(
    isDataFirst: (args: IArguments) => boolean,
    body: DataFirst
  ): DataLast & DataFirst
}

export interface Pipeable {
  pipe<A, B>(this: A, ab: (a: A) => B): B
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Function.ts:95-105` — `dual` creates a function that works both data-first and data-last (pipeable)
- `repos/effect/packages/effect/src/Pipeable.ts:11-13` — `Pipeable` interface adds `.pipe()` method to any value

**When to use:** Use `dual` when contributing to Effect's ecosystem or building your own Effect-compatible libraries — it allows your combinator to be used both as `f(a, b)` (data-first) and `pipe(a, f(b))` (data-last / curried). Use the `Pipeable` trait on your domain types to enable `.pipe(...)` chaining syntax.

**When NOT to use:** Don't implement `dual` for internal helpers that are only used inside your own module — the overhead isn't worth it. Don't use `dual` when the function always takes exactly one argument (nothing to curry).

**Anti-pattern it replaces:** Providing only a curried form (`f(b)(a)`) or only a data-first form (`f(a, b)`) — forcing users to either wrap everything in `pipe(...)` or abandon the pipeline style. `dual` gives users both options.

**Related:** [`pipe` vs method chaining](#pipe-vs-method-chaining), [`Effect.gen` + `yield*`](#effectgen--yield)

### `pipe` vs method chaining

**Signature:**
```ts
export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
// ... up to 20 overloads
```

**Where it appears:**
- `repos/effect/packages/effect/src/Function.ts:526-534` — `pipe` applies a series of unary functions left-to-right; the functional alternative to method chaining

**When to use:** Use `pipe(value, f, g, h)` when you have a sequence of transformations to apply and the intermediate types are heterogeneous. Use `.pipe(f, g, h)` (method chaining) on Effect types that implement `Pipeable` — it is shorter and most IDEs autocomplete the chained calls. Use `pipe` for plain values where no `.pipe` method exists.

**When NOT to use:** Don't use `pipe` for just one transformation — `f(value)` is cleaner. Don't use `pipe` over `Effect.gen` when you have complex branching logic — `gen` with `yield*` reads more naturally for imperative control flow.

**Anti-pattern it replaces:** Deeply nested function calls: `h(g(f(value)))` — hard to read right-to-left. `pipe(value, f, g, h)` reads left-to-right in the order operations are applied.

**Related:** [`Dual data-first / data-last`](#dual-data-first--data-last-dual-and-pipeable-trait), [`Effect.gen` + `yield*`](#effectgen--yield)

## Data, Equal, Hash, Brand

### `Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`

**Signature:**
```ts
export const struct: <A extends Record<string, any>>(a: A) => { readonly [P in keyof A]: A[P] }
export const tuple = <As extends ReadonlyArray<any>>(...as: As): Readonly<As>
export const array = <As extends ReadonlyArray<any>>(as: As): Readonly<As>

export const Class: new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<{ readonly [P in keyof A]: A[P] }>
) => Readonly<A>

export const TaggedClass = <Tag extends string>(tag: Tag): new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P] }>
) => Readonly<A> & { readonly _tag: Tag }
```

**Where it appears:**
- `repos/effect/packages/effect/src/Data.ts:47-47` — `struct` creates a structurally equatable plain object
- `repos/effect/packages/effect/src/Data.ts:76-76` — `tuple` creates a structurally equatable tuple
- `repos/effect/packages/effect/src/Data.ts:104-104` — `array` creates a structurally equatable array
- `repos/effect/packages/effect/src/Data.ts:203-205` — `Class` makes an equatable class with readonly fields
- `repos/effect/packages/effect/src/Data.ts:232-235` — `TaggedClass` adds a `_tag` discriminant to `Class`

**When to use:** Use `Data.struct` for simple value objects that need structural equality for use as keys in `HashMap` or `HashSet`. Use `Data.Class` when you want a class-based value object with `Equal` semantics — `new Point({ x: 1, y: 2 })` equals another `new Point({ x: 1, y: 2 })` by value. Use `Data.TaggedClass` as the base for domain events or commands that need a discriminant.

**When NOT to use:** Don't use `Data.struct` for objects that contain functions or closures — structural equality won't work correctly. Don't use `Data.Class` when you need schema encode/decode support — use `Schema.Class` instead.

**Anti-pattern it replaces:** Plain objects compared by reference: `const p1 = { x: 1, y: 2 }; const p2 = { x: 1, y: 2 }; p1 === p2 // false` — `HashMap` and `HashSet` use `Equal.equals` for key lookup, so reference-equal objects can't be used as map keys. `Data.struct` enables value-based lookup.

**Related:** [`Data.TaggedEnum` — discriminated union constructors](#datataggedenum--discriminated-union-constructors), [`Equal.equals` interface and `Hash`](#equalequals-interface-and-hash--structural-equality), [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map)

### `Data.TaggedEnum` — discriminated union constructors

**Signature:**
```ts
export type TaggedEnum<
  A extends Record<string, Record<string, any>> & UntaggedChildren<A>
> = keyof A extends infer Tag ?
  Tag extends keyof A ? Types.Simplify<{ readonly _tag: Tag } & { readonly [K in keyof A[Tag]]: A[Tag][K] }>
  : never
  : never

export const taggedEnum: {
  <Z extends TaggedEnum.WithGenerics<1>>(): Types.Simplify<{ readonly [Tag in Z["taggedEnum"]["_tag"]]: <A>(...) => ... }>
  <A extends TaggedEnum<any>>(): { readonly [Tag in A["_tag"]]: (args: ...) => A }
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Data.ts:280-285` — `TaggedEnum` type-level discriminated union shape
- `repos/effect/packages/effect/src/Data.ts:457-469` — `taggedEnum` generates constructors for each variant of the union

**When to use:** Use `Data.TaggedEnum` for state machine states, ADTs, or command/event types where you have a closed set of variants. `taggedEnum` generates constructor functions for each variant (`Circle({ radius: 5 })`, `Square({ side: 3 })`) so you don't write `{ _tag: 'Circle', radius: 5 }` by hand everywhere.

**When NOT to use:** Don't use `TaggedEnum` when the variants need runtime schema validation — use `Schema.Union` of `Schema.TaggedClass` variants instead. Don't use it when the union is open (extended by consumers) — `TaggedEnum` is for closed unions.

**Anti-pattern it replaces:** Manually typed discriminated unions with object literals: `type Shape = { _tag: 'Circle'; radius: number } | { _tag: 'Square'; side: number }` with no constructor enforcement — callers can write `{ _tag: 'Circl', radius: 5 }` (typo) and TypeScript only catches it at the usage site. `taggedEnum` constructors prevent this.

**Related:** [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](#datastruct--tuple--array--class--taggedclass), [`Match.value` / `Match.type`](#matchvalue--matchtype--starting-a-match), [`Data.TaggedError`](#datataggederror)

### `Brand.nominal` / `refined` / `all`

**Signature:**
```ts
export const nominal = <A extends Brand<any>>(): Brand.Constructor<A>

export function refined<A extends Brand<any>>(
  f: (unbranded: Brand.Unbranded<A>) => Option.Option<Brand.BrandErrors>
): Brand.Constructor<A>
export function refined<A extends Brand<any>>(
  refinement: Predicate<Brand.Unbranded<A>>,
  onFailure: (unbranded: Brand.Unbranded<A>) => Brand.BrandErrors
): Brand.Constructor<A>

export const all: <Brands extends readonly [Brand.Constructor<any>, ...Array<Brand.Constructor<any>>]>(
  ...brands: Brand.EnsureCommonBase<Brands>
) => Brand.Constructor<...>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Brand.ts:269-272` — `nominal` creates a cast-only brand with no runtime validation
- `repos/effect/packages/effect/src/Brand.ts:217-229` — `refined` creates a brand with a validation predicate
- `repos/effect/packages/effect/src/Brand.ts:313-316` — `all` intersects multiple brand constructors

**When to use:** Use `Brand.nominal<UserId>()` to create a type-only brand where the underlying value is already validated by other means (e.g., comes from the database as a `uuid` column). Use `Brand.refined<PositiveInt>(n => n > 0, n => Brand.error(`${n} is not positive`))` when the brand requires runtime validation at construction time. Use `Brand.all` to compose multiple brands — `Brand.all(PositiveInt, LessThan100)`.

**When NOT to use:** Don't use `Brand.nominal` at runtime boundaries where you need actual validation — use `Brand.refined` or `Schema.brand`. Don't use `Brand.all` when the brands have incompatible base types.

**Anti-pattern it replaces:** Type aliases without nominal safety: `type UserId = string; type ProductId = string` — these are structurally identical, so `lookupProduct(userId)` is a type error waiting to happen. `Brand.nominal<UserId>()` creates a type that cannot be confused with `ProductId`.

**Related:** [`Schema.brand` / `filter` — constraints`](#schemabrand--filter--constraints), [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](#datastruct--tuple--array--class--taggedclass)

### `Equal.equals` interface and `Hash` — structural equality

**Signature:**
```ts
export interface Equal extends Hash.Hash {
  [symbol](that: Equal): boolean
}

export function equals<B>(that: B): <A>(self: A) => boolean
export function equals<A, B>(self: A, that: B): boolean
```

**Where it appears:**
- `repos/effect/packages/effect/src/Equal.ts:19-21` — `Equal` interface with the `[symbol]` comparison method
- `repos/effect/packages/effect/src/Equal.ts:27-28` — `equals` dual function for structural comparison

**When to use:** Implement `Equal` on your domain types when they will be used as keys in Effect's `HashMap` or `HashSet`, or when you want `Equal.equals(a, b)` to compare by value rather than reference. `Data.struct`, `Data.Class`, and `Data.TaggedClass` implement `Equal` automatically — implement manually only for custom classes.

**When NOT to use:** Don't implement `Equal` on types that should use reference equality (mutable services, open connections, timers). Don't use `Equal.equals` as a substitute for deep-equality in test assertions — use your test framework's matchers (Vitest `deepEqual`) for that.

**Anti-pattern it replaces:** `JSON.stringify(a) === JSON.stringify(b)` for value comparison — fragile (key ordering, circular references), slow, and wrong for types with custom serialization. `Equal.equals(a, b)` uses the type's own equality definition.

**Related:** [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](#datastruct--tuple--array--class--taggedclass), [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map), [`HashSet — structural-equality set`](#hashset--structural-equality-set)

## Module / file conventions

### The `internal/` folder and `index.ts` re-export shape

**Signature:**
```ts
// index.ts re-export pattern
export * as Effect from "./Effect.js"
export * as Layer from "./Layer.js"
// ...

// internal delegation pattern (in Effect.ts)
export const fork: <A, E, R>(self: Effect<A, E, R>) => Effect<Fiber.RuntimeFiber<A, E>, never, R> = fiberRuntime.fork
```

**Where it appears:**
- `repos/effect/packages/effect/src/index.ts:687-687` — `LayerMap` re-export shows the namespaced `export * as` convention
- `repos/effect/packages/effect/src/Effect.ts:6283-6283` — public API delegates to `internal/` implementation

**When to use:** Follow this pattern when building Effect-compatible libraries or packages. Place all implementation details in `internal/` to make them tree-shakeable and to signal they are private contracts. Re-export everything through a single `index.ts` using `export * as Module from "./Module.js"` to give users namespaced access (`import { Effect, Layer } from "effect"`).

**When NOT to use:** Don't replicate this structure in application code (as opposed to library code) — applications typically don't need an `internal/` split, and the namespace re-export pattern is only relevant for published packages.

**Anti-pattern it replaces:** Flat exports where internals and public API are mixed: `export { internalHelper, publicApi }` from the same file — consumers can accidentally import internals, and you can't refactor without breaking the public API contract.

**Related:** [`Dual ESM/CJS export pattern`](#dual-esmcjs-export-pattern), [`JSDoc @since, @category, @example tags`](#jsdoc-since-category-example-tags)

### Dual ESM/CJS export pattern

**Signature:**
```ts
// package.json exports field
{
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    }
  }
}
```

**Where it appears:**
- `repos/effect/packages/effect/package.json:34` — `exports` field with ESM/CJS dual build targets

**When to use:** Use the dual ESM/CJS `exports` field when publishing a library that must work in both Node.js ESM (`import`) and CommonJS (`require`) environments. This is required for packages that are consumed by tools like Jest (CJS by default), Webpack 4, or older Next.js setups while also supporting modern ESM bundlers.

**When NOT to use:** Don't bother with dual builds in applications — only published packages need it. If you control all consumers and they all use ESM, ship ESM-only.

**Anti-pattern it replaces:** Shipping only a CommonJS bundle: `"main": "./dist/index.js"` — this forces ESM consumers to use dynamic `import()` and breaks tree-shaking. The `exports` field with both `"import"` and `"require"` targets gives each consumer what it needs.

**Related:** [`The internal/ folder and index.ts re-export shape`](#the-internal-folder-and-indexts-re-export-shape), [`JSDoc @since, @category, @example tags`](#jsdoc-since-category-example-tags)

### `JSDoc` `@since`, `@category`, `@example` tags

**Signature:**
```ts
/**
 * @since 2.0.0
 * @category constructors
 * @example
 * import { Effect } from "effect"
 * const x = Effect.succeed(1)
 */
export const succeed: <A>(value: A) => Effect<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:2-3` — `@since 2.0.0` file-level tag
- `repos/effect/packages/effect/src/Effect.ts:78-80` — `@category` grouping and `@since` on individual exports

**When to use:** Use `@since` on every exported symbol to communicate the minimum Effect version required. Use `@category` to group related functions in generated documentation (constructors, combinators, utilities). Use `@example` for non-obvious usage — especially for functions with complex type signatures where a concrete call site clarifies intent.

**When NOT to use:** Don't add `@example` to trivial functions where the signature is self-explanatory. Don't use `@category internal` as a substitute for moving a function into `internal/` — if it's truly internal, it shouldn't be exported.

**Anti-pattern it replaces:** No documentation: exported functions with no JSDoc at all, forcing consumers to read source code or run experiments to understand behavior and version compatibility.

**Related:** [`The internal/ folder and index.ts re-export shape`](#the-internal-folder-and-indexts-re-export-shape), [`Dual ESM/CJS export pattern`](#dual-esmcjs-export-pattern)

## Concurrency primitives

### `Ref` — atomic mutable cell

**Signature:**
```ts
export const make: <A>(value: A) => Effect.Effect<Ref<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Ref.ts:69-69` — `Ref.make` creates an atomically-updatable mutable cell inside an Effect

**When to use:** Use `Ref` when you need shared mutable state between fibers — a counter, a flag, a cache entry — where updates must be atomic. `Ref.update`, `Ref.modify`, and `Ref.getAndUpdate` are all atomic operations. It is the standard replacement for a `let` variable in Effect code.

**When NOT to use:** Don't use `Ref` when updates must be effectful (use `SynchronizedRef` for that). Don't use `Ref` when you also need to observe changes — use `SubscriptionRef`. Don't use `Ref` for per-fiber local state — use `FiberRef` instead.

**Anti-pattern it replaces:** Shared `let` variables in async code: `let count = 0; await Promise.all([...].map(async () => { count++; }))` — this has a race condition because `count++` is not atomic. `Ref.update(ref, n => n + 1)` is atomic across all concurrent fibers.

**Related:** [`SynchronizedRef` — atomic effectful update](#synchronizedref--atomic-effectful-update), [`SubscriptionRef` — observable Ref](#subscriptionref--observable-ref), [`FiberRef` — fiber-local state](#fiberref--fiber-local-state)

### `SubscriptionRef` — observable Ref

**Signature:**
```ts
export const make: <A>(value: A) => Effect.Effect<SubscriptionRef<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/SubscriptionRef.ts:148-148` — `SubscriptionRef.make` creates a `Ref` that also emits a `Stream` of changes on each update

**When to use:** Use `SubscriptionRef` when you need both a mutable reference and the ability to observe changes as a stream — for example, app state that drives a UI (React / SSE), or a config value that other services watch for changes. `ref.changes` gives a `Stream<A>` that emits the current value and every subsequent update.

**When NOT to use:** Don't use `SubscriptionRef` when you only need the mutable cell without observation — `Ref` is lighter. Don't use it for high-frequency updates where every individual write emits to the stream — that can cause backpressure issues; consider debouncing with `Stream.debounce`.

**Anti-pattern it replaces:** A `Ref` paired with a `PubSub` manually maintained in sync: `const ref = yield* Ref.make(v); const pubsub = yield* PubSub.unbounded(); // update both atomically ...` — `SubscriptionRef` does this atomically in one primitive.

**Related:** [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`PubSub` — multi-subscriber broadcast](#pubsub--multi-subscriber-broadcast), [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](#streamfrompubsub--fromqueue--fromschedule--groupby)

### `Queue` — unbounded / bounded / sliding / dropping

**Signature:**
```ts
export const unbounded: <A>() => Effect.Effect<Queue<A>>
export const bounded: <A>(requestedCapacity: number) => Effect.Effect<Queue<A>>
export const sliding: <A>(requestedCapacity: number) => Effect.Effect<Queue<A>>
export const dropping: <A>(requestedCapacity: number) => Effect.Effect<Queue<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Queue.ts:473-473` — `unbounded` creates a queue with no capacity limit
- `repos/effect/packages/effect/src/Queue.ts:435-435` — `bounded` suspends producers when full
- `repos/effect/packages/effect/src/Queue.ts:465-465` — `sliding` drops oldest elements when full
- `repos/effect/packages/effect/src/Queue.ts:450-450` — `dropping` drops new elements when full

**When to use:** Use `Queue.bounded` for work queues where producers should block when the system is overloaded — this provides natural backpressure. Use `Queue.dropping` when you must never block producers (e.g., logging, metrics) and it's acceptable to lose messages under load. Use `Queue.sliding` for streaming the most recent N items (e.g., a live tail of log lines). Use `Queue.unbounded` only in tests or when you know the queue will always drain faster than it fills.

**When NOT to use:** Don't use `Queue` when you need multiple independent consumers receiving the same messages — use `PubSub` for fan-out. Don't use `Queue.unbounded` in production without bounding it elsewhere — it will grow without limit under sustained load.

**Anti-pattern it replaces:** A plain array used as a queue with `push`/`shift`: `const q = []; q.push(item); const item = q.shift()` — no backpressure, no blocking consumers, and `shift()` is O(n). `Queue` provides O(1) enqueue/dequeue with proper async blocking.

**Related:** [`PubSub` — multi-subscriber broadcast](#pubsub--multi-subscriber-broadcast), [`Stream.fromQueue`](#streamfrompubsub--fromqueue--fromschedule--groupby), [`Mailbox` — ordered message inbox](#mailbox--ordered-message-inbox)

### `PubSub` — multi-subscriber broadcast

**Signature:**
```ts
export const unbounded: <A>(options?: { readonly replay?: number | undefined }) => Effect.Effect<PubSub<A>>
export const bounded: <A>(
  capacity: number | { readonly capacity: number; readonly replay?: number | undefined }
) => Effect.Effect<PubSub<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/PubSub.ts:85-86` — `unbounded` creates a broadcast hub with no capacity limit
- `repos/effect/packages/effect/src/PubSub.ts:49-51` — `bounded` creates a back-pressured hub

**When to use:** Use `PubSub` when multiple independent consumers need to receive every message from a source — websocket broadcast to all connected clients, distributing a stream of events to multiple workers, or fanout from a single producer. `PubSub.bounded` gives backpressure: the publisher blocks when the slowest subscriber's buffer is full.

**When NOT to use:** Don't use `PubSub` for point-to-point communication where only one consumer should receive each message — use `Queue` instead. Don't use `PubSub` when late subscribers need to receive past messages — they will miss events published before they subscribed (no message replay by default; check `replay` option for limited replay).

**Anti-pattern it replaces:** An `EventEmitter` with `on('message', handler)` — no backpressure, no typed events, listeners accumulate and are never cleaned up, and errors in one listener crash others. `PubSub` manages subscriber lifecycles via scopes.

**Related:** [`Queue` — unbounded / bounded / sliding / dropping](#queue--unbounded--bounded--sliding--dropping), [`SubscriptionRef` — observable Ref](#subscriptionref--observable-ref), [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](#streamfrompubsub--fromqueue--fromschedule--groupby)

### `FiberRef` — fiber-local state

**Signature:**
```ts
export const make: <A>(
  initial: A,
  options?: {
    readonly fork?: ((a: A) => A) | undefined
    readonly join?: ((left: A, right: A) => A) | undefined
  }
) => Effect.Effect<FiberRef<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/FiberRef.ts:94-98` — `FiberRef.make` creates fiber-local storage; `fork` and `join` control inheritance and merge strategies

**When to use:** Use `FiberRef` for contextual state that is inherited by child fibers but isolated from siblings — request-scoped values like a trace ID, a current user, or a log context that should flow through the call chain without being threaded explicitly. Effect uses `FiberRef` internally for the current logger, tracer, and span context.

**When NOT to use:** Don't use `FiberRef` for shared mutable state across fibers — use `Ref`. Don't use it for dependency injection — use `Context.Tag` and `Layer` instead. `FiberRef` is for per-fiber ambient context, not for services.

**Anti-pattern it replaces:** Node.js `AsyncLocalStorage` / `cls-hooked` for request-scoped storage: `const storage = new AsyncLocalStorage(); storage.run({ userId }, async () => { ... })` — this breaks when using Effect's fibers because fibers don't map to Node.js async contexts. `FiberRef` is the Effect-native equivalent.

**Related:** [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin), [`Effect.withSpan` / `annotateCurrentSpan`](#effectwithspan--annotatecurrentspan--distributed-tracing)

### `Semaphore` — async resource limiting

**Signature:**
```ts
export interface Semaphore {
  readonly withPermits: (permits: number) => <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>
  readonly take: (permits: number) => Effect<void>
  readonly release: (permits: number) => Effect<void>
  readonly available: Effect<number>
}

export const makeSemaphore: (permits: number) => Effect<Semaphore>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:11772-11824` — `Semaphore` interface with `withPermits` for bracketed usage
- `repos/effect/packages/effect/src/Effect.ts:11852-11852` — `makeSemaphore` creates the semaphore Effect

**When to use:** Use `Semaphore` to limit concurrent access to a shared resource — allowing at most N operations to run simultaneously: `semaphore.withPermits(1)(criticalSection)`. Use a 1-permit semaphore as a mutex. Use a higher-count semaphore to limit concurrent outbound HTTP calls to an external API.

**When NOT to use:** Don't use `Semaphore` for fixed-pool resources like database connections — use `Pool.make` which also manages the resource lifecycle. Don't use `Semaphore` when you actually want ordered exclusive access with composable rollback — use `STM` instead.

**Anti-pattern it replaces:** A mutex implemented with a `Ref<boolean>`: `while (yield* Ref.get(locked)) { yield* Effect.sleep(10) }; yield* Ref.set(locked, true); // ...` — polling with `sleep` wastes CPU and has race conditions between the check and the set. `Semaphore` blocks atomically.

**Related:** [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](#poolmake--poolmakewithttl-and-keyedpool), [`STM.gen` / `STM.commit`](#stmgen--stmcommit--software-transactional-memory), [`RateLimiter` — token-bucket rate limiting](#ratelimiter--token-bucket-rate-limiting)

### `Deferred` — one-shot async value

**Signature:**
```ts
export const make: <A, E = never>() => Effect.Effect<Deferred<A, E>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Deferred.ts:88-88` — `Deferred.make` creates a one-shot promise-like that can be completed from another fiber

**When to use:** Use `Deferred` for one-shot synchronization between fibers — a fiber creates a `Deferred`, shares it with a worker fiber, and blocks on `Deferred.await` until the worker calls `Deferred.succeed`. Common patterns: waiting for an initialization signal, implementing a future/promise in the Effect world, or a "latch" that opens once.

**When NOT to use:** Don't use `Deferred` when you need to send multiple values over time — use `Queue` or `Mailbox`. Don't use it when the completion is driven by a schedule or timer — use `Clock` and `Effect.sleep` instead.

**Anti-pattern it replaces:** A manually managed `Promise` and `resolve` pair: `let resolve: (v: string) => void; const p = new Promise<string>(r => { resolve = r; }); someWorker.then(() => resolve("done"))` — `Deferred` encodes the same pattern with Effect's typed error channel and interruption support.

**Related:** [`Queue` — unbounded / bounded / sliding / dropping](#queue--unbounded--bounded--sliding--dropping), [`Fiber — joining, interrupting, racing`](#fiber--joining-interrupting-racing-effectfork-return-type), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin)

### `Mailbox` — ordered message inbox

**Signature:**
```ts
export const make: <A, E = never>(
  capacity?: number | {
    readonly capacity?: number
    readonly strategy?: "suspend" | "dropping" | "sliding"
  } | undefined
) => Effect<Mailbox<A, E>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Mailbox.ts:209-214` — `Mailbox.make` creates a typed ordered message inbox used for actor-style messaging

**When to use:** Use `Mailbox` for actor-style programming where a long-running fiber processes messages in order — a state machine, a request handler with a dedicated fiber, or a supervisor that receives child failure notifications. `Mailbox` differs from `Queue` in that it is typed as an inbox for a specific fiber and supports `done` / `fail` signals to terminate the actor.

**When NOT to use:** Don't use `Mailbox` for pub-sub patterns (multiple consumers) — use `PubSub`. Don't use it for work queues where any available worker should process each item — use `Queue` with multiple concurrent consumers.

**Anti-pattern it replaces:** An actor library like `xstate` or custom `Map<ActorId, Promise<void>>` with message passing via callbacks — no typed errors, no interruption, no structured lifecycle. `Mailbox` provides a typed, interrupt-safe actor inbox.

**Related:** [`Queue` — unbounded / bounded / sliding / dropping](#queue--unbounded--bounded--sliding--dropping), [`Deferred` — one-shot async value](#deferred--one-shot-async-value), [`FiberSet` / `FiberMap` / `FiberHandle`](#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking)

### `FiberSet` / `FiberMap` / `FiberHandle` — fiber lifecycle tracking

**Signature:**
```ts
// FiberSet.make
export const make = <A = unknown, E = unknown>(): Effect.Effect<FiberSet<A, E>, never, Scope.Scope>

// FiberMap.make
export const make = <K, A = unknown, E = unknown>(): Effect.Effect<FiberMap<K, A, E>, never, Scope.Scope>

// FiberHandle.make
export const make = <A = unknown, E = unknown>(): Effect.Effect<FiberHandle<A, E>, never, Scope.Scope>
```

**Where it appears:**
- `repos/effect/packages/effect/src/FiberSet.ts:117-118` — `FiberSet.make` tracks a collection of fibers; interrupts all when scope closes
- `repos/effect/packages/effect/src/FiberMap.ts:120-121` — `FiberMap.make` tracks keyed fibers, replacing previous fibers at the same key
- `repos/effect/packages/effect/src/FiberHandle.ts:110-111` — `FiberHandle.make` holds at most one fiber, interrupting the previous on replacement

**When to use:** Use `FiberSet` for a pool of worker fibers where any number run in parallel and all must be cleaned up on scope close. Use `FiberMap` for keyed background tasks where starting a new task for a key cancels any existing task for that key — ideal for debouncing (restart the fiber on each new request for the same key). Use `FiberHandle` for a single exclusive background task that should be cancelled and replaced on each new start.

**When NOT to use:** Don't use `FiberSet` when you need the results of the fibers — use `Effect.all({ concurrency: n })` which collects results. Don't use `FiberMap` when keys are ephemeral and you never need to cancel by key — a `FiberSet` is simpler.

**Anti-pattern it replaces:** A `Set<Promise<void>>` or `Map<string, Promise<void>>` for tracking background tasks with manual cleanup: `tasks.add(doWork()); process.on('SIGTERM', () => Promise.all([...tasks].map(cancelIfPossible)))` — no structured cancellation, no interruption, no error propagation. `FiberSet` handles all of this via scope.

**Related:** [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](#effectfork--forkdaemon--forkscoped--forkin), [`Fiber — joining, interrupting, racing`](#fiber--joining-interrupting-racing-effectfork-return-type), [`Structured concurrency via Scope`](#structured-concurrency-via-scope)

### SynchronizedRef — atomic effectful update

**Signature:**
```ts
export const make: <A>(value: A) => Effect.Effect<SynchronizedRef<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/SynchronizedRef.ts:71-71` — `SynchronizedRef.make` creates a Ref whose `modifyEffect` operations are serialized (atomic effectful updates)

**When to use:** Use `SynchronizedRef` when updates to a `Ref` must themselves be effectful — for example, reading from a `Ref`, making an async call based on the value, and updating the `Ref` with the result, all as an atomic operation. `modifyEffect` ensures no other fiber can interleave between the read and the write.

**When NOT to use:** Don't use `SynchronizedRef` for pure synchronous updates — `Ref` is simpler and faster. Don't use it when the effectful update can throw or fail in a way that should not affect the ref's value — `modifyEffect` may leave the ref in an intermediate state on failure.

**Anti-pattern it replaces:** Manual locking: `yield* Semaphore.withPermits(1)(mutex)(Effect.gen(function*() { const v = yield* Ref.get(ref); const newV = yield* expensiveCompute(v); yield* Ref.set(ref, newV); }))` — `SynchronizedRef.modifyEffect` provides this pattern built-in.

**Related:** [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`STM.gen` / `STM.commit`](#stmgen--stmcommit--software-transactional-memory), [`Semaphore` — async resource limiting](#semaphore--async-resource-limiting)

### RateLimiter — token-bucket rate limiting

**Signature:**
```ts
export const make: (options: RateLimiter.Options) => Effect<RateLimiter, never, Scope>
```

**Where it appears:**
- `repos/effect/packages/effect/src/RateLimiter.ts:98-98` — `RateLimiter.make` creates a token-bucket rate limiter with `limit` and `interval` options

**When to use:** Use `RateLimiter` when calling an external API that has a rate limit — for example, "100 requests per minute." Wrap each call in `rateLimiter(effect)` and the runtime will automatically delay calls that would exceed the rate. This is the clean alternative to manually tracking timestamps and sleeping.

**When NOT to use:** Don't use `RateLimiter` for internal concurrency control — use `Semaphore`. Don't share a single `RateLimiter` across all users if you need per-user rate limits — create one `RateLimiter` per user (consider `RcMap` for this pattern).

**Anti-pattern it replaces:** Token-bucket logic with a `Ref` and `sleep`: `const tokens = yield* Ref.make(100); const replenish = Schedule.spaced("1 minute")...` — custom implementations have subtle bugs around burst handling and time measurement. `RateLimiter` provides a correct, tested implementation.

**Related:** [`Semaphore` — async resource limiting](#semaphore--async-resource-limiting), [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](#schedulespaced--exponential--fixed--recurs), [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](#poolmake--poolmakewithttl-and-keyedpool)

## Observability

### `Logger.make` / `withMinimumLogLevel` and `Effect.log*` family

**Signature:**
```ts
export const make: <Message, Output>(
  log: (options: Logger.Options<Message>) => Output
) => Logger<Message, Output>

export const withMinimumLogLevel: {
  (level: LogLevel.LogLevel): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>
  <A, E, R>(self: Effect<A, E, R>, level: LogLevel.LogLevel): Effect<A, E, R>
}

export const log: (...message: ReadonlyArray<any>) => Effect<void, never, never>
export const logDebug: (...message: ReadonlyArray<any>) => Effect<void, never, never>
export const logInfo: (...message: ReadonlyArray<any>) => Effect<void, never, never>
export const logWarning: (...message: ReadonlyArray<any>) => Effect<void, never, never>
export const logError: (...message: ReadonlyArray<any>) => Effect<void, never, never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Logger.ts:110-111` — `Logger.make` constructs a custom logger from an `Options → Output` function
- `repos/effect/packages/effect/src/Logger.ts:363-366` — `withMinimumLogLevel` filters log output below a threshold
- `repos/effect/packages/effect/src/Effect.ts:10850-10850` — `Effect.log` emits at the default log level
- `repos/effect/packages/effect/src/Effect.ts:10937-10980` — `logDebug` / `logInfo` / `logWarning` / `logError` emit at specific levels

**When to use:** Use `Effect.logInfo("message")` / `logError` / `logDebug` in application code — they integrate with the Effect runtime's logger, automatically attach fiber context (span ID, fiber ID), and respect the configured log level. Use `Logger.make` to build a custom logger that outputs to a JSON log aggregator (Datadog, CloudWatch) or another target. Use `withMinimumLogLevel` in tests to suppress verbose output.

**When NOT to use:** Don't use `console.log` inside an Effect — it bypasses the logger's level filter, structured context, and the ability to swap loggers in tests. Don't build a custom `Logger.make` just to add a prefix — use `Logger.withSpanAnnotations` or annotate the span instead.

**Anti-pattern it replaces:** `console.log("user created:", userId)` — no log level, no structured context, cannot be filtered, cannot be captured in tests. `Effect.logInfo("user created", { userId })` is structured, filterable, and mockable.

**Related:** [`Effect.withSpan` / `annotateCurrentSpan`](#effectwithspan--annotatecurrentspan--distributed-tracing), [`Metric.counter` / `gauge` / `histogram` / `summary`](#metriccounter--gauge--histogram--summary), [`ConfigProvider.fromEnv` / `fromMap` / `fromJson`](#configproviderfromenv--frommap--fromjson)

### `Metric.counter` / `gauge` / `histogram` / `summary`

**Signature:**
```ts
export const counter: {
  (name: string, options?: { readonly description?: string; readonly bigint?: false; readonly incremental?: boolean }): Metric<MetricKeyType.MetricKeyType.Counter<number>, number, MetricState.MetricState.Counter<number>>
  ...
}

export const gauge: {
  (name: string, options?: { readonly description?: string; readonly bigint?: false }): Metric<MetricKeyType.MetricKeyType.Gauge<number>, number, MetricState.MetricState.Gauge<number>>
  ...
}

export const histogram: (
  name: string,
  boundaries: MetricBoundaries.MetricBoundaries,
  description?: string
) => Metric<MetricKeyType.MetricKeyType.Histogram, number, MetricState.MetricState.Histogram>

export const summary: (options: {
  readonly name: string
  readonly maxAge: Duration.DurationInput
  ...
}) => Metric<MetricKeyType.MetricKeyType.Summary, number, MetricState.MetricState.Summary>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Metric.ts:186-190` — `counter` accumulates numeric increments
- `repos/effect/packages/effect/src/Metric.ts:276-280` — `gauge` tracks an absolute level
- `repos/effect/packages/effect/src/Metric.ts:304-308` — `histogram` buckets observations by boundaries
- `repos/effect/packages/effect/src/Metric.ts:429-434` — `summary` computes quantiles over a sliding window

**When to use:** Use `Metric.counter` to count events (requests, errors, retries). Use `Metric.gauge` to track a current level (active connections, queue depth, memory usage). Use `Metric.histogram` for latency distributions with predefined buckets. Use `Metric.summary` for quantile estimation (p50, p99) with a sliding window. Wire them into Effects with `.pipe(Metric.trackDuration(myHistogram))` or `Metric.increment(myCounter)`.

**When NOT to use:** Don't use `Metric` if you have no Prometheus-compatible backend to consume them — the metrics accumulate in memory with no export by default. Don't reinvent these with raw `Ref` counters when `Metric` provides the semantics already.

**Anti-pattern it replaces:** `prom-client` used outside Effect: `const httpRequests = new Counter({ name: 'http_requests', help: '...' }); httpRequests.inc()` — no automatic label propagation from the Effect context, and no integration with Effect's error channel for tracking errors.

**Related:** [`Effect.withSpan` / `annotateCurrentSpan`](#effectwithspan--annotatecurrentspan--distributed-tracing), [`Logger.make` / `withMinimumLogLevel`](#loggermake--withminimumloglevel-and-effectlog-family), [`Effect.fn` (named effect functions)](#effectfn-named-effect-functions-with-auto-tracing)

### `Effect.withSpan` / `annotateCurrentSpan` — distributed tracing

**Signature:**
```ts
export const withSpan: {
  (
    name: string,
    options?: Tracer.SpanOptions | undefined
  ): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, Exclude<R, Tracer.ParentSpan>>
  ...
}

export const annotateCurrentSpan: {
  (key: string, value: unknown): Effect<void>
  (values: Record<string, unknown>): Effect<void>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:13105-13108` — `withSpan` wraps an Effect in a named tracing span
- `repos/effect/packages/effect/src/Effect.ts:12990-12993` — `annotateCurrentSpan` adds key-value metadata to the active span

**When to use:** Use `Effect.withSpan("operationName")` to create a named span for any logically distinct operation — an HTTP handler, a database query, an external API call. The span automatically records start time, end time, and errors. Use `annotateCurrentSpan({ userId, requestId })` to attach domain-specific attributes that appear in your trace viewer (Jaeger, Honeycomb, Datadog APM).

**When NOT to use:** Don't add a span for every trivial helper function — too many spans pollute the trace and hurt performance. Aim for operation-level spans (database query, external call, queue message), not line-level spans. Use `Effect.fn` instead of manual `withSpan` for named function definitions.

**Anti-pattern it replaces:** Manual OpenTelemetry instrumentation: `const span = tracer.startSpan("myOp"); try { const result = await myOp(); span.end(); return result; } catch (e) { span.recordException(e); span.end(); throw e; }` — `withSpan` handles all of this including Effect errors (not just exceptions).

**Related:** [`Effect.fn` (named effect functions)](#effectfn-named-effect-functions-with-auto-tracing), [`Metric.counter` / `gauge` / `histogram` / `summary`](#metriccounter--gauge--histogram--summary), [`Logger.make` / `withMinimumLogLevel`](#loggermake--withminimumloglevel-and-effectlog-family)

## State management

### `STM.gen` / `STM.commit` — software transactional memory

**Signature:**
```ts
export const gen: <Self, Eff extends YieldWrap<STM<any, any, any>>, AEff>(
  ...args: [self: Self, body: (this: Self, resume: Adapter) => Generator<Eff, AEff, never>]
    | [body: (resume: Adapter) => Generator<Eff, AEff, never>]
) => STM<AEff, ...>

export const commit: <A, E, R>(self: STM<A, E, R>) => Effect.Effect<A, E, R>
```

> **Editorial note:** Earlier Effect versions and other STM libraries (e.g., ZIO) call this `atomically` — Effect names it `commit`.

**Where it appears:**
- `repos/effect/packages/effect/src/STM.ts:1073-1077` — `STM.gen` composes transactional operations in a generator
- `repos/effect/packages/effect/src/STM.ts:424-424` — `commit` executes an STM transaction atomically as an Effect

**When to use:** Use STM when you need to atomically update multiple shared values — for example, transferring balance between two accounts (`TRef.get` on both, update both, commit) without the risk of one update succeeding and the other failing. STM transactions retry automatically if a conflicting write is detected mid-transaction.

**When NOT to use:** Don't use STM for single-variable updates — `Ref` is simpler and faster (no transaction overhead). Don't use STM for operations that have side effects (network calls, file I/O) inside the transaction — STM may retry the transaction, causing the side effect to run multiple times.

**Anti-pattern it replaces:** Manual locking for multi-variable updates: `const mutex = yield* makeSemaphore(1); yield* Semaphore.withPermits(1)(mutex)(Effect.gen(function*() { const a = yield* Ref.get(refA); const b = yield* Ref.get(refB); yield* Ref.set(refA, a - amount); yield* Ref.set(refB, b + amount); }))` — STM's optimistic concurrency is more composable and doesn't require a shared mutex.

**Related:** [`TRef` / `TQueue` / `TMap` / `TSemaphore`](#tref--tqueue--tmap--tsemaphore--stm-aware-variants), [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`Semaphore` — async resource limiting](#semaphore--async-resource-limiting)

### `TRef` / `TQueue` / `TMap` / `TSemaphore` — STM-aware variants

**Signature:**
```ts
export const make: <A>(value: A) => STM.STM<TRef<A>>                    // TRef
export const bounded: <A>(requestedCapacity: number) => STM.STM<TQueue<A>>  // TQueue
export const make: <K, V>(...entries: Array<readonly [K, V]>) => STM.STM<TMap<K, V>>  // TMap
export const make: (permits: number) => STM.STM<TSemaphore>             // TSemaphore
```

**Where it appears:**
- `repos/effect/packages/effect/src/TRef.ts:106-106` — `TRef.make` creates a transactional mutable reference
- `repos/effect/packages/effect/src/TQueue.ts:221-221` — `TQueue.bounded` creates a transactional bounded queue
- `repos/effect/packages/effect/src/TMap.ts:201-201` — `TMap.make` creates a transactional key-value map
- `repos/effect/packages/effect/src/TSemaphore.ts:75-75` — `TSemaphore.make` creates a transactional semaphore

**When to use:** Use `TRef` as the fundamental STM mutable cell — analogous to `Ref` but composable in STM transactions. Use `TQueue` when you need a queue inside a transaction (enqueue and update a counter atomically). Use `TMap` for a key-value store that participates in transactions. Use `TSemaphore` as a transactional concurrency limiter that composes with other STM operations.

**When NOT to use:** Don't mix STM types (`TRef`, `TQueue`) with regular Effect types (`Ref`, `Queue`) inside the same transaction — they live in different worlds. Use the STM variants only when you actually need atomic composition with other STM operations; otherwise the regular variants are simpler.

**Anti-pattern it replaces:** Using `Ref` for multi-step updates without a transaction: `const from = yield* Ref.get(fromRef); const to = yield* Ref.get(toRef); yield* Ref.set(fromRef, from - n); yield* Ref.set(toRef, to + n)` — another fiber can interleave between the two sets. Use `TRef` with `STM.commit` for the atomic version.

**Related:** [`STM.gen` / `STM.commit`](#stmgen--stmcommit--software-transactional-memory), [`Ref` — atomic mutable cell](#ref--atomic-mutable-cell), [`Queue` — unbounded / bounded / sliding / dropping](#queue--unbounded--bounded--sliding--dropping)

## Time & Scheduling

### `Schedule.spaced` / `exponential` / `fixed` / `recurs`

**Signature:**
```ts
export const spaced: (duration: Duration.DurationInput) => Schedule<number>
export const fixed: (interval: Duration.DurationInput) => Schedule<number>
export const exponential: (base: Duration.DurationInput, factor?: number) => Schedule<Duration.Duration>
export const recurs: (n: number) => Schedule<number>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schedule.ts:1757-1757` — `spaced` waits a fixed delay between each recurrence
- `repos/effect/packages/effect/src/Schedule.ts:1049-1049` — `fixed` recurs on a fixed absolute interval
- `repos/effect/packages/effect/src/Schedule.ts:1003-1005` — `exponential` backs off with an exponential multiplier
- `repos/effect/packages/effect/src/Schedule.ts:1604-1604` — `recurs` runs exactly N times

**When to use:** Use `Schedule.exponential("100 millis").pipe(Schedule.jittered, Schedule.compose(Schedule.recurs(5)))` as the standard retry schedule for network operations — exponential backoff with jitter and a maximum of 5 retries. Use `Schedule.spaced("5 seconds")` for heartbeats or polling. Use `Schedule.fixed("1 minute")` for clock-aligned tasks (exactly every minute, not "one minute after last run").

**When NOT to use:** Don't use `Schedule.recurs(n)` without a delay schedule — it will retry immediately N times (useful in tests, not in production). Don't use `Schedule.spaced` for cron-style scheduling where you need to run "at 9am every Monday" — use `Cron.parse`.

**Anti-pattern it replaces:** `let retries = 0; while (retries < 5) { try { return await op(); } catch { retries++; await sleep(100 * 2 ** retries + Math.random() * 100); } }` — imperative retry loops are verbose, easy to get wrong, and can't be composed. `Effect.retry(op, { schedule: Schedule.exponential("100 millis").pipe(Schedule.jittered, Schedule.compose(Schedule.recurs(5))) })` is declarative and composable.

**Related:** [`Schedule.jittered` / `compose` — combinators`](#schedulejittered--compose--combinators), [`Effect.all` / `Effect.repeat` / `Effect.retry`](#effectall--effectrepeat--effectretry--combinators), [`Cron.parse` / `make` and `DateTime`](#cronparse--make-and-datetimenow--make--format)

### `Schedule.jittered` / `compose` — combinators

**Signature:**
```ts
export const jittered: <Out, In, R>(self: Schedule<Out, In, R>) => Schedule<Out, In, R>

export const compose: {
  <Out2, Out, R2>(that: Schedule<Out2, Out, R2>): <In, R>(self: Schedule<Out, In, R>) => Schedule<Out2, In, R2 | R>
  <Out, In, R, Out2, R2>(self: Schedule<Out, In, R>, that: Schedule<Out2, Out, R2>): Schedule<Out2, In, R | R2>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Schedule.ts:1232-1232` — `jittered` adds random noise to delays to avoid thundering-herd effects
- `repos/effect/packages/effect/src/Schedule.ts:530-533` — `compose` pipes one schedule's output as another's input (e.g., `exponential |> jittered`)

**When to use:** Use `Schedule.jittered` on any production retry or polling schedule to prevent thundering-herd: after an outage, all clients retrying at the same intervals will overwhelm the recovering service; jitter spreads them out. Use `Schedule.compose(scheduleA, scheduleB)` to chain two schedules sequentially — `scheduleA` drives the decision, `scheduleB` transforms the output.

**When NOT to use:** Don't add jitter to schedules used in tests — it makes tests non-deterministic. Use `Schedule.compose` only when you need to feed one schedule's output as another's input; for most cases, `Schedule.union` or `Schedule.intersect` are more appropriate.

**Anti-pattern it replaces:** Hardcoded retry delays without jitter: `await sleep(1000); retry()` repeated uniformly across all clients — everyone retries at second 1, second 2, etc., recreating the thundering herd after an outage.

**Related:** [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](#schedulespaced--exponential--fixed--recurs), [`Effect.all` / `Effect.repeat` / `Effect.retry`](#effectall--effectrepeat--effectretry--combinators)

### `Cron.parse` / `make` and `DateTime.now` / `make` / `format`

**Signature:**
```ts
// Cron
export const parse: (cron: string, tz?: DateTime.TimeZone | string) => Either.Either<Cron, ParseError>
export const make: (values: {
  readonly seconds?: Iterable<number> | undefined
  readonly minutes: Iterable<number>
  readonly hours: Iterable<number>
  ...
}) => Cron

// DateTime
export const now: Effect.Effect<Utc>
export const make: <A extends DateTime.Input>(input: A) => Option.Option<DateTime.PreserveZone<A>>
export const format: { (options?: ...): (self: DateTime.DateTime) => string; ... }
```

**Where it appears:**
- `repos/effect/packages/effect/src/Cron.ts:293-297` — `Cron.parse` parses a cron expression string into a typed `Cron` value
- `repos/effect/packages/effect/src/Cron.ts:138-144` — `Cron.make` builds a cron schedule from field iterables
- `repos/effect/packages/effect/src/DateTime.ts:490-490` — `DateTime.now` returns the current UTC timestamp as an Effect
- `repos/effect/packages/effect/src/DateTime.ts:464-464` — `DateTime.make` parses a date input into an `Option<DateTime>`
- `repos/effect/packages/effect/src/DateTime.ts:1529-1545` — `DateTime.format` formats a DateTime for display

**When to use:** Use `Cron.parse("0 9 * * 1")` to express calendar-based schedules (run every Monday at 9am) in a standard format that non-engineers can read. Use `DateTime.now` inside an Effect for the current time — it reads from Effect's `Clock` service, which can be overridden in tests for determinism. Use `DateTime.make` and `DateTime.format` for parsing and displaying dates at boundaries.

**When NOT to use:** Don't use `Cron` for sub-second or high-frequency scheduling — use `Schedule.spaced` or `Schedule.fixed` instead. Don't use `new Date()` inside an Effect — it bypasses the `Clock` service and makes your code untestable with synthetic time.

**Anti-pattern it replaces:** `node-cron` or `cron` npm packages that run callbacks on a schedule: `cron.schedule('0 9 * * 1', () => runJob())` — no Effect integration, no typed errors from the job, no interruption, no test-time clock control.

**Related:** [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](#schedulespaced--exponential--fixed--recurs), [`Random — testable seed-based RNG service`](#random--testable-seed-based-rng-service), [`Effect.all` / `Effect.repeat` / `Effect.retry`](#effectall--effectrepeat--effectretry--combinators)

### Random — testable seed-based RNG service

**Signature:**
```ts
export interface Random {
  readonly next: Effect.Effect<number>
  readonly nextInt: Effect.Effect<number>
  readonly nextBoolean: Effect.Effect<boolean>
  readonly nextRange: (min: number, max: number) => Effect.Effect<number>
  readonly shuffle: <A>(elements: Iterable<A>) => Effect.Effect<Chunk.Chunk<A>>
}

export const Random: Context.Tag<Random, Random>
export const make: <A>(seed: A) => Random
export const next: Effect.Effect<number>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Random.ts:29-57` — `Random` interface (service definition)
- `repos/effect/packages/effect/src/Random.ts:146-146` — `Random` Tag for dependency injection
- `repos/effect/packages/effect/src/Random.ts:171-171` — `make` creates a deterministic seeded RNG (for testing)
- `repos/effect/packages/effect/src/Random.ts:65-65` — `next` draws the next `[0,1)` float from the service

**When to use:** Use `Effect.flatMap(() => Random.next)` (or `yield* Random.next` in a generator) wherever you need randomness — UUIDs, sampling, random backoff. The `Random` service is injectable, so tests can provide a deterministic seeded instance via `Random.make(42)` as a layer, making random-dependent code reproducible.

**When NOT to use:** Don't use `Math.random()` inside an Effect — it is a global side effect that cannot be controlled in tests. Don't use the `Random` service for cryptographically secure random numbers — use `crypto.getRandomValues` via `Effect.sync`.

**Anti-pattern it replaces:** `Math.random()` called directly in business logic — the test can never reproduce a specific random sequence to reproduce a bug. `Random.next` from the `Random` service lets you provide a seeded generator in tests.

**Related:** [`Schedule.jittered` / `compose`](#schedulejittered--compose--combinators), [`Cron.parse` / `make` and `DateTime`](#cronparse--make-and-datetimenow--make--format), [`Effect.Service` class`](#effectservice-class)

## Pattern matching

### `Match.value` / `Match.type` — starting a match

**Signature:**
```ts
export const value: <const I>(i: I) => Matcher<I, Types.Without<never>, I, never, I>
export const type: <I>() => Matcher<I, Types.Without<never>, I, never, never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Match.ts:237-239` — `value` starts a match on a specific runtime value
- `repos/effect/packages/effect/src/Match.ts:195-195` — `type` starts a match on a type only (no runtime value yet, returns a function)

**When to use:** Use `Match.value(x)` when you have a value in hand and want to pattern-match it inline. Use `Match.type<Shape>()` to create a reusable matcher function that can be applied to any `Shape` value later — for example, as an argument to `Array.map`. Both are the starting point for building a pattern match expression.

**When NOT to use:** Don't use `Match.value` for simple two-case discriminated unions where a plain `if (x._tag === "A") ... else ...` is more readable. Don't reach for `Match` just because you have an `if/else` chain — use it when exhaustiveness checking adds real value.

**Anti-pattern it replaces:** `switch (shape._tag) { case "Circle": ...; case "Square": ...; default: throw new Error("unreachable") }` — TypeScript doesn't statically verify the `default` is truly unreachable. `Match.exhaustive` makes the "all cases covered" check a type error.

**Related:** [`Match.when` / `not` / `exhaustive`](#matchwhen--not--exhaustive--clauses-and-finalizers), [`Data.TaggedEnum` — discriminated union constructors`](#datataggedenum--discriminated-union-constructors)

### `Match.when` / `not` / `exhaustive` — clauses and finalizers

**Signature:**
```ts
export const when: <
  R,
  const P extends Types.PatternPrimitive<R> | Types.PatternBase<R>,
  Ret,
  A, Pr
>(
  pattern: P,
  f: (value: Types.WhenMatch<R, P>) => Ret
): (self: Matcher<..., R, A, Pr, Ret>) => Matcher<..., Types.ApplyFilters<...>, A | Ret, Pr, Ret>

export const not: <R, const P, Ret, A, Pr>(
  pattern: P,
  f: (value: Types.NotMatch<R, P>) => Ret
): (self: Matcher<..., R, A, Pr, Ret>) => Matcher<...>

export const exhaustive: <I, F, A, Pr, Ret>(
  self: Matcher<I, F, never, A, Pr, Ret>
) => [Pr] extends [never] ? (u: I) => Unify<A> : Unify<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Match.ts:368-374` — `when` adds a matching clause (pattern → handler)
- `repos/effect/packages/effect/src/Match.ts:926-930` — `not` adds a negation clause
- `repos/effect/packages/effect/src/Match.ts:1244-1246` — `exhaustive` finalizes the match, enforcing total coverage at the type level

**When to use:** Use `Match.when({ _tag: "Circle" }, shape => shape.radius * Math.PI)` to match on a discriminant or predicate and handle the narrowed type. Use `Match.not` to handle "everything except X." End every match with `Match.exhaustive` to get a compile error if a new variant is added to the union and not handled.

**When NOT to use:** Don't use `Match.exhaustive` in tests as a workaround for missing `default` in switch — TypeScript's `never` checks in switch statements provide similar coverage. Don't chain more than ~7-8 `when` clauses; at that point, a lookup object (`Record<Tag, Handler>`) may be cleaner.

**Anti-pattern it replaces:** `switch` statements with a non-exhaustive `default: throw new Error("unreachable")` — TypeScript allows adding a new union variant without updating the switch, and the error only surfaces at runtime. `Match.exhaustive` makes it a compile-time type error.

**Related:** [`Match.value` / `Match.type`](#matchvalue--matchtype--starting-a-match), [`Data.TaggedEnum` — discriminated union constructors`](#datataggedenum--discriminated-union-constructors), [`Effect.catchTag` / `catchTags` / `sandbox`](#effectcatchtag--catchtags--sandbox--error-handling)

## Configuration

### `Config.string` / `integer` / `boolean` / `nested` / `all`

**Signature:**
```ts
export const string: (name?: string) => Config<string>
export const integer: (name?: string) => Config<number>
export const boolean: (name?: string) => Config<boolean>

export const nested: {
  (name: string): <A>(self: Config<A>) => Config<A>
  <A>(self: Config<A>, name: string): Config<A>
}

export const all: <const Arg extends Iterable<Config<any>> | Record<string, Config<any>>>(
  arg: Arg
) => Config<{ [K in keyof Arg]: Config.Success<Arg[K]> }>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Config.ts:406-406` — `string` reads a string config value by name
- `repos/effect/packages/effect/src/Config.ts:186-186` — `integer` reads and parses an integer
- `repos/effect/packages/effect/src/Config.ts:130-130` — `boolean` reads a boolean flag
- `repos/effect/packages/effect/src/Config.ts:281-283` — `nested` scopes a config under a name prefix
- `repos/effect/packages/effect/src/Config.ts:103-105` — `all` combines multiple configs into a record or tuple

**When to use:** Use `Config.all({ host: Config.string("DB_HOST"), port: Config.integer("DB_PORT") })` to declare your entire configuration schema upfront and have Effect read and validate it from the environment. This makes missing or invalid env vars a startup error rather than a runtime surprise. Use `Config.nested("DATABASE")` to scope config under a prefix, matching env vars like `DATABASE_HOST`.

**When NOT to use:** Don't use `Config` for secrets that must be memory-safe — use `Config.secret` (which returns a `Secret`) or `Config.redacted`. Don't scatter `Config.string("VAR")` calls throughout the codebase — centralize all config in one module for discoverability.

**Anti-pattern it replaces:** `process.env.DB_HOST || "localhost"` scattered throughout the code — no validation, no type coercion, fails silently with wrong defaults, and is untestable without mutating `process.env`. `Config.string("DB_HOST")` is validated, typed, and testable via `ConfigProvider.fromMap`.

**Related:** [`ConfigProvider.fromEnv` / `fromMap` / `fromJson`](#configproviderfromenv--frommap--fromjson), [`Redacted — prevent secret values from leaking`](#redacted--prevent-secret-values-from-leaking-to-logsspans), [`Secret — memory-safe secret string`](#secret--memory-safe-secret-string)

### `ConfigProvider.fromEnv` / `fromMap` / `fromJson`

**Signature:**
```ts
export const fromEnv: (options?: Partial<ConfigProvider.FromEnvConfig>) => ConfigProvider
export const fromMap: (map: Map<string, string>, config?: Partial<ConfigProvider.FromMapConfig>) => ConfigProvider
export const fromJson: (json: unknown) => ConfigProvider
```

**Where it appears:**
- `repos/effect/packages/effect/src/ConfigProvider.ts:183-183` — `fromEnv` reads config from `process.env`
- `repos/effect/packages/effect/src/ConfigProvider.ts:210-211` — `fromMap` reads config from an in-memory `Map` (used in tests)
- `repos/effect/packages/effect/src/ConfigProvider.ts:200-200` — `fromJson` reads config from a JSON object

**When to use:** Use `ConfigProvider.fromEnv()` as the production config source (it is the default). Use `ConfigProvider.fromMap(new Map([["DB_HOST", "localhost"]]))` in tests to inject config without mutating `process.env`. Use `ConfigProvider.fromJson(json)` when config comes from a structured JSON file rather than flat environment variables.

**When NOT to use:** Don't create a custom `ConfigProvider` just to add a fallback — compose `ConfigProvider.fromMap(...).pipe(ConfigProvider.orElse(() => ConfigProvider.fromEnv()))` instead. Don't use `fromJson` for secrets — the JSON object is visible in memory; use `fromEnv` or a secrets manager integration.

**Anti-pattern it replaces:** `jest.spyOn(process, 'env').mockReturnValue({ DB_HOST: 'localhost' })` or `process.env.DB_HOST = 'localhost'` in tests — mutating global state is fragile and doesn't reset between tests. `Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(...)))` is scoped to the test.

**Related:** [`Config.string` / `integer` / `boolean` / `nested` / `all`](#configstring--integer--boolean--nested--all), [`Redacted — prevent secret values from leaking`](#redacted--prevent-secret-values-from-leaking-to-logsspans), [`Layer.merge` / `provide` / `fresh`](#layermerge--provide--fresh--layer-composition)

### Redacted — prevent secret values from leaking to logs/spans

**Signature:**
```ts
export const make: <A>(value: A) => Redacted<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Redacted.ts:75-75` — `Redacted.make` wraps any value so its `toString` / `toJSON` / inspect output is `<redacted>`

**When to use:** Use `Redacted.make(apiKey)` for any sensitive value (API keys, passwords, tokens) that must be passed through Effect pipelines without risk of appearing in logs, error messages, or OpenTelemetry spans. `Redacted` overrides `toString`, `toJSON`, and Node.js `util.inspect` to return `"<redacted>"`.

**When NOT to use:** Don't use `Redacted` for values that are legitimately shareable in logs (user IDs, request IDs). Don't use it as a substitute for proper access control — `Redacted` prevents accidental leakage, not intentional access via `Redacted.value(r)`.

**Anti-pattern it replaces:** Manually redacting sensitive fields in logging middleware: `if (key === 'password') value = '***'` — this is fragile, requires knowledge of all secret field names, and misses cases where the secret appears embedded in a larger object. `Redacted` makes the type itself opaque.

**Related:** [`Secret — memory-safe secret string`](#secret--memory-safe-secret-string), [`Config.string` / `integer` / `boolean` / `nested` / `all`](#configstring--integer--boolean--nested--all), [`Logger.make` / `withMinimumLogLevel`](#loggermake--withminimumloglevel-and-effectlog-family)

### Secret — memory-safe secret string

**Signature:**
```ts
export const make: (bytes: Array<number>) => Secret
```

**Where it appears:**
- `repos/effect/packages/effect/src/Secret.ts:60-60` — `Secret.make` stores a byte array that cannot be inadvertently serialized or printed

**When to use:** Use `Secret` for cryptographic keys, passwords, and other secrets where you also need protection against memory inspection — `Secret` stores the value as a byte array that is wiped on GC in environments that support it. Use `Secret` over `Redacted` when the value is a string credential and you want the extra byte-level protection.

**When NOT to use:** Don't use `Secret` for non-string secrets (binary blobs, structured objects) — use `Redacted` instead, which wraps any type. Don't use `Secret` if you only need logging protection without the byte-array storage model — `Redacted` is lighter.

**Anti-pattern it replaces:** Storing passwords as plain `string` in a service: `class AuthService { private readonly apiKey: string }` — visible in heap dumps and debug sessions. `Secret` stores the value in a way that reduces this risk.

**Related:** [`Redacted — prevent secret values from leaking`](#redacted--prevent-secret-values-from-leaking-to-logsspans), [`Config.string` / `integer` / `boolean` / `nested` / `all`](#configstring--integer--boolean--nested--all)

### Encoding — Base64 / hex / UTF-8 codecs

**Signature:**
```ts
export const encodeBase64: (input: Uint8Array | string) => string
export const decodeBase64: (str: string) => Either.Either<Uint8Array, DecodeException>
export const encodeBase64Url: (input: Uint8Array | string) => string
export const encodeHex: (input: Uint8Array | string) => string
export const decodeHex: (str: string) => Either.Either<Uint8Array, DecodeException>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Encoding.ts:22-23` — `encodeBase64` encodes bytes or a string to Base64
- `repos/effect/packages/effect/src/Encoding.ts:31-31` — `decodeBase64` decodes Base64 to `Uint8Array`, returning Either
- `repos/effect/packages/effect/src/Encoding.ts:47-48` — `encodeBase64Url` uses URL-safe Base64 alphabet
- `repos/effect/packages/effect/src/Encoding.ts:72-73` — `encodeHex` encodes bytes or a string to hex
- `repos/effect/packages/effect/src/Encoding.ts:81-81` — `decodeHex` decodes hex to `Uint8Array`, returning Either

**When to use:** Use `Encoding.encodeBase64` / `decodeBase64` when interfacing with APIs that use Base64 encoding — JWT payloads, file attachments, binary data in JSON. Use `encodeHex` / `decodeHex` for encoding cryptographic hashes and byte arrays as hex strings. The decode functions return `Either` so parse failures are typed, not exceptions.

**When NOT to use:** Don't use the `Encoding` module when your runtime already has a native Base64 API that works (e.g., `atob`/`btoa` in the browser or `Buffer.from(..., 'base64')` in Node.js) — use those only when you don't need Effect's typed error handling for decoding failures.

**Anti-pattern it replaces:** `Buffer.from(str, 'base64')` in Node.js — this is platform-specific and throws for invalid input. `Encoding.decodeBase64(str)` returns `Either<Uint8Array, DecodeException>` and works in any JS environment (browser, Deno, Bun, Node).

**Related:** [`Secret — memory-safe secret string`](#secret--memory-safe-secret-string), [`Redacted — prevent secret values from leaking`](#redacted--prevent-secret-values-from-leaking-to-logsspans), [`Schema.decode` / `encode` / `is` entry points](#schemadecode--encode--is-entry-points)

## Request batching & Caching

### `Request.of` / `RequestResolver.make` / `Effect.request` — request batching

**Signature:**
```ts
// Request.of
export const of: <R extends Request<any, any>>() => Request.Constructor<R>

// RequestResolver.make
export const make: <A, R>(
  runAll: (requests: Array<Array<A>>) => Effect.Effect<void, never, R>
) => RequestResolver<A, R>

// Effect.request
export const request: {
  <A extends Request.Request<any, any>, Ds extends RequestResolver<A> | Effect<RequestResolver<A>, any, any>>(
    dataSource: Ds
  ): (self: A) => Effect<Request.Request.Success<A>, Request.Request.Error<A>, ...>
  ...
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/Request.ts:112-112` — `Request.of` creates a tagged request constructor type
- `repos/effect/packages/effect/src/RequestResolver.ts:118-120` — `RequestResolver.make` batches requests into grouped calls
- `repos/effect/packages/effect/src/Effect.ts:12828-12832` — `Effect.request` issues a request through a resolver, enabling automatic batching and deduplication

**When to use:** Use the `Request` / `RequestResolver` / `Effect.request` triad for N+1 query elimination — when many concurrent Effects each need a single entity by ID, the resolver automatically batches all IDs into one query. This is the Effect equivalent of DataLoader (from GraphQL) applied to any data source.

**When NOT to use:** Don't use `Request` for single one-off queries — the overhead of defining a `Request` class and a `RequestResolver` is only justified when the same data is fetched by many concurrent callers. For a simple `fetchUser(id)` called once, use `Effect.tryPromise` directly.

**Anti-pattern it replaces:** The N+1 query problem: `const users = await Promise.all(ids.map(id => db.query("SELECT * FROM users WHERE id = $1", [id])))` — sends one query per ID. `Effect.request` with a `RequestResolver` collapses this into a single `SELECT * FROM users WHERE id = ANY($1)` batched call.

**Related:** [`Cache.make` / `ScopedCache.make`](#cachemake--scopedcachemake--effect-based-memoization), [`Effect.all` / `Effect.repeat` / `Effect.retry`](#effectall--effectrepeat--effectretry--combinators), [`Effect.gen` + `yield*`](#effectgen--yield)

### `Cache.make` / `ScopedCache.make` — effect-based memoization

**Signature:**
```ts
export const make: <Key, Value, Error = never, Environment = never>(
  options: {
    readonly capacity: number
    readonly timeToLive: Duration.DurationInput
    readonly lookup: Lookup<Key, Value, Error, Environment>
  }
) => Effect.Effect<Cache<Key, Value, Error>, never, Environment>

export const make: <Key, Value, Error = never, Environment = never>(
  options: {
    readonly lookup: Lookup<Key, Value, Error, Environment>
    readonly capacity: number
    readonly timeToLive: Duration.DurationInput
  }
) => Effect.Effect<ScopedCache<Key, Value, Error>, never, Scope.Scope | Environment>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Cache.ts:202-207` — `Cache.make` memoizes Effect-producing lookups with capacity and TTL eviction
- `repos/effect/packages/effect/src/ScopedCache.ts:119-124` — `ScopedCache.make` like `Cache.make` but each cached value is a scoped resource

**When to use:** Use `Cache.make` for memoizing expensive Effect-producing lookups — database queries by ID, external API calls for user profiles, DNS lookups. The cache deduplicates concurrent lookups for the same key (only one request fires even if 100 fibers ask for the same key simultaneously). Use `ScopedCache.make` when each cached value is itself a resource (e.g., a connection per customer).

**When NOT to use:** Don't use `Cache` when the data changes frequently and stale data is unacceptable — the TTL-based eviction is not event-driven. Don't use it as a substitute for `RequestResolver` when the batching is the main goal; `Cache` memoizes by key, `RequestResolver` batches multiple distinct keys into one call.

**Anti-pattern it replaces:** A hand-rolled `Map<Key, Promise<Value>>` cache: `if (cache.has(k)) return cache.get(k)!; const p = fetch(k); cache.set(k, p); return p` — no TTL, no capacity limit, no error handling (failed promises stay in the cache forever). `Cache.make` handles all of these correctly.

**Related:** [`Request.of` / `RequestResolver.make` / `Effect.request`](#requestof--requestresolvermake--effectrequest--request-batching), [`RcMap`](#rcref-and-rcmap--reference-counted-resources), [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](#poolmake--poolmakewithttl-and-keyedpool)

## Immutable Collections

### Chunk — typed array container (Stream's element type)

**Signature:**
```ts
export const empty: <A = never>() => Chunk<A>
export const make = <As extends readonly [any, ...ReadonlyArray<any>]>(...as: As): NonEmptyChunk<As[number]>
export const of = <A>(a: A): NonEmptyChunk<A>
export const fromIterable = <A>(self: Iterable<A>): Chunk<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Chunk.ts:225-225` — `empty` returns a shared empty Chunk singleton
- `repos/effect/packages/effect/src/Chunk.ts:233-234` — `make` creates a non-empty Chunk from varargs
- `repos/effect/packages/effect/src/Chunk.ts:242-242` — `of` wraps a single element
- `repos/effect/packages/effect/src/Chunk.ts:250-251` — `fromIterable` converts any iterable to a Chunk

**When to use:** Use `Chunk` as the element container for `Stream` pipelines — it is what `Stream.runCollect` returns and what `Sink.fold` and other accumulators produce. `Chunk` offers O(1) append and efficient concatenation (tree-structured internally), making it ideal for building up results in stream processing.

**When NOT to use:** Don't use `Chunk` as a general-purpose array replacement in non-stream code — plain `Array` is simpler and has wider ecosystem support. Don't use `Chunk` when you need random access by index frequently — it is optimized for sequential access and append.

**Anti-pattern it replaces:** Accumulating stream results with `Array.push` inside a mutable array: `const results = []; for await (const chunk of stream) results.push(...chunk)` — this loads everything into memory upfront, loses typed error handling, and has no backpressure.

**Related:** [`.from*` family](#from-family), [`Stream.make` / `fromIterable` / `fromEffect`](#streammake--fromiterable--fromeffect), [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map)

### HashMap — structural-equality keyed map

**Signature:**
```ts
export const empty: <K = never, V = never>() => HashMap<K, V>
export const make: <Entries extends ReadonlyArray<readonly [any, any]>>(
  ...entries: Entries
) => HashMap<Entries[number] extends readonly [infer K, infer V] ? K : never, ...>
export const fromIterable: <K, V>(entries: Iterable<readonly [K, V]>) => HashMap<K, V>
```

**Where it appears:**
- `repos/effect/packages/effect/src/HashMap.ts:108-108` — `empty` creates an empty HashMap
- `repos/effect/packages/effect/src/HashMap.ts:116-119` — `make` creates from key-value pairs
- `repos/effect/packages/effect/src/HashMap.ts:129-129` — `fromIterable` creates from an iterable of pairs; uses structural equality via `Equal`

**When to use:** Use `HashMap` when your keys are value objects (structs, tuples, domain types implementing `Equal`) rather than primitives. Plain `Map<K, V>` uses reference equality for keys, so `new Map([[{ id: 1 }, "alice"]])` cannot be looked up with a different `{ id: 1 }` object. `HashMap` uses `Equal.equals` for key comparison, enabling value-keyed maps.

**When NOT to use:** Don't use `HashMap` for string-keyed or number-keyed maps — plain `Map<string, V>` or a plain object is simpler and faster. Don't use `HashMap` when you need sorted key traversal — use `SortedMap` instead.

**Anti-pattern it replaces:** `new Map<Point, Color>()` where `Point = { x: number, y: number }` — lookups always miss because `{ x: 1, y: 2 } !== { x: 1, y: 2 }` by reference. `HashMap.make<Point, Color>()` with `Data.struct`-based `Point` keys works correctly.

**Related:** [`HashSet — structural-equality set`](#hashset--structural-equality-set), [`Equal.equals` interface and `Hash`](#equalequals-interface-and-hash--structural-equality), [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](#datastruct--tuple--array--class--taggedclass)

### HashSet — structural-equality set

**Signature:**
```ts
export const empty: <A = never>() => HashSet<A>
export const make: <As extends ReadonlyArray<any>>(...elements: As) => HashSet<As[number]>
export const fromIterable: <A>(elements: Iterable<A>) => HashSet<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/HashSet.ts:375-375` — `empty` creates an empty HashSet
- `repos/effect/packages/effect/src/HashSet.ts:559-559` — `make` creates from vararg elements
- `repos/effect/packages/effect/src/HashSet.ts:470-470` — `fromIterable` creates from any iterable; deduplication uses `Equal`

**When to use:** Use `HashSet` for deduplication and membership testing when elements are value objects (use `Equal` for comparison). It is also the right choice for computing set operations (union, intersection, difference) between two collections of domain objects.

**When NOT to use:** Don't use `HashSet` for primitive string or number elements — a plain `Set<string>` is simpler and faster. Don't use `HashSet` when you need sorted iteration — use `SortedSet` instead.

**Anti-pattern it replaces:** `new Set<Point>()` for value objects — deduplication fails because `{ x: 1, y: 2 } !== { x: 1, y: 2 }` by reference, so the Set keeps duplicates. `HashSet.fromIterable([p1, p2, p1])` deduplicates correctly using `Equal`.

**Related:** [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map), [`Equal.equals` interface and `Hash`](#equalequals-interface-and-hash--structural-equality), [`SortedMap / SortedSet (with Order)`](#sortedmap--sortedset-with-order)

### List — persistent linked list

**Signature:**
```ts
export const nil = <A = never>(): List<A>
export const cons = <A>(head: A, tail: List<A>): Cons<A>
export const empty = nil
export const of = <A>(value: A): Cons<A>
export const fromIterable = <A>(prefix: Iterable<A>): List<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/List.ts:251-251` — `nil` returns the empty list
- `repos/effect/packages/effect/src/List.ts:259-259` — `cons` prepends an element
- `repos/effect/packages/effect/src/List.ts:277-277` — `of` creates a singleton list
- `repos/effect/packages/effect/src/List.ts:285-295` — `fromIterable` builds a List from any iterable (reversed at each step)

**When to use:** Use `List` for recursive data processing where you prepend elements frequently — it is O(1) for `cons` (prepend) and O(1) for head/tail access, making it ideal for recursive algorithms like tree traversal, parsing, and accumulation via tail recursion. It is also Effect's immutable alternative to a stack.

**When NOT to use:** Don't use `List` when you need random access by index — it is O(n). Don't use `List` as a general-purpose sequence; `Chunk` is better for most stream-related use cases and plain `Array` is better for most application code.

**Anti-pattern it replaces:** A mutable array used as a stack with `push`/`pop`: `const stack = []; stack.push(x); stack.pop()` — the array is mutable and not persistent. `List.cons(x, tail)` creates a new list sharing the tail structurally — no copying.

**Related:** [`Chunk — typed array container`](#chunk--typed-array-container-streams-element-type), [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map)

### SortedMap / SortedSet (with Order)

**Signature:**
```ts
// SortedMap
export const empty = <K, V = never>(ord: Order<K>): SortedMap<K, V>
export const fromIterable: {
  <B>(ord: Order<B>): <K extends B, V>(iterable: Iterable<readonly [K, V]>) => SortedMap<K, V>
  <K extends B, V, B>(iterable: Iterable<readonly [K, V]>, ord: Order<B>): SortedMap<K, V>
}

// SortedSet
export const empty = <A>(O: Order<A>): SortedSet<A>
export const make = <K>(ord: Order<K>) => <Entries extends ReadonlyArray<K>>(...entries: Entries): SortedSet<Entries[number]>
```

**Where it appears:**
- `repos/effect/packages/effect/src/SortedMap.ts:92-92` — `SortedMap.empty` creates an empty sorted map with a given `Order`
- `repos/effect/packages/effect/src/SortedMap.ts:100-102` — `SortedMap.fromIterable` builds from entries using an `Order`
- `repos/effect/packages/effect/src/SortedSet.ts:92-92` — `SortedSet.empty` creates an empty sorted set
- `repos/effect/packages/effect/src/SortedSet.ts:113-115` — `SortedSet.make` creates from vararg elements with an `Order`

**When to use:** Use `SortedMap` / `SortedSet` when you need both value-based equality and sorted key ordering — for example, a priority queue of tasks sorted by due date, or a map of scheduled events where you frequently need to find the minimum. The `Order` parameter lets you sort by any comparison function.

**When NOT to use:** Don't use `SortedMap` when order doesn't matter — `HashMap` is faster for pure key lookup. Don't use it for large datasets where you need sub-linear range queries — `RedBlackTree` gives more direct control over range operations.

**Anti-pattern it replaces:** Manually sorting a `Map.entries()` array on each access: `[...map.entries()].sort(([a], [b]) => compare(a, b))` — O(n log n) on every read. `SortedMap` maintains the sort invariant on every insert and gives O(log n) ordered iteration.

**Related:** [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map), [`HashSet — structural-equality set`](#hashset--structural-equality-set), [`RedBlackTree`](#redblacktree)

### RedBlackTree

**Signature:**
```ts
export const empty: <K, V = never>(ord: Order<K>) => RedBlackTree<K, V>
export const fromIterable: {
  <B>(ord: Order<B>): <K extends B, V>(entries: Iterable<readonly [K, V]>) => RedBlackTree<K, V>
  <K extends B, V, B>(entries: Iterable<readonly [K, V]>, ord: Order<B>): RedBlackTree<K, V>
}
export const make: <K>(ord: Order<K>) => <Entries extends Array<readonly [K, any]>>(...entries: Entries) => RedBlackTree<K, ...>
export const insert: {
  <K, V>(key: K, value: V): (self: RedBlackTree<K, V>) => RedBlackTree<K, V>
  <K, V>(self: RedBlackTree<K, V>, key: K, value: V): RedBlackTree<K, V>
}
```

**Where it appears:**
- `repos/effect/packages/effect/src/RedBlackTree.ts:68-68` — `empty` creates an empty tree with an `Order`
- `repos/effect/packages/effect/src/RedBlackTree.ts:76-78` — `fromIterable` builds from sorted-order entries
- `repos/effect/packages/effect/src/RedBlackTree.ts:87-89` — `make` creates from vararg key-value pairs
- `repos/effect/packages/effect/src/RedBlackTree.ts:235-237` — `insert` is the primary mutation returning a new tree

**When to use:** Use `RedBlackTree` when you need O(log n) insertion, deletion, and ordered range queries on a self-balancing sorted structure. It is the underlying implementation of `SortedMap` and `SortedSet`. Use it directly when you need operations like "find all keys between A and B" or "find the predecessor/successor of a key."

**When NOT to use:** Don't use `RedBlackTree` directly when `SortedMap` or `SortedSet` already provides the interface you need — they are more ergonomic wrappers. Don't use it for string prefix searches — `Trie` is purpose-built for that.

**Anti-pattern it replaces:** A sorted array with binary search: `arr.sort(cmp); const i = binarySearch(arr, key)` — O(n) insertions. `RedBlackTree.insert` is O(log n) and produces a new persistent tree sharing structure with the old one.

**Related:** [`SortedMap / SortedSet (with Order)`](#sortedmap--sortedset-with-order), [`Trie`](#trie), [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map)

### Trie

**Signature:**
```ts
export const empty: <V = never>() => Trie<V>
export const fromIterable: <V>(entries: Iterable<readonly [string, V]>) => Trie<V>
export const make: <Entries extends Array<readonly [string, any]>>(
  ...entries: Entries
) => Trie<Entries[number] extends readonly [any, infer V] ? V : never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Trie.ts:60-60` — `empty` creates an empty Trie
- `repos/effect/packages/effect/src/Trie.ts:81-81` — `fromIterable` builds from string-keyed entries
- `repos/effect/packages/effect/src/Trie.ts:100-102` — `make` creates from vararg `[string, V]` pairs

**When to use:** Use `Trie` for prefix-based lookups — autocomplete, URL routing, command-line argument parsing, or any scenario where you need to find all values whose key starts with a given prefix. `Trie.keysWithPrefix("app")` returns all keys starting with `"app"` in O(prefix length + result count).

**When NOT to use:** Don't use `Trie` for non-string keys — it is specifically a string-key structure. Don't use `Trie` for exact-key lookups only with no prefix queries — `HashMap` is faster and simpler for that.

**Anti-pattern it replaces:** Filtering a `Map` by key prefix: `[...map.entries()].filter(([k]) => k.startsWith("app"))` — O(n) scan on every prefix query. `Trie.keysWithPrefix` is O(prefix length + result count).

**Related:** [`RedBlackTree`](#redblacktree), [`HashMap — structural-equality keyed map`](#hashmap--structural-equality-keyed-map)

## Unverified (not yet cited)

(All 90 patterns above have been verified with `repos/` citations. No patterns were moved here.)
