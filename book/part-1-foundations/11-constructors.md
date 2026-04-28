# Chapter 11 — Constructors: `.make`, `.of`, `.from*` and the naming conventions

> **Patterns introduced:** [`.from*` family](../../research/02-patterns-catalog.md#from-family), [`ManagedRuntime.make`](../../research/02-patterns-catalog.md#managedruntimemake)
> **Reads from:** [Chapter 02 — Effect as a value](02-effect-as-a-value.md), [Chapter 09 — Layer](09-layer.md)
> **Reads into:** Part III — the worked example uses these conventions throughout
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

You have just pulled in a new Effect package. You open the module. There are fifty exports. Which one builds a new instance of the primary type?

In a typical TypeScript codebase the answer depends entirely on who wrote the code. You might find `new DatabasePool(config)` in one package, `createPool(config)` in another, `buildPool(config)` in a third, `Pool.init(config)` in a fourth, and `makePool(config)` — with the type name embedded in the function name — in a fifth. None of those choices is wrong, exactly, but they make every package its own vocabulary lesson.

This naming inconsistency compounds quickly. Suppose you are authoring a library of your own: you need to decide whether to call your constructor `create`, `build`, `init`, `make`, or something else entirely. You may make a different choice than the package you depend on. Consumers of your package now face the same guessing game.

The problem runs deeper than aesthetics. Naming conventions carry implicit semantics. A function called `create` doesn't tell you whether it returns the value synchronously, wraps it in an Effect, or allocates a resource that needs cleanup. A function called `init` might run side effects. A function called `build` might be a step in a larger builder chain. Without a convention that connects name to behavior, callers have to read implementation details to understand what a constructor does.

Effect solves this by applying a small set of names — `.make`, `.of`, and the `.from*` family — consistently across all 36 packages. Once you recognize the pattern in `Ref.make`, you know what to expect from `Pool.make`, `Deferred.make`, `Scope.make`, and `Cache.make` before reading a single line of documentation. Once you see `Stream.fromIterable`, you can predict that `Chunk.fromIterable`, `HashMap.fromIterable`, and `HashSet.fromIterable` exist and behave analogously. The convention is the documentation.

This chapter maps the full taxonomy: what each name means, what it signals about return type and resource ownership, and where the boundaries between them lie.

---

## The minimal example

```ts
import { Context, Effect, Layer, Logger, ManagedRuntime, Pool, Ref, Stream } from "effect"

// .make — build a new value (pure or effectful depending on the module)
const ctx = Context.make(Ref, await Effect.runPromise(Ref.make(0)))

// .make returning an Effect — resource creation deferred to runtime
const makeRef = Ref.make(42)
// Effect<Ref<number>, never, never>

// .make accepting config — structured constructor
const customLogger = Logger.make(({ logLevel, message }) =>
  globalThis.console.log(`[${logLevel.label}] ${message}`)
)

// .from* — adapt an existing value into the target type
const numbersStream = Stream.fromIterable([1, 2, 3])
// Stream<number, never, never>

// Layer constructors — .succeed, .effect, .scoped (not .make)
class Cache extends Effect.Tag("app/Cache")<Cache, { get: (k: string) => Effect.Effect<string> }>() {}
const CacheLive = Layer.succeed(Cache, { get: (k) => Effect.succeed(`value:${k}`) })

// ManagedRuntime.make — long-lived runtime from a Layer
const runtime = ManagedRuntime.make(CacheLive)
await runtime.dispose()
```

---

## How it works

### Part A — `.make`: the workhorse constructor

`.make` is the conventional name for the primary constructor of a module's central type. It appears in almost every module that produces a structured value. The name is deliberately generic — it does not encode the type name, so `Pool.make` rather than `makePool` — and it signals "this is how you get one of these."

What `.make` returns varies by module and reflects the resource semantics of the type:

**Synchronous (pure value returned directly):**

`Context.make(tag, service)` returns a `Context<I>` immediately — there is no effect because a `Context` is a plain immutable map. Source: `repos/effect/packages/effect/src/Context.ts:290`.

`Logger.make(logFn)` returns a `Logger<Message, Output>` immediately — a logger is a pure function wrapper with no lifecycle. Source: `repos/effect/packages/effect/src/Logger.ts:107-110`.

`Stream.make(...values)` returns a `Stream<A>` immediately — the stream description is a pure value; execution is deferred. Source: `repos/effect/packages/effect/src/Stream.ts:2699-2700`.

**Effectful (wrapped in `Effect<T>`):**

`Ref.make(value)` returns `Effect<Ref<A>>` — the mutable cell must be allocated inside the runtime. Source: `repos/effect/packages/effect/src/Ref.ts:65-69`.

`Deferred.make()` returns `Effect<Deferred<A, E>>` — same rationale: a one-shot async promise cell belongs to the fiber system. Source: `repos/effect/packages/effect/src/Deferred.ts:82-88`.

`Scope.make()` returns `Effect<CloseableScope>` — a closeable scope must participate in the resource lifecycle. Source: `repos/effect/packages/effect/src/Scope.ts:196-204`.

**Scoped (wrapped in `Effect<T, E, Scope>`):**

`Pool.make({ acquire, size })` returns `Effect<Pool<A, E>, never, Scope>` — the pool owns resources and must be shut down when the surrounding scope closes. Source: `repos/effect/packages/effect/src/Pool.ts:112-122`.

The rule of thumb: if the thing you are constructing has a lifecycle (must be closed, finalized, or garbage-collected intentionally), `.make` returns an `Effect` that requires a `Scope`. If the thing is a pure description or a plain mutable cell managed by the fiber runtime, `.make` returns a plain `Effect`. If the thing is a pure value with no runtime involvement at all, `.make` returns the value directly.

The prefix variant `.makeWith*` extends the primary constructor with extra options. `Pool.makeWithTTL` at `repos/effect/packages/effect/src/Pool.ts:158-181` takes a `min`/`max` size range and a time-to-live for eviction, in addition to the standard `acquire` option. `Effect.makeSemaphore(n)` at `repos/effect/packages/effect/src/Effect.ts:11852` returns `Effect<Semaphore>` — a named variant because `Effect` is a namespace of operators, not a type that has one "obvious" `.make`.

### Part B — `.of`: single-element pure construction

`.of` is narrower than `.make`. It appears when a module's type is a container and you want to lift a single pure value into it — with no effects, no config, no allocation.

`Chunk.of(a)` at `repos/effect/packages/effect/src/Chunk.ts:242` wraps a single element into a `NonEmptyChunk<A>`. The `NonEmpty` in the return type is the key signal: `.of` guarantees at least one element, so the type system can reflect that.

`.of` is deliberately rare in modern Effect. The team has converged on `.make` for most constructors and reserved `.of` for the typeclass-style "pure" lift familiar from functional programming (`Applicative.of`, `Monad.of`). If you are authoring a new module and you need a single-element constructor, prefer `.make` unless your type genuinely has the typeclass structure.

Notable absence: `Effect` itself does not have `Effect.of`. The analogous operation is `Effect.succeed(value)`, which uses the leaf constructor names described in Part D below.

### Part C — the `.from*` family: adapter constructors

The `.from*` family is the largest and most consistent constructor pattern in Effect. Every name follows the template: `TypeName.fromSourceType`. The source type tells you exactly what you are adapting from — no guessing.

The family spans all data structures and Effect types:

**Stream adapters** (source: `repos/effect/packages/effect/src/Stream.ts`):
- `Stream.fromIterable(iter)` — any `Iterable<A>` becomes a pure stream. Line `2086`.
- `Stream.fromAsyncIterable(iter, onError)` — any `AsyncIterable<A>` becomes an async stream. Line `1903`.
- `Stream.fromEffect(effect)` — a single-valued `Effect<A, E, R>` becomes a one-element stream. Line `2019`.
- `Stream.fromQueue(queue)` — a `Dequeue<A>` becomes a stream that pulls from the queue. Line `2148`.
- `Stream.fromPubSub(pubsub)` — a `PubSub<A>` becomes a stream subscribed to the hub. Line `2041`.
- `Stream.fromReadableStream(fn, onError)` — a Web Streams `ReadableStream` becomes an Effect stream. Line `2172`.
- `Stream.fromSchedule(schedule)` — a `Schedule<A>` ticks become stream elements. Line `2231`.

**Effect adapters** (source: `repos/effect/packages/effect/src/Effect.ts`):
- `Effect.fromFiber(fiber)` — join a running `Fiber<A, E>` as an Effect. Line `6534`.
- `Effect.fromNullable(value)` — convert `A | null | undefined` to `Effect<NonNullable<A>, NoSuchElementException>`. Line `13248`.

**Collection adapters** (source: `repos/effect/packages/effect/src/Chunk.ts` and `HashMap.ts`):
- `Chunk.fromIterable(iter)` — any `Iterable<A>` to a `Chunk<A>`.
- `HashMap.fromIterable(entries)` — `Iterable<[K, V]>` to a `HashMap<K, V>`.

The `.from*` family is the canonical interop layer between plain JavaScript values and Effect's typed structures. When you have a JS array, a `ReadableStream`, a `Promise`, or a fiber, you reach for the matching `.from*` constructor. The name encodes the source type, so you can find it without reading docs.

### Part D — leaf constructor names: `.succeed`, `.fail`, `.die`, `.empty`, `.never`

Modules that produce effect-bearing types expose a short vocabulary of leaf constructors. These appear consistently across `Effect`, `Stream`, `Layer`, and others:

| Name | Meaning | Examples |
|------|---------|---------|
| `.succeed(value)` | Lift a pure value into the success channel | `Effect.succeed` (line `3160`), `Stream.succeed` (line `4770`) |
| `.fail(error)` | Lift a typed error into the error channel | `Effect.fail` (line `2575`), `Stream.fail` (line `1581`) |
| `.die(defect)` | Inject an untyped defect (unchecked failure) | `Effect.die` (line `2647`), `Stream.die` (line `1250`) |
| `.empty` | The identity / empty value | `Stream.empty` (line `1470`), `Cause.empty` (line `575`) |
| `.never` | A non-terminating value | `Effect.never` (line `3058`), `Stream.never` (line `3149`) |

`Layer` uses a slightly different set: `Layer.succeed`, `Layer.effect`, and `Layer.scoped` are its three primary constructors, each carrying a scoped-resource sense rather than an error sense. `Layer.succeed(Tag, value)` at `repos/effect/packages/effect/src/Layer.ts:772-775` injects a pure value. `Layer.effect(Tag, effect)` at line `289-292` runs an effect during construction. `Layer.scoped(Tag, effect)` at line `727-735` runs a scoped effect and registers its finalizer with the outer `Scope`.

---

## A production example

This example builds a minimal application entry point that exercises all four constructor families. Each constructor is annotated with its source location.

```ts
import {
  Console,
  Context,
  Effect,
  Layer,
  Logger,
  ManagedRuntime,
  Pool,
  Ref,
  Stream
} from "effect"

// ── Service definition ──────────────────────────────────────────────────────

class AppDatabase extends Effect.Tag("app/Database")<
  AppDatabase,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// ── Custom logger via Logger.make ────────────────────────────────────────────
// Logger.make: repos/effect/packages/effect/src/Logger.ts:107-110
// Returns Logger<Message, Output> directly — pure value, no Effect wrapper.

const structuredLogger = Logger.make(({ logLevel, message, date }) =>
  globalThis.console.log(
    JSON.stringify({ level: logLevel.label, msg: String(message), ts: date.toISOString() })
  )
)

// ── Database stub via Layer.effect ───────────────────────────────────────────
// Layer.effect: repos/effect/packages/effect/src/Layer.ts:283-292
// Constructs a Layer by running an Effect during service initialization.

const DatabaseLive: Layer.Layer<AppDatabase> = Layer.effect(
  AppDatabase,
  Effect.gen(function* () {
    yield* Effect.logInfo("initializing database connection")
    return {
      query: (sql) => Effect.succeed([{ result: sql }])
    }
  })
)

// ── Connection pool via Layer.scoped + Pool.make ─────────────────────────────
// Pool.make: repos/effect/packages/effect/src/Pool.ts:112-122
// Returns Effect<Pool<A, E>, never, Scope> — scoped resource.
// Layer.scoped: repos/effect/packages/effect/src/Layer.ts:721-735
// Wraps the scoped Effect, registering Pool cleanup with the Layer's Scope.

class ConnectionPool extends Effect.Tag("app/ConnectionPool")<
  ConnectionPool,
  Pool.Pool<{ id: number }, never>
>() {}

let nextId = 0
const ConnectionPoolLive = Layer.scoped(
  ConnectionPool,
  Pool.make({
    acquire: Effect.sync(() => ({ id: ++nextId })),
    size: 4
  })
)

// ── Stream adapter via Stream.fromIterable ───────────────────────────────────
// Stream.fromIterable: repos/effect/packages/effect/src/Stream.ts:2086
// Adapts a plain JS iterable — the .from* family's interop point.

const seedStream = Stream.fromIterable(["alice", "bob", "carol"])

// ── Entry-point runtime via ManagedRuntime.make ──────────────────────────────
// ManagedRuntime.make: repos/effect/packages/effect/src/ManagedRuntime.ts:177-180
// Builds a long-lived runtime whose lifetime matches the Layer's scope.

const AppLayer = Layer.mergeAll(
  DatabaseLive,
  ConnectionPoolLive,
  Logger.add(structuredLogger)
)

async function main() {
  const runtime = ManagedRuntime.make(AppLayer)

  await runtime.runPromise(
    Effect.gen(function* () {
      const db = yield* AppDatabase
      const rows = yield* db.query("SELECT 1")
      yield* Effect.logInfo(`query returned ${rows.length} row(s)`)

      yield* Stream.runForEach(seedStream, (name) =>
        Effect.logInfo(`seeding user: ${name}`)
      )
    })
  )

  await runtime.dispose()
}

main()
```

Every constructor family appears exactly once: `.make` in `Pool.make`, `.from*` in `Stream.fromIterable`, `Layer.effect` and `Layer.scoped` as Layer-specific variants, and `ManagedRuntime.make` to cap the entry point.

---

## Variations

- **`.make` — synchronous** — `Context.make(Tag, service)` returns `Context<I>` directly. `Logger.make(fn)` returns `Logger<M, O>` directly. Source: `repos/effect/packages/effect/src/Context.ts:290` and `repos/effect/packages/effect/src/Logger.ts:110`.

- **`.make` — effectful** — `Ref.make(value)` returns `Effect<Ref<A>>`. `Deferred.make()` returns `Effect<Deferred<A, E>>`. Source: `repos/effect/packages/effect/src/Ref.ts:69` and `repos/effect/packages/effect/src/Deferred.ts:88`.

- **`.make` — scoped** — `Pool.make({ acquire, size })` returns `Effect<Pool<A, E>, never, Scope>`. `Scope.make()` returns `Effect<CloseableScope>`. Source: `repos/effect/packages/effect/src/Pool.ts:115` and `repos/effect/packages/effect/src/Scope.ts:202`.

- **`.makeWith*` — extended constructors** — `Pool.makeWithTTL({ acquire, min, max, timeToLive })` at `repos/effect/packages/effect/src/Pool.ts:171` adds eviction semantics to `Pool.make`. `Effect.makeSemaphore(n)` at `repos/effect/packages/effect/src/Effect.ts:11852` follows the same prefix pattern for a semantically distinct constructor.

- **`.fromIterable` / `.fromAsyncIterable`** — the widest `.from*` variants. `Stream.fromIterable` at `repos/effect/packages/effect/src/Stream.ts:2086`. `Stream.fromAsyncIterable` at `repos/effect/packages/effect/src/Stream.ts:1903`. The same names exist on `Chunk`, `HashMap`, and `HashSet`.

- **`.succeed` / `.fail` / `.die`** — leaf constructors for typed-error-bearing types. `Effect.succeed` at `repos/effect/packages/effect/src/Effect.ts:3160`. `Stream.fail` at `repos/effect/packages/effect/src/Stream.ts:1581`. `Effect.die` at `repos/effect/packages/effect/src/Effect.ts:2647`.

- **`Layer.succeed` / `Layer.effect` / `Layer.scoped`** — Layer's specific constructor names. `Layer.succeed` at `repos/effect/packages/effect/src/Layer.ts:772`. `Layer.effect` at line `289`. `Layer.scoped` at line `727`. Note that Layer does not expose a plain `.make` — its three named constructors cover the three resource-ownership cases.

- **`ManagedRuntime.make(layer)`** — converts a fully-composed `Layer<R, E, never>` into a long-lived runtime. Source: `repos/effect/packages/effect/src/ManagedRuntime.ts:177-180`. The only constructor in the `ManagedRuntime` namespace.

---

## Anti-patterns

**Using `new` directly without going through a constructor convention.**

```ts
// Wrong: plain object — no Effect typing, no lifecycle management
class MyCache {
  private store = new Map<string, string>()
  get(k: string) { return this.store.get(k) }
  set(k: string, v: string) { this.store.set(k, v) }
}
const cache = new MyCache()
```

```ts
// Right: expose a .make constructor so consumers get an Effect-typed handle
import { Effect, Ref } from "effect"

const makeCache = Effect.gen(function* () {
  const store = yield* Ref.make(new Map<string, string>())
  return {
    get: (k: string) => Ref.get(store).pipe(Effect.map((m) => m.get(k))),
    set: (k: string, v: string) =>
      Ref.update(store, (m) => new Map(m).set(k, v))
  }
})
```

The Effect-typed version is testable (you can provide a test `Ref`), composable (it works in `Layer.effect`), and visible to the type system.

**Inventing your own constructor name (`create`, `build`, `init`).**

```ts
// Wrong: `createLogger` is invisible to readers familiar with Effect conventions
export const createLogger = (prefix: string) => ({ log: (msg: string) => console.log(prefix, msg) })
```

```ts
// Right: use Logger.make so callers recognize it immediately
import { Logger } from "effect"

export const makeLogger = (prefix: string) =>
  Logger.make(({ message }) => globalThis.console.log(`${prefix} ${message}`))
```

Consistent naming means a reader who has used any one Effect module can navigate yours without reading documentation. The naming convention is the documentation.

**Putting side effects in a `.of` or synchronous `.make` constructor.**

```ts
// Wrong: side effect hidden inside what looks like a pure constructor
const makeCounter = (start: number) => {
  console.log("counter started")  // side effect!
  return { value: start }
}
```

```ts
// Right: pure constructors are pure; effectful construction returns an Effect
import { Console, Effect, Ref } from "effect"

const makeCounter = (start: number) =>
  Effect.gen(function* () {
    yield* Console.log("counter started")
    return yield* Ref.make(start)
  })
```

The return type signals the contract. `Effect<T>` means "construction has effects." A synchronous return means "this is a pure value." Mixing them erodes the signal and makes code harder to reason about.

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the leaf constructors `.succeed`, `.fail`, `.sync`, `.promise`
- [Chapter 09 — Layer](09-layer.md) — `Layer.succeed`, `Layer.effect`, `Layer.scoped` as Layer-specific constructor names
- [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md) — `Scope.make` / `Scope.close` in depth
- [Chapter 18 — Data, Equal, Hash](18-data-equal-hash.md) — `Data.struct` / `Data.Class` as additional constructor conventions
- [Patterns Catalog: `.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors)
- [Patterns Catalog: `.from*` family](../../research/02-patterns-catalog.md#from-family)
- [Patterns Catalog: `ManagedRuntime.make`](../../research/02-patterns-catalog.md#managedruntimemake)
- [House conventions](../../research/03-conventions.md)
- [Per-package note: effect](../../research/packages/effect.md)
