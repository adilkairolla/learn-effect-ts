# Chapter 10 — `Layer.scoped` and Scope: resource lifecycles

> **Patterns introduced:** [`Layer.scoped` (resource layers)](../../research/02-patterns-catalog.md#layerscoped-resource-layers), [`Effect.acquireRelease` / `acquireUseRelease`](../../research/02-patterns-catalog.md#effectacquirerelease--acquireuserelease), [`Scope.make` / `Scope.fork` / `Scope.close`](../../research/02-patterns-catalog.md#scopemake--scopefork--scopeclose)
> **Reads from:** [Chapter 05 — Effect.gen](05-effect-gen.md), [Chapter 09 — Layer](09-layer.md)
> **Reads into:** [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md), Part III worked example (`effect-cache`)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 09 showed how to build and wire services with `Layer`. One Layer constructor appeared in passing — `Layer.scoped` — and was immediately deferred to this chapter. The deferral was intentional: resource lifetimes deserve their own treatment.

Consider what a production `Database` service actually owns: a connection pool with sockets held open, internal timers, and kernel resources behind every connection. When the program shuts down, the pool must be drained. When a test suite finishes, its pool must be closed before the next suite starts. "Must" here is strong: leaking connections exhausts the database's connection limit, blocks other clients, and in cloud environments can trigger billing surprises long after the process exits.

JavaScript gives us a few tools for this, and every one falls short in composition.

**`try/finally`** is the workhorse. It works locally for a single resource:

```ts
const handle = fs.openSync("/tmp/x", "r")
try {
  return process(handle)
} finally {
  fs.closeSync(handle)
}
```

Add a second resource and the nesting begins. Add a third and you have three levels of `try/finally`, each with its own release that must appear in the right order. Errors inside one `finally` block can shadow errors from the other. Async operations make the nesting worse: `await` inside `finally` is silent on some runtimes. And the entire stack evaporates on thread (fiber) interruption — `finally` does not run if the enclosing async context is abandoned.

**`using` (TC39 Explicit Resource Management, Stage 4 at time of writing)** is a step forward. The `[Symbol.dispose]` protocol is built into the language and TypeScript 5.2 supports it. But it is synchronous: `[Symbol.asyncDispose]` covers the async case, yet `await using` inside an async function still does not compose across typed error channels, and it does not integrate with Effect's structured concurrency model. Interruption — a fiber being cancelled by its parent — is not modeled by `using` at all.

**DI container lifecycle hooks** (`onInit` / `onDestroy` in NestJS, `providers` with `useFactory` and `onModuleDestroy`) bolt resource management onto the injection system. They are invisible to the TypeScript type checker, fire in a framework-managed order that is not encoded in types, and stop working the moment you step outside the framework.

Effect's answer unifies these concerns into three composable primitives:

- `Effect.acquireRelease(acquire, release)` — describe a single resource bracket as a value. The release is guaranteed to run on success, failure, **and** fiber interruption.
- `Scope` — a first-class lifetime. When a Scope closes, every finalizer registered on it runs in reverse acquisition order. Multiple resources compose without nesting.
- `Layer.scoped(Tag, scopedEffect)` — bind a service's lifetime to a Scope. The service is acquired when the Layer is provided and released when the surrounding program finishes.

---

## The minimal example

```ts
import { Console, Effect, Layer, Scope } from "effect"

// A simple resource type.
class FileHandle {
  constructor(public readonly path: string) {}
  close(): void { /* flush and close */ }
}

// Describe acquisition and release as an Effect.
const acquiredHandle = Effect.acquireRelease(
  Effect.sync(() => new FileHandle("/tmp/data.bin")),        // acquire
  (handle) => Effect.sync(() => handle.close())              // release
)
// acquiredHandle : Effect<FileHandle, never, Scope.Scope>
//                                           ^^^^^^^^^^^
//                            Scope appears in R — the caller must provide it

// Effect.scoped creates a Scope, runs the effect inside it,
// and closes the Scope when done (removing Scope from R).
const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* acquiredHandle
    yield* Console.log(`opened ${handle.path}`)
    // handle.close() is called automatically here — on success, failure, or interrupt
  })
)
// program : Effect<void, never, never>   — Scope is gone from R

await Effect.runPromise(program)
```

`Effect.acquireRelease` is the bracket. `Effect.scoped` is the envelope that discharges the `Scope` requirement. Everything between them is ordinary Effect composition.

---

## How it works

### Part A — `Effect.acquireRelease` and friends

**`Effect.acquireRelease`** — `repos/effect/packages/effect/src/Effect.ts:5371-5461`

```ts
export const acquireRelease: {
  <A, X, R2>(
    release: (a: A, exit: Exit.Exit<unknown, unknown>) => Effect<X, never, R2>
  ): <E, R>(acquire: Effect<A, E, R>) => Effect<A, E, Scope.Scope | R2 | R>
  <A, E, R, X, R2>(
    acquire: Effect<A, E, R>,
    release: (a: A, exit: Exit.Exit<unknown, unknown>) => Effect<X, never, R2>
  ): Effect<A, E, Scope.Scope | R | R2>
}
```

`acquireRelease(acquire, release)` takes two Effects and returns a single `Effect<A, E, Scope | R | R2>`. Three things happen at runtime:

1. `acquire` runs **uninterruptibly** — the runtime will not cancel it mid-flight. This prevents a half-open resource that can never be cleaned up.
2. If `acquire` succeeds with value `a`, `release(a, exit)` is registered as a finalizer on the current `Scope`.
3. When the `Scope` closes — for any reason — the finalizer runs, also uninterruptibly.

The `Scope.Scope` in the return type is the type-level signal: this Effect needs a scope to live in. A well-typed Effect pipeline with an unresolved `Scope` in `R` will fail to compile if you try to run it, because `Effect.runPromise` requires `R = never`. `Effect.scoped` is the standard way to satisfy that requirement.

The `release` function receives an `Exit` value, so it can take different cleanup paths on success versus failure. For most resources this detail does not matter — `close()` is `close()`. But it allows patterns like "commit on success, rollback on failure" for database transactions.

**`Effect.acquireUseRelease`** — `repos/effect/packages/effect/src/Effect.ts:5486-5560`

```ts
export const acquireUseRelease: {
  <A, E, R, A2, E2, R2, X, R3>(
    acquire: Effect<A, E, R>,
    use: (a: A) => Effect<A2, E2, R2>,
    release: (a: A, exit: Exit.Exit<A2, E2>) => Effect<X, never, R3>
  ): Effect<A2, E | E2, R | R2 | R3>
}
```

`acquireUseRelease` is the bracket form that does not require an explicit `Scope`. It creates the resource, passes it to `use`, then releases it — all in one go. The resulting Effect has no `Scope` in `R`. Use this when the resource is local to one operation and does not need to outlive it:

```ts
import { Effect } from "effect"

declare const openTempFile: Effect.Effect<{ write(s: string): void; close(): void }>

const writeReport = Effect.acquireUseRelease(
  openTempFile,
  (f) => Effect.sync(() => f.write("report data")),
  (f, _exit) => Effect.sync(() => f.close())
)
// Effect<void, never, never> — no Scope needed
```

When the resource needs to outlive a single operation — for example, a connection pool used by many requests — use `acquireRelease` inside a `Scope` instead.

**`Effect.addFinalizer`** — `repos/effect/packages/effect/src/Effect.ts:5562-5683`

```ts
export const addFinalizer: <X, R>(
  finalizer: (exit: Exit.Exit<unknown, unknown>) => Effect<X, never, R>
) => Effect<void, never, Scope.Scope | R>
```

`addFinalizer` is the lower-level primitive that both `acquireRelease` and `Layer.scoped` use internally. It registers an arbitrary cleanup Effect on the current Scope. Use it when you do not have a paired acquisition — for example, to log when a scope closes, or to clean up global state in tests:

```ts
import { Console, Effect } from "effect"

const withLifecycleLog = Effect.gen(function* () {
  yield* Effect.addFinalizer((exit) =>
    Console.log(`scope closed with: ${exit._tag}`)
  )
  // ... rest of the program
})
```

**`Effect.scoped`** — `repos/effect/packages/effect/src/Effect.ts:6040-6054`

```ts
export const scoped: <A, E, R>(
  effect: Effect<A, E, R>
) => Effect<A, E, Exclude<R, Scope.Scope>>
```

`Effect.scoped` is the most common entry point for resource management in application code. It creates a fresh `Scope`, provides it to `effect`, and closes the `Scope` when `effect` finishes — whether by success, failure, or interruption. The `Exclude<R, Scope.Scope>` in the return type shows that `Scope` is removed from the requirements; the caller does not need to think about it.

### Part B — Scope

A `Scope` is a first-class value that represents a lifetime. Internally it holds a list of finalizers. When the scope closes, finalizers execute in **reverse acquisition order** — last registered, first released. This mirrors the invariant of RAII / `defer` in Go: the most recently opened resource is the first to close.

**`Scope.close`** — `repos/effect/packages/effect/src/Scope.ts:145-152`

```ts
export const close: (
  self: CloseableScope,
  exit: Exit.Exit<unknown, unknown>
) => Effect.Effect<void>
```

Closes a `CloseableScope` and runs all its finalizers. The `Exit` argument is passed to each finalizer. In application code you rarely call this directly — `Effect.scoped` does it for you.

**`Scope.fork`** — `repos/effect/packages/effect/src/Scope.ts:168-178`

```ts
export const fork: (
  self: Scope,
  strategy: ExecutionStrategy.ExecutionStrategy
) => Effect.Effect<CloseableScope>
```

Creates a child scope. The child scope is automatically closed when its parent closes, but it can also be closed independently before the parent closes. The `ExecutionStrategy` controls whether the child's own finalizers run sequentially or in parallel. `Scope.fork` is the mechanism behind `Effect.forkScoped` (covered in Chapter 17 — Fibers and structured concurrency), which attaches a fiber to the current scope's lifetime.

**`Scope.make`** — `repos/effect/packages/effect/src/Scope.ts:194-204`

```ts
export const make: (
  executionStrategy?: ExecutionStrategy.ExecutionStrategy
) => Effect.Effect<CloseableScope>
```

Creates a top-level `CloseableScope`. Use `Scope.make` only when integrating Effect with a framework that manages its own lifecycle and you must close the scope explicitly on framework shutdown. In application code, `Effect.scoped` or `Layer.scoped` are the right tools.

### Part C — `Layer.scoped`

**`Layer.scoped`** — `repos/effect/packages/effect/src/Layer.ts:721-735`

```ts
export const scoped: {
  <I, S>(
    tag: Context.Tag<I, S>
  ): <E, R>(effect: Effect.Effect<Types.NoInfer<S>, E, R>) => Layer<I, E, Exclude<R, Scope.Scope>>
  <I, S, E, R>(
    tag: Context.Tag<I, S>,
    effect: Effect.Effect<Types.NoInfer<S>, E, R>
  ): Layer<I, E, Exclude<R, Scope.Scope>>
}
```

`Layer.scoped(Tag, scopedEffect)` wraps a scoped Effect into a Layer. The Layer manages the Scope internally: when the Layer is provided to a program, the Scope opens; when the program finishes (for any reason), the Scope closes and all registered finalizers run. The `Exclude<R, Scope.Scope>` return type shows that `Scope` is absorbed — it does not appear in the Layer's `RIn`.

This is the right constructor whenever a service **owns** a resource:

- A database connection pool — acquired at startup, drained at shutdown.
- An HTTP keep-alive client — opened when the Layer builds, closed when the program ends.
- A background fiber — forked when the Layer builds, interrupted when the Scope closes (via `Effect.forkScoped`, covered in Chapter 17 — Fibers and structured concurrency).

When you use `Layer.effect` for a service that owns a resource, the resource is acquired but never released. `Layer.effect` is for services with no cleanup. `Layer.scoped` is for services with a lifetime.

---

## A production example

The following is a simplified but faithful rendering of how `@effect/sql-pg` builds its `PgClient` layer. The real implementation at `repos/effect/packages/sql-pg/src/PgClient.ts:395-469` uses `Effect.acquireRelease` to open a `pg.Pool` and guarantee `pool.end()` on scope close; `repos/effect/packages/sql-pg/src/PgClient.ts:575-583` wraps the scoped Effect in `Layer.scopedContext` (a variant of `Layer.scoped` that registers multiple Tags at once). The example below distills that pattern into standalone, readable form:

```ts
import { Context, Effect, Layer, Scope } from "effect"
import * as Pg from "pg"

// ---- Tags ----

class Database extends Context.Tag("app/Database")<
  Database,
  {
    readonly query: (sql: string, params?: ReadonlyArray<unknown>) => Effect.Effect<ReadonlyArray<unknown>>
  }
>() {}

// ---- Layer ----

// Layer.scoped absorbs the Scope requirement.
// The pool is created on Layer provision, pool.end() runs when the Layer's
// scope closes — on success, error, or SIGTERM.
const DatabaseLive = Layer.scoped(
  Database,
  Effect.gen(function* () {
    // acquireRelease: pool.connect() probe is uninterruptible;
    // pool.end() is guaranteed to run when the surrounding Scope closes.
    const pool = yield* Effect.acquireRelease(
      Effect.async<Pg.Pool, Error>((resume) => {
        const p = new Pg.Pool({ connectionString: process.env["DATABASE_URL"] })
        // Probe that the pool can actually connect before declaring success.
        p.query("SELECT 1").then(
          () => resume(Effect.succeed(p)),
          (err) => resume(Effect.fail(new Error(String(err))))
        )
      }),
      (p) => Effect.promise(() => p.end())
    )

    // Expose a typed query method as the service implementation.
    return {
      query: (sql, params) =>
        Effect.tryPromise({
          try: () => pool.query(sql, params as unknown[]).then((r) => r.rows),
          catch: (err) => new Error(String(err))
        })
    }
  })
)
// DatabaseLive : Layer<Database, Error, never>

// ---- Program ----

const program = Effect.gen(function* () {
  const db = yield* Database
  const rows = yield* db.query("SELECT id, name FROM users LIMIT 10")
  return rows
})

// The Layer's Scope opens here, the pool is acquired, the program runs,
// and then the Scope closes — pool.end() is called regardless of outcome.
const runnable = program.pipe(Effect.provide(DatabaseLive))
// Effect<ReadonlyArray<unknown>, Error, never>
```

When `Effect.runPromise(runnable)` returns — whether the program succeeded, threw, or was interrupted by a signal — `pool.end()` is called. There is no `process.on('SIGTERM', ...)` handler to forget and no `finally` block that silently swallows errors.

---

## Variations

```ts
import { Context, Effect, Exit, Layer, Scope } from "effect"

class Svc extends Context.Tag("app/Svc")<
  Svc,
  { readonly ping: () => Effect.Effect<string> }
>() {}

declare const openConn: Effect.Effect<{ ping(): Promise<string>; close(): Promise<void> }>

// 1. Effect.acquireRelease — resource bracket; Scope in R.
const conn = Effect.acquireRelease(
  openConn,
  (c) => Effect.promise(() => c.close())
)
// Effect<{ ping(): ...; close(): ... }, never, Scope.Scope>

// 2. Effect.acquireUseRelease — bracket-and-use in one go; no Scope in R.
const pingOnce = Effect.acquireUseRelease(
  openConn,
  (c) => Effect.promise(() => c.ping()),
  (c, _exit) => Effect.promise(() => c.close())
)
// Effect<string, never, never>

// 3. Effect.addFinalizer — register arbitrary cleanup on the current Scope.
const withLogging = Effect.gen(function* () {
  yield* Effect.addFinalizer((exit) =>
    Effect.sync(() => console.log("scope closed:", exit._tag))
  )
  return yield* Effect.succeed("running")
})
// Effect<string, never, Scope.Scope>

// 4. Effect.scoped — discharge the Scope requirement.
const discharged = Effect.scoped(withLogging)
// Effect<string, never, never>

// 5. Layer.scoped — service whose lifetime is tied to the Layer's Scope.
const SvcLive = Layer.scoped(
  Svc,
  Effect.acquireRelease(
    openConn,
    (c) => Effect.promise(() => c.close())
  ).pipe(
    Effect.map((c) => ({ ping: () => Effect.promise(() => c.ping()) }))
  )
)
// Layer<Svc, never, never>

// 6. Scope.make / Scope.close — manual scope, for framework integration.
const manualScope = Effect.gen(function* () {
  const scope = yield* Scope.make()
  yield* Scope.extend(conn, scope)     // register conn's release on this scope
  // ... framework hands control back to Effect later ...
  yield* Scope.close(scope, Exit.void)
})

// 7. Scope.fork — child scope tied to a parent scope.
const forkedScope = Effect.gen(function* () {
  const parent = yield* Scope.make()
  const child = yield* Scope.fork(parent, { _tag: "Sequential" })
  // child closes when parent closes, or can be closed early
  yield* Scope.close(child, Exit.void)
  yield* Scope.close(parent, Exit.void)
})
```

---

## Anti-patterns

**Anti-pattern 1 — Using `try/finally` for resources in Effect code.**

```ts
// WRONG: try/finally does not run on fiber interruption;
// it also doesn't compose with Effect's typed error channel.
import * as fs from "node:fs"

const readFileBadly = (path: string) => {
  const fd = fs.openSync(path, "r")
  try {
    // ... read bytes ...
    return Buffer.alloc(0)
  } finally {
    fs.closeSync(fd)   // never runs if this fiber is interrupted
  }
}
```

The right move: use `Effect.acquireRelease` + `Effect.scoped`.

```ts
import { Effect } from "effect"
import * as fs from "node:fs"

const readFileSafely = (path: string) =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => fs.openSync(path, "r")),
      (fd) => Effect.sync(() => fs.closeSync(fd))
    ).pipe(
      Effect.map((fd) => {
        const buf = Buffer.alloc(1024)
        fs.readSync(fd, buf)
        return buf
      })
    )
  )
// Effect<Buffer, never, never> — fd is always closed
```

**Anti-pattern 2 — Forgetting `Effect.scoped` and leaving `Scope` in `R`.**

```ts
import { Effect } from "effect"

declare const acquiredConn: Effect.Effect<{ query: (s: string) => Promise<unknown> }, never, import("effect").Scope.Scope>

// WRONG: Scope is still in R — this will not compile with runPromise.
const leaky = Effect.gen(function* () {
  const conn = yield* acquiredConn
  return yield* Effect.promise(() => conn.query("SELECT 1"))
})
// leaky : Effect<unknown, never, Scope.Scope>
// Effect.runPromise(leaky)  <- compile error: R is not never
```

The `Scope` in `R` is a typed reminder that a scope boundary is missing. The right move: wrap with `Effect.scoped`.

```ts
import { Effect } from "effect"

declare const acquiredConn: Effect.Effect<{ query: (s: string) => Promise<unknown> }, never, import("effect").Scope.Scope>

const safe = Effect.scoped(
  Effect.gen(function* () {
    const conn = yield* acquiredConn
    return yield* Effect.promise(() => conn.query("SELECT 1"))
  })
)
// safe : Effect<unknown, never, never>  — compiles, runs, and releases conn
```

**Anti-pattern 3 — Using `Layer.effect` for a service that owns a resource.**

```ts
import { Context, Effect, Layer } from "effect"
import * as Pg from "pg"

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// WRONG: Layer.effect runs the generator but never registers a release.
// pool.end() is never called — connections leak.
const LeakyDatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const pool = new Pg.Pool({ connectionString: process.env["DATABASE_URL"] })
    return {
      query: (sql) => Effect.promise(() => pool.query(sql).then((r) => r.rows))
    }
  })
)
```

The right move: use `Layer.scoped` with `Effect.acquireRelease` whenever the service has a cleanup step.

```ts
import { Context, Effect, Layer } from "effect"
import * as Pg from "pg"

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// RIGHT: Layer.scoped guarantees pool.end() runs when the scope closes.
const DatabaseLive = Layer.scoped(
  Database,
  Effect.acquireRelease(
    Effect.sync(() => new Pg.Pool({ connectionString: process.env["DATABASE_URL"] })),
    (pool) => Effect.promise(() => pool.end())
  ).pipe(
    Effect.map((pool) => ({
      query: (sql) => Effect.promise(() => pool.query(sql).then((r) => r.rows))
    }))
  )
)
```

---

## See also

- [Chapter 05 — Effect.gen](05-effect-gen.md) — generator syntax for building scoped Effects
- [Chapter 06 — Typed errors](06-typed-errors.md) — release functions receive the typed `Exit`; they run even when an error is in the channel
- [Chapter 07 — The Cause model](07-cause-model.md) — `Cause.Interrupt` is an `Exit` variant; finalizers run on interruption too
- [Chapter 09 — Layer](09-layer.md) — Layer constructors; `Layer.effect` vs `Layer.scoped`
- [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md) — `Effect.forkScoped` attaches a fiber to a Scope; that fiber is interrupted when the Scope closes
- [Patterns Catalog: Layer.scoped (resource layers)](../../research/02-patterns-catalog.md#layerscoped-resource-layers)
- [Patterns Catalog: Effect.acquireRelease / acquireUseRelease](../../research/02-patterns-catalog.md#effectacquirerelease--acquireuserelease)
- [Patterns Catalog: Scope.make / Scope.fork / Scope.close](../../research/02-patterns-catalog.md#scopemake--scopefork--scopeclose)
- [Per-package note: effect](../../research/packages/effect.md)
