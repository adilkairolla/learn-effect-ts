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
- `repos/effect/packages/effect/src/Context.ts:290` — `Context.make` creates a single-service context from a tag and value
- `repos/effect/packages/effect/src/Ref.ts:69` — `Ref.make` builds an atomic mutable cell returning an Effect
- `repos/effect/packages/effect/src/Deferred.ts:88` — `Deferred.make` creates a one-shot async value
- `repos/effect/packages/effect/src/Chunk.ts:242` — `Chunk.of` wraps a single element into a NonEmptyChunk

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
- `repos/effect/packages/effect/src/HashMap.ts:129` — build a `HashMap` from key-value iterable entries
- `repos/effect/packages/effect/src/Stream.ts:2086-2087` — lift an iterable into a pure stream
- `repos/effect/packages/effect/src/Stream.ts:2019` — lift a single Effect value into a one-element stream

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
- `repos/effect/packages/effect/src/Effect.ts:2760-2790` — generator-based sequential composition; `yield*` unwraps each `Effect` value

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
- `repos/effect/packages/effect/src/Effect.ts:3160` — `succeed` lifts a pure value into Effect
- `repos/effect/packages/effect/src/Effect.ts:2575` — `fail` creates a failed Effect with typed error
- `repos/effect/packages/effect/src/Effect.ts:3326` — `sync` defers a synchronous computation
- `repos/effect/packages/effect/src/Effect.ts:3131` — `promise` wraps a Promise (no error channel)
- `repos/effect/packages/effect/src/Effect.ts:4677` — `tryPromise` wraps a Promise with error mapping

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
- `repos/effect/packages/effect/src/Effect.ts:12279` — `runSync` executes an Effect synchronously (throws on async/failure)
- `repos/effect/packages/effect/src/Effect.ts:12064-12067` — `runFork` starts an Effect as a detached fiber

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
- `repos/effect/packages/effect/src/Effect.ts:825` — `all` runs many Effects, optionally in parallel
- `repos/effect/packages/effect/src/Effect.ts:4400` — `retry` retries a failing Effect with a `Schedule`
- `repos/effect/packages/effect/src/Effect.ts:10178` — `repeat` repeats a successful Effect with a `Schedule`

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
- `repos/effect/packages/effect/src/Effect.ts:13585` — `Effect.Service` generates a tag + layer class from a plain object definition

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
- `repos/effect/packages/effect/src/Runtime.ts:205` — `defaultRuntime` is the standard runtime with no requirements

### RuntimeFlags — concurrency, tracing, interruption controls

**Signature:**
```ts
export type RuntimeFlags = number & { readonly RuntimeFlags: unique symbol }

export const make: (...flags: ReadonlyArray<RuntimeFlag>) => RuntimeFlags
export const none: RuntimeFlags
```

**Where it appears:**
- `repos/effect/packages/effect/src/RuntimeFlags.ts:19` — `RuntimeFlags` is a bitset controlling runtime features
- `repos/effect/packages/effect/src/RuntimeFlags.ts:275` — `make` builds a flags bitset from individual `RuntimeFlag` values
- `repos/effect/packages/effect/src/RuntimeFlags.ts:281` — `none` is an empty flags value

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
- `repos/effect/packages/effect/src/Reloadable.ts:101` — `Reloadable.manual` allows on-demand reload via `Reloadable.reload`

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
- `repos/effect/packages/effect/src/Cause.ts:591` — `fail` wraps a typed error into a Cause
- `repos/effect/packages/effect/src/Cause.ts:607` — `die` represents an unexpected defect (no error type)
- `repos/effect/packages/effect/src/Cause.ts:623` — `interrupt` represents fiber interruption
- `repos/effect/packages/effect/src/Cause.ts:639` — `parallel` composes two simultaneous causes
- `repos/effect/packages/effect/src/Cause.ts:655` — `sequential` composes two sequential causes

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
- `repos/effect/packages/effect/src/Effect.ts:3948` — `catchTags` handles multiple variants via a case record
- `repos/effect/packages/effect/src/Effect.ts:4246` — `sandbox` exposes the full `Cause` for inspection

### Exit — Effect outcome value (Success / Failure of Cause)

**Signature:**
```ts
export const succeed: <A>(value: A) => Exit<A>
export const fail: <E>(error: E) => Exit<never, E>
export const die: (defect: unknown) => Exit<never, never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Exit.ts:359` — `Exit.succeed` wraps a successful value
- `repos/effect/packages/effect/src/Cause.ts:591` — `Cause.fail` (used inside `Exit.fail`) wraps a typed failure

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
- `repos/effect/packages/effect/src/Option.ts:187` — `some` wraps a value
- `repos/effect/packages/effect/src/Option.ts:162` — `none` represents absence
- `repos/effect/packages/effect/src/Option.ts:684` — `fromNullable` converts a nullable value
- `repos/effect/packages/effect/src/Option.ts:923` — `map` transforms the wrapped value
- `repos/effect/packages/effect/src/Option.ts:1047` — `flatMap` chains Option-returning functions
- `repos/effect/packages/effect/src/Option.ts:500` — `getOrElse` extracts with a fallback

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
- `repos/effect/packages/effect/src/Either.ts:120` — `right` represents a success value
- `repos/effect/packages/effect/src/Either.ts:138` — `left` represents an error value
- `repos/effect/packages/effect/src/Either.ts:365` — `map` transforms the right value
- `repos/effect/packages/effect/src/Either.ts:647` — `flatMap` chains Either-returning functions
- `repos/effect/packages/effect/src/Either.ts:734` — `all` sequences multiple Eithers

### Bridging Option/Either ↔ Effect (fromOption, fromEither, getOrFail)

**Signature:**
```ts
// Wrap an Effect's result into Option/Either
export const option: <A, E, R>(self: Effect<A, E, R>) => Effect<Option.Option<A>, never, R>
export const either: <A, E, R>(self: Effect<A, E, R>) => Effect<Either.Either<A, E>, never, R>

// Exit conversions
export const fromEither: <R, L>(either: Either.Either<R, L>) => Exit<R, L>
export const fromOption: <A>(option: Option.Option<A>) => Exit<A, void>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Effect.ts:8109` — `Effect.option` turns a failing Effect into `Effect<Option<A>, never, R>`
- `repos/effect/packages/effect/src/Effect.ts:8180` — `Effect.either` captures errors as `Either<A, E>` removing the error channel
- `repos/effect/packages/effect/src/Exit.ts:234` — `Exit.fromEither` converts an `Either` into an `Exit` value
- `repos/effect/packages/effect/src/Exit.ts:242` — `Exit.fromOption` converts an `Option` into an `Exit` value

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
- `repos/effect/packages/effect/src/Schema.ts:561` — `decodeUnknown` accepts `unknown` input, useful at API boundaries

## Streams & Concurrency

### `Stream.make` / `fromIterable` / `fromEffect`

**Signature:**
```ts
export const make: <As extends Array<any>>(...as: As) => Stream<As[number]>
export const fromIterable: <A>(iterable: Iterable<A>) => Stream<A>
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Stream<A, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Stream.ts:2700` — `make` creates a finite stream from varargs
- `repos/effect/packages/effect/src/Stream.ts:2086-2087` — `fromIterable` creates a pure stream from any iterable
- `repos/effect/packages/effect/src/Stream.ts:2019` — `fromEffect` emits a single value produced by an Effect

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

### `Stream.paginate`

**Signature:**
```ts
export const paginate: <S, A>(
  s: S,
  f: (s: S) => readonly [A, Option.Option<S>]
) => Stream<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Stream.ts:3380` — unfolds a paginated data source; returns `[element, Some(nextCursor)]` or `[element, None]` to terminate

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

### Fiber — joining, interrupting, racing (Effect.fork return type)

**Signature:**
```ts
export const join: <A, E>(self: Fiber<A, E>) => Effect.Effect<A, E>
export const interrupt: <A, E>(self: Fiber<A, E>) => Effect.Effect<Exit.Exit<A, E>>
export const all: <A, E>(fibers: Iterable<Fiber<A, E>>) => Fiber<ReadonlyArray<A>, E>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Fiber.ts:527` — `join` awaits a fiber's completion and extracts its value
- `repos/effect/packages/effect/src/Fiber.ts:451` — `interrupt` sends an interruption signal and waits for exit
- `repos/effect/packages/effect/src/Fiber.ts:378` — `all` creates a composite fiber that joins all fibers in a collection

### FiberId — fiber identity and lineage

**Signature:**
```ts
export const make: (id: number, startTimeSeconds: number) => FiberId
export const none: None
export const composite: (left: FiberId, right: FiberId) => Composite
```

**Where it appears:**
- `repos/effect/packages/effect/src/FiberId.ts:162` — `make` creates a runtime fiber ID with a timestamp
- `repos/effect/packages/effect/src/FiberId.ts:71` — `none` is the empty/sentinel fiber ID
- `repos/effect/packages/effect/src/FiberId.ts:83` — `composite` merges two fiber IDs (for parallel forks)

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
- `repos/effect/packages/effect/src/Supervisor.ts:141` — `track` creates a supervisor that collects all live fibers
- `repos/effect/packages/effect/src/Supervisor.ts:125` — `fromEffect` builds a supervisor from a polling Effect

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
- `repos/effect/packages/effect/src/Scope.ts:152` — `Scope.close` finalizes all resources registered with the scope

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
- `repos/effect/packages/effect/src/Channel.ts:2015` — `succeed` creates a channel that completes immediately with a value
- `repos/effect/packages/effect/src/Channel.ts:1084-1086` — `fromEffect` lifts an Effect into a Channel
- `repos/effect/packages/effect/src/Channel.ts:1151` — `identity` passes all inputs through unchanged

### Sink — Stream consumer / aggregator

**Signature:**
```ts
export interface Sink<out A, in In = unknown, out L = never, out E = never, out R = never> { ... }

export const drain: Sink<void, unknown>
export const fold: <S, In>(s: S, contFn: Predicate<S>, f: (s: S, input: In) => S) => Sink<S, In, In>
export const fromEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Sink<A, unknown, never, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Sink.ts:48` — `Sink` interface definition
- `repos/effect/packages/effect/src/Sink.ts:442` — `drain` consumes all elements and discards them
- `repos/effect/packages/effect/src/Sink.ts:651` — `fold` accumulates stream elements into a summary value
- `repos/effect/packages/effect/src/Sink.ts:992-993` — `fromEffect` creates a sink from a constant Effect result

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
- `repos/effect/packages/effect/src/Scope.ts:152` — `close` runs all registered finalizers

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

### ScopedRef — scope-attached mutable reference

**Signature:**
```ts
export const make: <A>(evaluate: LazyArg<A>) => Effect.Effect<ScopedRef<A>, never, Scope.Scope>
```

**Where it appears:**
- `repos/effect/packages/effect/src/ScopedRef.ts:101-102` — `ScopedRef.make` creates a mutable reference whose resources are managed by a Scope; replacing the value releases the old one

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
- `repos/effect/packages/effect/src/Data.ts:47` — `struct` creates a structurally equatable plain object
- `repos/effect/packages/effect/src/Data.ts:76` — `tuple` creates a structurally equatable tuple
- `repos/effect/packages/effect/src/Data.ts:104` — `array` creates a structurally equatable array
- `repos/effect/packages/effect/src/Data.ts:203-205` — `Class` makes an equatable class with readonly fields
- `repos/effect/packages/effect/src/Data.ts:232-235` — `TaggedClass` adds a `_tag` discriminant to `Class`

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
- `repos/effect/packages/effect/src/index.ts:687` — `LayerMap` re-export shows the namespaced `export * as` convention
- `repos/effect/packages/effect/src/Effect.ts:6283` — public API delegates to `internal/` implementation

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
- `repos/effect/packages/effect/src/Effect.ts:2` — `@since 2.0.0` file-level tag
- `repos/effect/packages/effect/src/Effect.ts:78-80` — `@category` grouping and `@since` on individual exports

## Concurrency primitives

### `Ref` — atomic mutable cell

**Signature:**
```ts
export const make: <A>(value: A) => Effect.Effect<Ref<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Ref.ts:69` — `Ref.make` creates an atomically-updatable mutable cell inside an Effect

### `SubscriptionRef` — observable Ref

**Signature:**
```ts
export const make: <A>(value: A) => Effect.Effect<SubscriptionRef<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/SubscriptionRef.ts:148` — `SubscriptionRef.make` creates a `Ref` that also emits a `Stream` of changes on each update

### `Queue` — unbounded / bounded / sliding / dropping

**Signature:**
```ts
export const unbounded: <A>() => Effect.Effect<Queue<A>>
export const bounded: <A>(requestedCapacity: number) => Effect.Effect<Queue<A>>
export const sliding: <A>(requestedCapacity: number) => Effect.Effect<Queue<A>>
export const dropping: <A>(requestedCapacity: number) => Effect.Effect<Queue<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Queue.ts:473` — `unbounded` creates a queue with no capacity limit
- `repos/effect/packages/effect/src/Queue.ts:435` — `bounded` suspends producers when full
- `repos/effect/packages/effect/src/Queue.ts:465` — `sliding` drops oldest elements when full
- `repos/effect/packages/effect/src/Queue.ts:450` — `dropping` drops new elements when full

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
- `repos/effect/packages/effect/src/Effect.ts:11852` — `makeSemaphore` creates the semaphore Effect

### `Deferred` — one-shot async value

**Signature:**
```ts
export const make: <A, E = never>() => Effect.Effect<Deferred<A, E>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Deferred.ts:88` — `Deferred.make` creates a one-shot promise-like that can be completed from another fiber

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

### SynchronizedRef — atomic effectful update

**Signature:**
```ts
export const make: <A>(value: A) => Effect.Effect<SynchronizedRef<A>>
```

**Where it appears:**
- `repos/effect/packages/effect/src/SynchronizedRef.ts:71` — `SynchronizedRef.make` creates a Ref whose `modifyEffect` operations are serialized (atomic effectful updates)

### RateLimiter — token-bucket rate limiting

**Signature:**
```ts
export const make: (options: RateLimiter.Options) => Effect<RateLimiter, never, Scope>
```

**Where it appears:**
- `repos/effect/packages/effect/src/RateLimiter.ts:98` — `RateLimiter.make` creates a token-bucket rate limiter with `limit` and `interval` options

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
- `repos/effect/packages/effect/src/Effect.ts:10850` — `Effect.log` emits at the default log level
- `repos/effect/packages/effect/src/Effect.ts:10937-10980` — `logDebug` / `logInfo` / `logWarning` / `logError` emit at specific levels

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

## State management

### `STM.gen` / `STM.atomically` — software transactional memory

**Signature:**
```ts
export const gen: <Self, Eff extends YieldWrap<STM<any, any, any>>, AEff>(
  ...args: [self: Self, body: (this: Self, resume: Adapter) => Generator<Eff, AEff, never>]
    | [body: (resume: Adapter) => Generator<Eff, AEff, never>]
) => STM<AEff, ...>

export const commit: <A, E, R>(self: STM<A, E, R>) => Effect.Effect<A, E, R>
```

**Where it appears:**
- `repos/effect/packages/effect/src/STM.ts:1073-1077` — `STM.gen` composes transactional operations in a generator
- `repos/effect/packages/effect/src/STM.ts:424` — `commit` executes an STM transaction atomically as an Effect

### `TRef` / `TQueue` / `TMap` / `TSemaphore` — STM-aware variants

**Signature:**
```ts
export const make: <A>(value: A) => STM.STM<TRef<A>>                    // TRef
export const bounded: <A>(requestedCapacity: number) => STM.STM<TQueue<A>>  // TQueue
export const make: <K, V>(...entries: Array<readonly [K, V]>) => STM.STM<TMap<K, V>>  // TMap
export const make: (permits: number) => STM.STM<TSemaphore>             // TSemaphore
```

**Where it appears:**
- `repos/effect/packages/effect/src/TRef.ts:106` — `TRef.make` creates a transactional mutable reference
- `repos/effect/packages/effect/src/TQueue.ts:221` — `TQueue.bounded` creates a transactional bounded queue
- `repos/effect/packages/effect/src/TMap.ts:201` — `TMap.make` creates a transactional key-value map
- `repos/effect/packages/effect/src/TSemaphore.ts:75` — `TSemaphore.make` creates a transactional semaphore

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
- `repos/effect/packages/effect/src/Schedule.ts:1757` — `spaced` waits a fixed delay between each recurrence
- `repos/effect/packages/effect/src/Schedule.ts:1049` — `fixed` recurs on a fixed absolute interval
- `repos/effect/packages/effect/src/Schedule.ts:1003-1005` — `exponential` backs off with an exponential multiplier
- `repos/effect/packages/effect/src/Schedule.ts:1604` — `recurs` runs exactly N times

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
- `repos/effect/packages/effect/src/Schedule.ts:1232` — `jittered` adds random noise to delays to avoid thundering-herd effects
- `repos/effect/packages/effect/src/Schedule.ts:530-533` — `compose` pipes one schedule's output as another's input (e.g., `exponential |> jittered`)

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
- `repos/effect/packages/effect/src/Cron.ts:293` — `Cron.parse` parses a cron expression string into a typed `Cron` value
- `repos/effect/packages/effect/src/Cron.ts:138-144` — `Cron.make` builds a cron schedule from field iterables
- `repos/effect/packages/effect/src/DateTime.ts:490` — `DateTime.now` returns the current UTC timestamp as an Effect
- `repos/effect/packages/effect/src/DateTime.ts:464` — `DateTime.make` parses a date input into an `Option<DateTime>`
- `repos/effect/packages/effect/src/DateTime.ts:1529` — `DateTime.format` formats a DateTime for display

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
- `repos/effect/packages/effect/src/Random.ts:29` — `Random` interface (service definition)
- `repos/effect/packages/effect/src/Random.ts:146` — `Random` Tag for dependency injection
- `repos/effect/packages/effect/src/Random.ts:171` — `make` creates a deterministic seeded RNG (for testing)
- `repos/effect/packages/effect/src/Random.ts:65` — `next` draws the next `[0,1)` float from the service

## Pattern matching

### `Match.value` / `Match.type` — starting a match

**Signature:**
```ts
export const value: <const I>(i: I) => Matcher<I, Types.Without<never>, I, never, I>
export const type: <I>() => Matcher<I, Types.Without<never>, I, never, never>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Match.ts:237-239` — `value` starts a match on a specific runtime value
- `repos/effect/packages/effect/src/Match.ts:195` — `type` starts a match on a type only (no runtime value yet, returns a function)

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
- `repos/effect/packages/effect/src/Config.ts:406` — `string` reads a string config value by name
- `repos/effect/packages/effect/src/Config.ts:186` — `integer` reads and parses an integer
- `repos/effect/packages/effect/src/Config.ts:130` — `boolean` reads a boolean flag
- `repos/effect/packages/effect/src/Config.ts:281-283` — `nested` scopes a config under a name prefix
- `repos/effect/packages/effect/src/Config.ts:103-105` — `all` combines multiple configs into a record or tuple

### `ConfigProvider.fromEnv` / `fromMap` / `fromJson`

**Signature:**
```ts
export const fromEnv: (options?: Partial<ConfigProvider.FromEnvConfig>) => ConfigProvider
export const fromMap: (map: Map<string, string>, config?: Partial<ConfigProvider.FromMapConfig>) => ConfigProvider
export const fromJson: (json: unknown) => ConfigProvider
```

**Where it appears:**
- `repos/effect/packages/effect/src/ConfigProvider.ts:183` — `fromEnv` reads config from `process.env`
- `repos/effect/packages/effect/src/ConfigProvider.ts:210-211` — `fromMap` reads config from an in-memory `Map` (used in tests)
- `repos/effect/packages/effect/src/ConfigProvider.ts:200` — `fromJson` reads config from a JSON object

### Redacted — prevent secret values from leaking to logs/spans

**Signature:**
```ts
export const make: <A>(value: A) => Redacted<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/Redacted.ts:75` — `Redacted.make` wraps any value so its `toString` / `toJSON` / inspect output is `<redacted>`

### Secret — memory-safe secret string

**Signature:**
```ts
export const make: (bytes: Array<number>) => Secret
```

**Where it appears:**
- `repos/effect/packages/effect/src/Secret.ts:60` — `Secret.make` stores a byte array that cannot be inadvertently serialized or printed

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
- `repos/effect/packages/effect/src/Encoding.ts:22` — `encodeBase64` encodes bytes or a string to Base64
- `repos/effect/packages/effect/src/Encoding.ts:31` — `decodeBase64` decodes Base64 to `Uint8Array`, returning Either
- `repos/effect/packages/effect/src/Encoding.ts:47` — `encodeBase64Url` uses URL-safe Base64 alphabet
- `repos/effect/packages/effect/src/Encoding.ts:72` — `encodeHex` encodes bytes or a string to hex
- `repos/effect/packages/effect/src/Encoding.ts:81` — `decodeHex` decodes hex to `Uint8Array`, returning Either

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
- `repos/effect/packages/effect/src/Request.ts:112` — `Request.of` creates a tagged request constructor type
- `repos/effect/packages/effect/src/RequestResolver.ts:118-120` — `RequestResolver.make` batches requests into grouped calls
- `repos/effect/packages/effect/src/Effect.ts:12828-12832` — `Effect.request` issues a request through a resolver, enabling automatic batching and deduplication

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
- `repos/effect/packages/effect/src/Chunk.ts:225` — `empty` returns a shared empty Chunk singleton
- `repos/effect/packages/effect/src/Chunk.ts:233-234` — `make` creates a non-empty Chunk from varargs
- `repos/effect/packages/effect/src/Chunk.ts:242` — `of` wraps a single element
- `repos/effect/packages/effect/src/Chunk.ts:250-251` — `fromIterable` converts any iterable to a Chunk

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
- `repos/effect/packages/effect/src/HashMap.ts:108` — `empty` creates an empty HashMap
- `repos/effect/packages/effect/src/HashMap.ts:116-119` — `make` creates from key-value pairs
- `repos/effect/packages/effect/src/HashMap.ts:129` — `fromIterable` creates from an iterable of pairs; uses structural equality via `Equal`

### HashSet — structural-equality set

**Signature:**
```ts
export const empty: <A = never>() => HashSet<A>
export const make: <As extends ReadonlyArray<any>>(...elements: As) => HashSet<As[number]>
export const fromIterable: <A>(elements: Iterable<A>) => HashSet<A>
```

**Where it appears:**
- `repos/effect/packages/effect/src/HashSet.ts:375` — `empty` creates an empty HashSet
- `repos/effect/packages/effect/src/HashSet.ts:559` — `make` creates from vararg elements
- `repos/effect/packages/effect/src/HashSet.ts:470` — `fromIterable` creates from any iterable; deduplication uses `Equal`

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
- `repos/effect/packages/effect/src/List.ts:251` — `nil` returns the empty list
- `repos/effect/packages/effect/src/List.ts:259` — `cons` prepends an element
- `repos/effect/packages/effect/src/List.ts:277` — `of` creates a singleton list
- `repos/effect/packages/effect/src/List.ts:285` — `fromIterable` builds a List from any iterable (reversed at each step)

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
- `repos/effect/packages/effect/src/SortedMap.ts:92` — `SortedMap.empty` creates an empty sorted map with a given `Order`
- `repos/effect/packages/effect/src/SortedMap.ts:100-102` — `SortedMap.fromIterable` builds from entries using an `Order`
- `repos/effect/packages/effect/src/SortedSet.ts:92` — `SortedSet.empty` creates an empty sorted set
- `repos/effect/packages/effect/src/SortedSet.ts:113-115` — `SortedSet.make` creates from vararg elements with an `Order`

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
- `repos/effect/packages/effect/src/RedBlackTree.ts:68` — `empty` creates an empty tree with an `Order`
- `repos/effect/packages/effect/src/RedBlackTree.ts:76-78` — `fromIterable` builds from sorted-order entries
- `repos/effect/packages/effect/src/RedBlackTree.ts:87-89` — `make` creates from vararg key-value pairs
- `repos/effect/packages/effect/src/RedBlackTree.ts:235-237` — `insert` is the primary mutation returning a new tree

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
- `repos/effect/packages/effect/src/Trie.ts:60` — `empty` creates an empty Trie
- `repos/effect/packages/effect/src/Trie.ts:81` — `fromIterable` builds from string-keyed entries
- `repos/effect/packages/effect/src/Trie.ts:100-102` — `make` creates from vararg `[string, V]` pairs

## Unverified (not yet cited)

(All 90 patterns above have been verified with `repos/` citations. No patterns were moved here.)
