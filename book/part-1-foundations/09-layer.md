# Chapter 09 — Layer: building, merging, and providing services

> **Patterns introduced:** [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors), [`Layer.merge` / `provide` / `fresh` — Layer composition](../../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition)
> **Reads from:** [Chapter 08 — Context and Tags](08-context-and-tags.md)
> **Reads into:** [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md), every Part II tour, Part III (worked example)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 08 introduced Tags — typed identifiers that mark service slots in the `R` parameter of an effect. If you write `yield* Database` inside `Effect.gen`, TypeScript infers `R = Database` on the enclosing effect. When you provide the service, `R` collapses to `never`. Clean, safe, composable.

But Chapter 08 left one question open: *how do you actually construct services, especially when they are non-trivial?*

`Effect.provideService(Tag, value)` works if you already have the value in hand. But real services rarely arrive fully formed. Consider what a production `Database` service actually needs:

**Construction logic.** A database connection pool must be opened before use. That involves reading configuration (host, port, credentials), performing an async handshake, and potentially running a health check. None of that is a pure value — it is an Effect.

**Dependencies on other services.** The `Database` service likely depends on a `Config` service (to read the connection string) and a `Logger` service (to record slow queries). Those dependencies must be provided *before* the `Database` can be built.

**Resource lifetime.** The connection pool is not just data — it is a resource. When the application shuts down (or a test ends), the pool must be drained and sockets closed. If you forget, connections leak. In JavaScript there is no RAII and no destructor; you need a mechanism that guarantees cleanup even when an exception or interruption fires.

**Composition.** A real application might have 30 services, each depending on 1–5 others. Wiring them by hand — calling `Effect.provideService` thirty times in the right order — is error-prone and invisible to the type system. Forget one service and you get a runtime crash instead of a compile error. Add a new dependency to a service deep in the graph and you must hunt down every call site that constructs it.

Plain TypeScript solutions do not compose cleanly here. Factory functions make the dependency graph implicit. DI containers are invisible to the compiler.

Effect's answer is `Layer<ROut, E, RIn>`.

A Layer is a typed recipe for building one or more services. It carries three type parameters: `ROut` is the set of services the Layer *produces*, `E` is the error type that can occur during construction, and `RIn` is the set of services the Layer *requires* from the outside. This mirrors the structure of `Effect<A, E, R>` but at the service-graph level.

Layers are **values** — they describe construction without performing it. Nothing runs until you pass a Layer to `Effect.provide`. They are **composable** — you can wire them with `Layer.provide` and `Layer.merge` to build larger graphs. And they are **typechecked** — if a required service is missing, the compiler tells you at the `Effect.provide` call site, not at runtime.

The type parameter order is `Layer<ROut, E, RIn>` — verified at `repos/effect/packages/effect/src/Layer.ts:65`: `interface Layer<in ROut, out E = never, out RIn = never>`. `ROut` is contravariant (consumed from outside), while `E` and `RIn` are covariant (they flow out to the caller).

---

## The minimal example

```ts
import { Context, Effect, Layer } from "effect"

// A Tag for a simple Database service (from Chapter 08).
class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// Layer.succeed: provide a pure value implementation.
const DatabaseLive = Layer.succeed(Database, {
  query: (_sql) => Effect.succeed([])
})
// DatabaseLive : Layer<Database, never, never>
//                             ^      ^      ^
//                           ROut     E    RIn (no deps, no errors)

// Business logic that requires the Database service.
const program = Effect.gen(function* () {
  const db = yield* Database
  return yield* db.query("SELECT 1")
})
// program : Effect<ReadonlyArray<unknown>, never, Database>

// Effect.provide runs the Layer and supplies the Context.
const runnable = program.pipe(Effect.provide(DatabaseLive))
// runnable : Effect<ReadonlyArray<unknown>, never, never>
```

Three observations: `Layer.succeed` wraps a plain value into a Layer with `RIn = never` (no dependencies). `Effect.provide` accepts the Layer, runs it, and removes `Database` from the effect's `R`. The resulting effect has `R = never` and can be run with `Effect.runPromise`.

---

## How it works

### Part A — Layer constructors

**`Layer.succeed(Tag, value)`** — `repos/effect/packages/effect/src/Layer.ts:766-775`

The simplest constructor. Takes a Tag and a value that satisfies the Tag's service shape, returns a `Layer<I, never, never>`. Use it for services with no initialization logic: in-memory stubs, plain configuration records, or test doubles.

```ts
import { Context, Layer } from "effect"

class AppConfig extends Context.Tag("app/Config")<
  AppConfig,
  { readonly port: number; readonly host: string }
>() {}

const ConfigLive = Layer.succeed(AppConfig, { port: 8080, host: "localhost" })
// Layer<AppConfig, never, never>
```

**`Layer.effect(Tag, makeEffect)`** — `repos/effect/packages/effect/src/Layer.ts:285-292`

When the service must be built via an Effect — because construction is async, reads config, or needs another service — use `Layer.effect`. The Effect's `R` becomes the Layer's `RIn`:

```ts
import { Context, Effect, Layer } from "effect"

class AppConfig extends Context.Tag("app/Config")<
  AppConfig,
  { readonly port: number; readonly host: string }
>() {}

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* AppConfig          // requires AppConfig
    const pool = yield* Effect.promise(
      () => openPool(config.host, config.port) // async setup
    )
    return { query: (sql) => Effect.promise(() => pool.query(sql)) }
  })
)
// DatabaseLive : Layer<Database, never, AppConfig>
//                                       ^^^^^^^^^ RIn = AppConfig

declare function openPool(host: string, port: number): Promise<{ query: (s: string) => Promise<ReadonlyArray<unknown>> }>
```

The `DatabaseLive` Layer now *requires* `AppConfig`. That requirement surfaces in the type and must be satisfied before the Layer can be run — which is exactly what `Layer.provide` does.

**`Layer.scoped(Tag, scopedEffect)`** — `repos/effect/packages/effect/src/Layer.ts:721-735`

When the service owns a resource that must be released (connections, file handles, background fibers), use `Layer.scoped`. The effect you supply should use `Effect.acquireRelease` (covered in Chapter 10 — Layer.scoped and Scope) to pair acquisition with a cleanup finalizer. The `Scope` from the scoped effect is absorbed by the Layer — the Layer manages the scope's lifetime. The `Exclude<R, Scope>` in the return type reflects this: callers do not see `Scope` in the Layer's `RIn`.

```ts
import { Context, Effect, Layer } from "effect"

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

declare function openPool(): Promise<{ query: (s: string) => Promise<ReadonlyArray<unknown>>; end: () => Promise<void> }>

const DatabaseScoped = Layer.scoped(
  Database,
  Effect.acquireRelease(
    Effect.promise(() => openPool()),              // acquire
    (pool) => Effect.promise(() => pool.end())     // release — guaranteed on scope close
  ).pipe(
    Effect.map((pool) => ({ query: (sql) => Effect.promise(() => pool.query(sql)) }))
  )
)
// DatabaseScoped : Layer<Database, never, never>
```

Chapter 10 covers `Layer.scoped` in depth alongside `Effect.acquireRelease` and `Scope`.

**`Layer.fail(error)` / `Layer.die(defect)`** — `repos/effect/packages/effect/src/Layer.ts:334-338` / `:258-264`

These construct Layers that always fail or die during construction. They are useful in tests (to simulate a broken dependency) and as sentinel values in conditional layer wiring.

```ts
import { Data, Layer } from "effect"

class DbError extends Data.TaggedError("DbError")<{ reason: string }> {}

// A Layer that always fails — useful in test scenarios.
const BrokenDatabase = Layer.fail(new DbError({ reason: "connection refused" }))
```

### Part B — Layer composition

**`Layer.merge(a, b)`** — `repos/effect/packages/effect/src/Layer.ts:562-575`

Combines two independent Layers side-by-side, running their constructors concurrently. The resulting Layer provides both services:

```ts
import { Context, Effect, Layer } from "effect"

class Logger extends Context.Tag("app/Logger")<
  Logger,
  { readonly log: (msg: string) => Effect.Effect<void> }
>() {}

class Cache extends Context.Tag("app/Cache")<
  Cache,
  { readonly get: (key: string) => Effect.Effect<string | undefined> }
>() {}

const LoggerLive = Layer.succeed(Logger, { log: (msg) => Effect.sync(() => console.log(msg)) })
const CacheLive = Layer.succeed(Cache, { get: (_key) => Effect.succeed(undefined) })

const ServicesLive = Layer.merge(LoggerLive, CacheLive)
// ServicesLive : Layer<Logger | Cache, never, never>
```

`Layer.mergeAll` — `repos/effect/packages/effect/src/Layer.ts:578-589` — is the variadic form for combining three or more independent layers at once:

```ts
import { Layer } from "effect"

declare const LayerA: Layer.Layer<{ readonly a: string }>
declare const LayerB: Layer.Layer<{ readonly b: number }>
declare const LayerC: Layer.Layer<{ readonly c: boolean }>

const AllLayers = Layer.mergeAll(LayerA, LayerB, LayerC)
// Layer<{ readonly a: string } | { readonly b: number } | { readonly c: boolean }, never, never>
```

**`Layer.provide(layer, dependency)`** — `repos/effect/packages/effect/src/Layer.ts:891-926`

The fundamental wiring operation. Feeds the output of `dependency` into the input of `layer`. The result has `ROut = layer.ROut` and `RIn = (layer.RIn - dependency.ROut) | dependency.RIn` — in other words, the satisfied requirements disappear and the dependency's own requirements appear in their place:

```ts
import { Context, Effect, Layer } from "effect"

class AppConfig extends Context.Tag("app/Config")<AppConfig, { port: number }>() {}
class Database extends Context.Tag("app/Database")<
  Database,
  { query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

const ConfigLive = Layer.succeed(AppConfig, { port: 5432 })

const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const { port } = yield* AppConfig
    return { query: (_sql) => Effect.succeed([{ port }]) }
  })
)
// DatabaseLive : Layer<Database, never, AppConfig>

// Wire: ConfigLive satisfies DatabaseLive's AppConfig requirement.
const DatabaseWithConfig = DatabaseLive.pipe(Layer.provide(ConfigLive))
// DatabaseWithConfig : Layer<Database, never, never>
```

**`Layer.provideMerge(layer, dependency)`** — `repos/effect/packages/effect/src/Layer.ts:928-944`

Like `Layer.provide`, but the dependency's output is *also* surfaced in the result's `ROut`. Both the dependency's services and the layer's services are available downstream. This is the pattern used for building up a cumulative context:

```ts
import { Layer } from "effect"

declare const ConfigLive: Layer.Layer<{ port: number }>
declare const DatabaseLive: Layer.Layer<{ query: (s: string) => unknown }, never, { port: number }>

// provideMerge: result provides both Config AND Database.
const AppLayers = DatabaseLive.pipe(Layer.provideMerge(ConfigLive))
// Layer<{ port: number } | { query: ... }, never, never>
```

**`Layer.fresh(layer)`** — `repos/effect/packages/effect/src/Layer.ts:393-397`

By default, when a Layer appears multiple times in a dependency graph, Effect memoizes it — the Layer's constructor runs exactly once, and all dependents share the single instance. `Layer.fresh` opts a particular Layer out of this memoization, forcing a new instance to be built each time it is encountered in the graph.

In tests this is useful when two test suites both depend on an in-memory database and you want each to have its own isolated state:

```ts
import { Layer } from "effect"

declare const InMemoryDatabase: Layer.Layer<{ query: (s: string) => unknown }>

// Each use of FreshDatabase gets its own instance — no shared state.
const FreshDatabase = Layer.fresh(InMemoryDatabase)
```

Do not use `Layer.fresh` in production. Memoization exists for good reasons — connection pools, background fibers, and stateful services should not be duplicated. Reserve `Layer.fresh` for test isolation scenarios.

### Part C — How `Effect.provide` works with Layers

`Effect.provide(effect, layer)` does three things at runtime: builds the Layer graph (running each constructor in dependency order, concurrently where possible), assembles a `Context`, and runs `effect` with it — then tears down the graph.

Two behavioral details matter.

**Memoization within a single `Effect.provide` call.** If two services in the graph both require `Database`, and `Database` is the same Layer reference, that Layer runs exactly once. Both consumers get the same instance. From the `Layer.ts` module header (`repos/effect/packages/effect/src/Layer.ts:12-13`): "By default layers are shared, meaning that if the same layer is used twice the layer will only be allocated a single time."

**Layers are lazy values.** Constructors run only when the Layer is provided to an Effect — not at declaration time. A `DatabaseLive` defined at module scope is safe to import without fear of connection leaks.

---

## A production example

Here is a realistic four-service graph: `Config` is provided as a pure value; `Logger` is built from Config; `Database` is built from Config and Logger; `UserRepository` is built from Database. Each service is its own Layer, and the graph is assembled with `Layer.provide` and `Layer.merge`.

```ts
import { Context, Effect, Layer } from "effect"

// ---- Tags ----

class AppConfig extends Context.Tag("app/Config")<
  AppConfig,
  { readonly dbUrl: string; readonly logLevel: string }
>() {}

class AppLogger extends Context.Tag("app/Logger")<
  AppLogger,
  { readonly info: (msg: string) => Effect.Effect<void> }
>() {}

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

class UserRepository extends Context.Tag("app/UserRepository")<
  UserRepository,
  { readonly findAll: () => Effect.Effect<ReadonlyArray<{ id: number; name: string }>> }
>() {}

// ---- Layers ----

// Layer 1: Config — pure value, no dependencies.
const ConfigLive = Layer.succeed(AppConfig, {
  dbUrl: "postgres://localhost/myapp",
  logLevel: "info"
})
// Layer<AppConfig, never, never>

// Layer 2: Logger — needs Config to read the log level.
const LoggerLive = Layer.effect(
  AppLogger,
  Effect.gen(function* () {
    const cfg = yield* AppConfig
    return {
      info: (msg) =>
        cfg.logLevel === "info"
          ? Effect.sync(() => console.log(`[INFO] ${msg}`))
          : Effect.void
    }
  })
)
// Layer<AppLogger, never, AppConfig>

// Layer 3: Database — needs Config (for the URL) and Logger (for slow-query logging).
const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const cfg = yield* AppConfig
    const logger = yield* AppLogger
    yield* logger.info(`Connecting to ${cfg.dbUrl}`)
    return {
      query: (sql) =>
        Effect.gen(function* () {
          yield* logger.info(`SQL: ${sql}`)
          return []
        })
    }
  })
)
// Layer<Database, never, AppConfig | AppLogger>

// Layer 4: UserRepository — needs only Database.
const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      findAll: () =>
        db.query("SELECT id, name FROM users").pipe(
          Effect.map((rows) => rows as ReadonlyArray<{ id: number; name: string }>)
        )
    }
  })
)
// Layer<UserRepository, never, Database>

// ---- Assemble the full graph ----

// Wire Config into Logger, satisfying AppConfig.
const LoggerWithConfig = LoggerLive.pipe(Layer.provide(ConfigLive))
// Layer<AppLogger, never, never>

// Wire Config + Logger into Database, satisfying both requirements.
const DatabaseWithDeps = DatabaseLive.pipe(
  Layer.provide(Layer.merge(ConfigLive, LoggerWithConfig))
)
// Layer<Database, never, never>

// Wire Database into UserRepository.
const UserRepositoryWithDeps = UserRepositoryLive.pipe(
  Layer.provide(DatabaseWithDeps)
)
// Layer<UserRepository, never, never>

// ---- Program ----

const program = Effect.gen(function* () {
  const repo = yield* UserRepository
  const users = yield* repo.findAll()
  return users
})

const runnable = program.pipe(Effect.provide(UserRepositoryWithDeps))
// Effect<ReadonlyArray<{ id: number; name: string }>, never, never>
```

This pattern — named `*Live` Layers wired with `Layer.provide` and `Layer.merge` — is the standard idiom across the Effect ecosystem. A real-world instance is `NodeContext.layer` in `@effect/platform-node` (`repos/effect/packages/platform-node/src/NodeContext.ts:32-40`), which uses `Layer.mergeAll` to combine four independent Node.js service layers and then `Layer.provideMerge` to thread a filesystem Layer through the combined result:

```ts
// repos/effect/packages/platform-node/src/NodeContext.ts:32-40
export const layer: Layer.Layer<NodeContext> = pipe(
  Layer.mergeAll(
    NodePath.layer,
    NodeCommandExecutor.layer,
    NodeTerminal.layer,
    NodeWorker.layerManager
  ),
  Layer.provideMerge(NodeFileSystem.layer)
)
```

The same approach — assemble independent service Layers with `mergeAll`, then wire a shared dependency with `provideMerge` — scales from four services to forty.

---

## Variations

```ts
import { Context, Data, Effect, Layer } from "effect"

class Svc extends Context.Tag("app/Svc")<Svc, { readonly run: () => Effect.Effect<void> }>() {}
class Dep extends Context.Tag("app/Dep")<Dep, { readonly value: number }>() {}

// 1. Layer.succeed — pure value, no deps, no errors.
const SvcFromValue = Layer.succeed(Svc, { run: () => Effect.void })
// Layer<Svc, never, never>

// 2. Layer.effect — built by an Effect; the Effect's R becomes the Layer's RIn.
const SvcFromEffect = Layer.effect(
  Svc,
  Effect.gen(function* () {
    const dep = yield* Dep
    return { run: () => Effect.sync(() => console.log(dep.value)) }
  })
)
// Layer<Svc, never, Dep>

// 3. Layer.scoped — resource-bound; see Chapter 10 for the full pattern.
const SvcScoped = Layer.scoped(
  Svc,
  Effect.acquireRelease(
    Effect.sync(() => ({ run: () => Effect.void, close: () => {} })),
    (s) => Effect.sync(() => s.close())
  ).pipe(Effect.map(({ run }) => ({ run })))
)
// Layer<Svc, never, never>

// 4. Layer.fail / Layer.die — for tests or error-path wiring.
class BuildError extends Data.TaggedError("BuildError")<{ cause: string }> {}
const BrokenSvc = Layer.fail(new BuildError({ cause: "intentional" }))
// Layer<unknown, BuildError, never>

// 5. Layer.merge / mergeAll — combine independent layers side-by-side.
const DepLive = Layer.succeed(Dep, { value: 42 })
const Combined = Layer.merge(SvcFromValue, DepLive)
// Layer<Svc | Dep, never, never>

// 6. Layer.provide / provideMerge — wire a dependency into a layer.
const SvcWired = SvcFromEffect.pipe(Layer.provide(DepLive))
// Layer<Svc, never, never>

// 7. Layer.fresh — disable memoization (test isolation only).
const FreshSvc = Layer.fresh(SvcFromValue)
// Layer<Svc, never, never> — rebuilt each time it appears in a graph
```

---

## Anti-patterns

**Anti-pattern 1 — Plain factory functions for service construction.**

```ts
// WRONG: factory function hides the dependency graph from the type system.
function makeDatabase(config: AppConfig): DatabaseService {
  return { query: (_sql) => Promise.resolve([]) }
}

function makeUserRepo(db: DatabaseService): UserRepoService {
  return { findAll: () => Promise.resolve([]) }
}

// Wiring is implicit — you must know to call makeDatabase before makeUserRepo.
// Adding a new dependency means updating the factory signature and every call site.
declare type AppConfig = { dbUrl: string }
declare type DatabaseService = { query: (sql: string) => Promise<ReadonlyArray<unknown>> }
declare type UserRepoService = { findAll: () => Promise<ReadonlyArray<unknown>> }
```

The right move: use `Layer.effect` so the dependency graph is encoded in the type system. Missing or mismatched services are compile-time errors, not runtime crashes.

```ts
import { Context, Effect, Layer } from "effect"

class AppConfig extends Context.Tag("app/Config")<AppConfig, { dbUrl: string }>() {}
class DatabaseService extends Context.Tag("app/Database")<
  DatabaseService,
  { query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// The Layer's RIn = AppConfig — the type tells you what is required.
const DatabaseLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const { dbUrl } = yield* AppConfig
    return { query: (_sql) => Effect.succeed([{ from: dbUrl }]) }
  })
)
```

**Anti-pattern 2 — Providing services one at a time with `Effect.provideService`.**

```ts
import { Context, Effect } from "effect"

class Logger extends Context.Tag("Logger")<Logger, { log: (s: string) => Effect.Effect<void> }>() {}
class Database extends Context.Tag("Database")<Database, { query: (s: string) => Effect.Effect<ReadonlyArray<unknown>> }>() {}
class Cache extends Context.Tag("Cache")<Cache, { get: (k: string) => Effect.Effect<string | undefined> }>() {}

declare const program: Effect.Effect<void, never, Logger | Database | Cache>

// WRONG: manually stacking provideService calls is fragile.
const runnable = program.pipe(
  Effect.provideService(Logger, { log: (s) => Effect.sync(() => console.log(s)) }),
  Effect.provideService(Database, { query: (_s) => Effect.succeed([]) }),
  Effect.provideService(Cache, { get: (_k) => Effect.succeed(undefined) })
)
// As services grow, this becomes a maintenance burden.
// Reordering or removing a service causes cascading edits.
```

The right move: build a single combined Layer with `Layer.merge` or `Layer.mergeAll` and provide it once with `Effect.provide`. The Layer graph handles ordering automatically.

```ts
import { Context, Effect, Layer } from "effect"

class Logger extends Context.Tag("Logger")<Logger, { log: (s: string) => Effect.Effect<void> }>() {}
class Database extends Context.Tag("Database")<Database, { query: (s: string) => Effect.Effect<ReadonlyArray<unknown>> }>() {}
class Cache extends Context.Tag("Cache")<Cache, { get: (k: string) => Effect.Effect<string | undefined> }>() {}

declare const program: Effect.Effect<void, never, Logger | Database | Cache>

const LoggerLive = Layer.succeed(Logger, { log: (s) => Effect.sync(() => console.log(s)) })
const DatabaseLive = Layer.succeed(Database, { query: (_s) => Effect.succeed([]) })
const CacheLive = Layer.succeed(Cache, { get: (_k) => Effect.succeed(undefined) })

const AppLayer = Layer.mergeAll(LoggerLive, DatabaseLive, CacheLive)

const runnable = program.pipe(Effect.provide(AppLayer))
// One provide call. Adding a new service = add one Layer.succeed + add to mergeAll.
```

**Anti-pattern 3 — Re-running expensive setup by accident.**

```ts
import { Context, Effect, Layer } from "effect"

class Database extends Context.Tag("Database")<
  Database,
  { query: (s: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

declare const expensivePool: Layer.Layer<Database>

class Logger extends Context.Tag("Logger")<Logger, { log: (s: string) => Effect.Effect<void> }>() {}
declare const LoggerLive: Layer.Layer<Logger, never, Database>

// WRONG: two different references to the same logical layer force two instantiations.
const AppLayer = Layer.merge(
  LoggerLive.pipe(Layer.provide(Layer.fresh(expensivePool))),
  expensivePool  // fresh copy above + original here = two pool instances
)
```

The right move: rely on Effect's automatic Layer memoization. If `expensivePool` is the same Layer reference throughout the graph, it runs exactly once. Only reach for `Layer.fresh` when you explicitly need isolated instances — for example, per-test in-memory databases — and never in production code. From the `Layer.ts` module header (`repos/effect/packages/effect/src/Layer.ts:12-13`): "By default layers are shared, meaning that if the same layer is used twice the layer will only be allocated a single time."

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the `Effect<A, E, R>` type and the `R` requirements parameter
- [Chapter 05 — Effect.gen](05-effect-gen.md) — the generator syntax used to build Layer effects
- [Chapter 08 — Context and Tags](08-context-and-tags.md) — the Tags that Layers produce and effects consume
- [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md) — resource-owning layers with `acquireRelease` and finalizers
- [Chapter 11 — Constructors](11-constructors.md) — the `.make` convention for service constructor functions
- [Patterns Catalog: Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors)
- [Patterns Catalog: Layer composition](../../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition)
- [Per-package note: effect](../../research/packages/effect.md)
- [House conventions](../../research/03-conventions.md) — `*Live` / `*Default` Layer naming conventions
