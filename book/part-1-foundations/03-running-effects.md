# Chapter 03 — Running Effects: `runPromise`, `runSync`, `runFork`, `runCallback`

> **Patterns introduced:** [`Effect.runPromise` / `runSync` / `runFork`](../../research/02-patterns-catalog.md#effectrunpromise--runsync--runfork)
> **Reads from:** [Chapter 01 — Why Effect](01-why-effect.md), [Chapter 02 — Effect as a value](02-effect-as-a-value.md)
> **Reads into:** Chapter 06 (Typed errors), Chapter 07 (Cause model), Chapter 17 (Fibers and structured concurrency)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

In plain JavaScript, asynchronous work starts the moment you create it.

```ts
// This request begins immediately — there is no way to prevent it.
const p: Promise<Response> = fetch("https://api.example.com/users")
```

The call to `fetch` does not return a description of an HTTP request. It fires one. From the moment that line executes, a network socket is open, DNS has been queried, and you have no way to cancel the operation without an `AbortController` you have to thread through manually. You can `.then()` onto the result, but you cannot delay, compose, or recombine the underlying computation without it already running.

This eager execution model creates a subtle but recurring problem: code that builds and code that runs are indistinguishable by type. A function returning `Promise<User>` might trigger a database query, send a Slack notification, and update a global cache — or it might not, depending on internal state. The type tells you nothing about when execution started or what effects have already occurred.

Chapter 02 showed that `Effect<A, E, R>` solves this by being a **description of a computation** rather than the computation itself. When you write:

```ts
import { Effect } from "effect"

const fetchUser = Effect.tryPromise({
  try: () => fetch("https://api.example.com/users/1").then(r => r.json()),
  catch: (err) => new Error(String(err)),
})
```

Nothing happens. No network request. No socket. `fetchUser` is a value you can store, pass as an argument, combine with retry logic, or compose with a timeout — all before any execution takes place.

But this raises the immediate question: **when does it run at all?**

The answer is that you must explicitly hand the Effect to one of four runner functions: `runPromise`, `runSync`, `runFork`, or `runCallback`. These are the only doorways from the Effect description world into the side-effecting world. They are the "edge of the world" — the narrow seam where your typed program hands control to the runtime.

This chapter explains what each runner does, when to reach for each one, and — critically — why calling them anywhere but at the very top of your call stack is an anti-pattern.

---

## The minimal example

```ts
import { Effect } from "effect"

const program = Effect.succeed(42)

// Returns Promise<number> — resolves with 42.
const a: Promise<number> = Effect.runPromise(program)

// Returns number — synchronous, returns 42 directly.
const b: number = Effect.runSync(program)

// Returns RuntimeFiber<number, never> — starts the effect as a background fiber.
const c = Effect.runFork(program)

// Returns void — executes the effect and calls back with the Exit value.
Effect.runCallback(program, { onExit: (exit) => console.log(exit) })
```

Four runners. Four return types. One rule: call them once, at the entry point.

---

## How it works

### `runPromise` — the everyday runner

`runPromise` is the most common runner. Its signature, exported at `repos/effect/packages/effect/src/Effect.ts:12136-12139`, is:

```ts
export const runPromise: <A, E>(
  effect: Effect<A, E, never>,
  options?: { readonly signal?: AbortSignal | undefined } | undefined
) => Promise<A>
```

Note the `never` in the `R` slot. The type system enforces that you can only run an Effect whose requirements have all been satisfied. If your program still requires a service — say, a database connection — the compiler will reject the call to `runPromise` until you provide it via a `Layer` (Chapter 09).

When the Effect succeeds, the Promise resolves with the value of type `A`. When the Effect fails, the Promise rejects. What does it reject with? Not a plain `Error` — it rejects with a `FiberFailure` that wraps the full `Cause<E>` of the failure. The `Cause` model (Chapter 07) carries rich diagnostic information: whether the failure was a typed error (`Fail`), an unhandled exception (`Die`), or an interruption (`Interrupt`). Chapter 06 covers how to work with typed errors in the `E` channel before they reach the runner.

`runPromise` accepts an optional `AbortSignal`, which wires external cancellation (from a browser `AbortController`, for example) into Effect's interruption model. When the signal fires, the running fiber is interrupted cleanly.

### `runSync` — only for synchronous Effects

`runSync` is exported at `repos/effect/packages/effect/src/Effect.ts:12279`:

```ts
export const runSync: <A, E>(effect: Effect<A, E>) => A
```

It executes the Effect synchronously and returns the result directly as a value of type `A`. No `Promise`, no callback. This is useful in CLIs and scripts where you know every step is synchronous.

The hard constraint: if the Effect contains any asynchronous boundary — any `Effect.promise`, `Effect.tryPromise`, `Effect.async`, or anything that yields a fiber — `runSync` throws at runtime with a `FiberFailure` whose `Cause` is a `Die` wrapping an `AsyncFiberException`. The display in a `catch (e)` block looks like:

```
(FiberFailure) AsyncFiberException: Fiber #0 cannot be resolved synchronously.
This is caused by using runSync on an effect that performs async work
```

The object thrown is always a `FiberFailure` (an `Error` subclass); `e instanceof FiberFailure` is the correct guard, not `e._tag === "AsyncFiberException"`. Internally, `unsafeRunSync` calls `unsafeRunSyncExit`, which returns `Exit.die(asyncFiberException(fiber))` when it encounters an async boundary; `unsafeRunSync` then calls `fiberFailure(cause)` on that `Failure` exit and throws the result (see `repos/effect/packages/effect/src/internal/runtime.ts:159-168` and `268-284`).

The source documents this behavior explicitly in the JSDoc at `repos/effect/packages/effect/src/Effect.ts:12202-12278`. If the Effect can fail, `runSync` throws that failure as a `FiberFailure` as well. The safe alternative for effects that might fail is `runSyncExit`, which returns `Exit<A, E>` without throwing.

### `runFork` — start a fiber, manage it later

`runFork` is exported at `repos/effect/packages/effect/src/Effect.ts:12064-12067`:

```ts
export const runFork: <A, E>(
  effect: Effect<A, E>,
  options?: Runtime.RunForkOptions
) => Fiber.RuntimeFiber<A, E>
```

Unlike `runPromise`, which awaits the result, `runFork` starts the Effect as an independently running fiber and returns a `Fiber.RuntimeFiber<A, E>` handle immediately. The work begins in the background; the caller decides what to do with the handle.

Common uses for the returned fiber:
- **Interrupt it:** `fiber.interrupt()` — useful for cleanup in long-running servers.
- **Await it:** `Fiber.join(fiber)` — returns an `Effect<A, E>` you can use inside another Effect.
- **Observe it:** `Fiber.await(fiber)` — returns `Effect<Exit<A, E>>` with the full outcome.

`runFork` is the primitive behind structured concurrency (Chapter 17). When you call `Effect.fork` inside a running Effect, you are using a fiber-scoped variant of this same idea. Chapter 17 covers the full fiber model; for now, treat `runFork` as "start this Effect in the background and give me a handle".

### `runCallback` — low-level callback shape

`runCallback` is exported at `repos/effect/packages/effect/src/Effect.ts:12087-12090`:

```ts
export const runCallback: <A, E>(
  effect: Effect<A, E>,
  options?: Runtime.RunCallbackOptions<A, E> | undefined
) => Runtime.Cancel<A, E>
```

It starts the Effect asynchronously and invokes `options.onExit` with the `Exit<A, E>` value when the Effect completes. It returns a cancellation function you can call to interrupt the fiber from outside. Of the four runners, this is the most flexible primitive — its callback shape can express any output protocol. Internally, however, `runPromise`, `runSync`, and `runFork` do NOT delegate through `runCallback`; all four call `unsafeFork` directly with different output adapters (for example, `unsafeRunPromiseExit` calls `unsafeFork` at `repos/effect/packages/effect/src/internal/runtime.ts:345`, and `unsafeRunCallback` does the same at line 138). In practice, you will reach for `runPromise` almost always; `runCallback` is useful when integrating with older callback-based frameworks or when you need the cancellation handle without creating a fiber reference separately.

### The `Runtime` and `ManagedRuntime` variants

Every `run*` function on `Effect` uses a built-in default runtime under the hood — `defaultRuntime`, declared in `repos/effect/packages/effect/src/Runtime.ts:205`. This default runtime is correct for Effects with no outstanding service requirements (i.e., `R = never`).

For programs that DO have service requirements, you provide those requirements by building a `Layer` and either calling `Effect.provide(layer)` before running (which produces an effect with `R = never`) or by constructing a `ManagedRuntime`.

`ManagedRuntime.make` (exported at `repos/effect/packages/effect/src/ManagedRuntime.ts:177-180`) creates a long-lived runtime whose service layer is built once and reused across multiple `run*` calls:

```ts
import { Layer, ManagedRuntime } from "effect"

const runtime = ManagedRuntime.make(AppLayer)
await runtime.runPromise(someEffect)
await runtime.runPromise(anotherEffect)
await runtime.dispose()
```

This matters for HTTP servers and similar long-running processes: if you called `Effect.provide(AppLayer)` on every request, Effect would construct and tear down your database connection pool with each request. `ManagedRuntime` builds the layer once at startup. Chapter 11 covers `ManagedRuntime.make` in full; this is a preview.

### The rule: run at the edge, not in the middle

The single most important rule for `run*` functions:

> **Call `run*` exactly once, at the outermost entry point of your program. Never call it inside business logic.**

Your program should be one large `Effect` composed from many smaller Effects. The `run*` call is the ignition switch — flipped once, at the top:

```ts
// The right shape for a CLI or script:
const main: Effect.Effect<void, AppError> = Effect.gen(function* () {
  // ... all your logic here, zero run* calls ...
})

// One run* at the entry point:
Effect.runPromise(main).catch(console.error)
```

Why does this matter? Every `run*` call creates a new fiber root. A fiber root sits outside the Effect runtime's supervision tree — it cannot be interrupted by a parent, it does not inherit context, and it produces no tracing spans in the parent's trace. If you call `Effect.runPromise` inside a service function to "convert back" to a `Promise`, you lose:
- **Interruption propagation:** if the parent fiber is interrupted, your inner runPromise fiber keeps running.
- **Context inheritance:** any services provided to the parent are not visible inside the new fiber root.
- **Tracing continuity:** the inner run* creates a new root span, disconnecting it from the parent's distributed trace.

---

## A production example

A minimal CLI that reads an environment variable, fetches a remote resource, validates the response shape (forwarding to Chapter 14 for Schema details), and prints the result. Note that the entire body of `main` contains zero `run*` calls — only the entry point does.

```ts
import { Effect, Data } from "effect"

// --- typed errors ---

class MissingEnvVar extends Data.TaggedError("MissingEnvVar")<{
  readonly name: string
}> {}

class HttpFailed extends Data.TaggedError("HttpFailed")<{
  readonly status: number
}> {}

class ParseFailed extends Data.TaggedError("ParseFailed")<{
  readonly message: string
}> {}

// --- small building blocks ---

const requireEnv = (name: string): Effect.Effect<string, MissingEnvVar> =>
  Effect.sync(() => process.env[name]).pipe(
    Effect.flatMap((value) =>
      value !== undefined
        ? Effect.succeed(value)
        : Effect.fail(new MissingEnvVar({ name }))
    )
  )

const fetchJson = (url: string): Effect.Effect<unknown, HttpFailed | ParseFailed> =>
  Effect.tryPromise({
    try: () => fetch(url),
    catch: () => new HttpFailed({ status: 0 }),
  }).pipe(
    Effect.flatMap((resp) =>
      resp.ok
        ? Effect.tryPromise({
            try: () => resp.json(),
            catch: (err) => new ParseFailed({ message: String(err) }),
          })
        : Effect.fail(new HttpFailed({ status: resp.status }))
    )
  )

// --- composed program ---
// Chapter 05 covers Effect.gen; read it as async/await for Effects.

const main = Effect.gen(function* () {
  const baseUrl = yield* requireEnv("API_BASE_URL")
  const payload = yield* fetchJson(`${baseUrl}/status`)
  // In Chapter 14 we decode `payload` with Schema; for now just print it.
  yield* Effect.sync(() => console.log(JSON.stringify(payload, null, 2)))
})
// Inferred type: Effect.Effect<void, MissingEnvVar | HttpFailed | ParseFailed, never>
// R = never: ready to run, no services needed.

// --- entry point: one run* call ---

Effect.runPromise(main).catch(console.error)
```

The inferred `R = never` on `main` is the green light from the type system: this Effect has everything it needs. The single `.catch(console.error)` at the bottom ensures that an unhandled rejection does not silently disappear (see Anti-patterns below).

---

## Variations

**`Effect.runPromise(program)`** (`repos/effect/packages/effect/src/Effect.ts:12136-12139`) — most common. Executes the Effect and returns `Promise<A>`. Rejects with a `FiberFailure` wrapping the `Cause<E>` on failure.

```ts
import { Effect } from "effect"
const result: Promise<number> = Effect.runPromise(Effect.succeed(42))
```

**`Effect.runPromiseExit(program)`** (`repos/effect/packages/effect/src/Effect.ts:12197-12200`) — returns `Promise<Exit<A, E>>`. The Promise always resolves; it never rejects. Useful when you want to pattern-match success and failure without a try/catch.

```ts
import { Effect, Exit } from "effect"
const exit = await Effect.runPromiseExit(Effect.fail("boom"))
if (Exit.isFailure(exit)) console.log("failed:", exit.cause)
```

**`Effect.runSync(program)`** (`repos/effect/packages/effect/src/Effect.ts:12279`) — synchronous execution. Returns `A` directly. Throws if the Effect fails or hits an async boundary.

```ts
import { Effect } from "effect"
const n: number = Effect.runSync(Effect.succeed(1))
```

**`Effect.runSyncExit(program)`** (`repos/effect/packages/effect/src/Effect.ts:12357`) — synchronous execution that returns `Exit<A, E>`. Does not throw on typed failures; returns `Exit.failure(cause)` instead. If an async boundary is encountered, returns `Exit.die(asyncFiberException)`.

```ts
import { Effect, Exit } from "effect"
const exit = Effect.runSyncExit(Effect.fail("oops"))
// Exit<never, string> — no throw
```

**`Effect.runFork(program)`** (`repos/effect/packages/effect/src/Effect.ts:12064-12067`) — starts the Effect as a background fiber, returns `RuntimeFiber<A, E>` immediately. Use when you need to start background work and optionally interrupt it later. Chapter 17 covers the full fiber API.

```ts
import { Effect, Fiber } from "effect"
const fiber = Effect.runFork(Effect.delay(Effect.succeed(42), "5 seconds"))
// ...later:
await Effect.runPromise(Fiber.interrupt(fiber))
```

**`Effect.runCallback(program, options)`** (`repos/effect/packages/effect/src/Effect.ts:12087-12090`) — low-level callback runner. The `options.onExit` callback receives `Exit<A, E>`. Returns a cancellation function. Rarely used directly in application code.

```ts
import { Effect } from "effect"
const cancel = Effect.runCallback(Effect.succeed(42), {
  onExit: (exit) => console.log(exit)
})
```

---

## Anti-patterns

### Calling `run*` inside business logic

The most common mistake: reaching for `Effect.runPromise` inside a service function or domain helper to "escape" back to a Promise.

```ts
// Wrong: creates an orphan fiber with no parent supervision.
// Interruption, context, and tracing are all severed here.
async function getUserName(id: string): Promise<string> {
  const user = await Effect.runPromise(fetchUser(id))
  return user.name
}
```

The correct approach is to keep the function in Effect and let the caller compose:

```ts
// Right: return the Effect and let the entry point run everything.
import { Effect } from "effect"

const getUserName = (id: string): Effect.Effect<string, HttpFailed> =>
  fetchUser(id).pipe(Effect.map((user) => user.name))

// The single run* call remains at the entry point.
Effect.runPromise(main).catch(console.error)
```

### Calling `runSync` on an Effect that may suspend

`runSync` only works on purely synchronous Effects. If the Effect contains any `tryPromise`, `promise`, `async`, or any combinator that might yield to the event loop, `runSync` throws a `FiberFailure` wrapping a `Die` cause that contains an `AsyncFiberException` — a defect, not a typed error, so it will not be caught by typed error handlers. The correct guard in a `catch` block is `isFiberFailure(e)`, not checking `e._tag`.

```ts
import { Effect } from "effect"

// Wrong: this throws a FiberFailure (wrapping AsyncFiberException) at runtime.
const bad = Effect.runSync(
  Effect.tryPromise({
    try: () => fetch("/api"),
    catch: (e) => new Error(String(e)),
  })
)

// Right: use runPromise for anything async.
const good: Promise<Response> = Effect.runPromise(
  Effect.tryPromise({
    try: () => fetch("/api"),
    catch: (e) => new Error(String(e)),
  })
)
```

### Forgetting `.catch` on `runPromise`

`Effect.runPromise` returns a standard `Promise`. If the Effect fails and nothing handles the rejection, Node.js and browsers will emit an unhandled-rejection warning (and in newer Node.js versions, terminate the process).

```ts
// Wrong: unhandled rejection if main fails.
Effect.runPromise(main)

// Right: always attach a rejection handler at the entry point.
Effect.runPromise(main).catch(console.error)

// Also fine: in a top-level async context.
try {
  await Effect.runPromise(main)
} catch (err) {
  console.error(err)
  process.exit(1)
}
```

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — why `Effect<A, E, R>` is a lazy description, not an execution
- [Chapter 04 — pipe and dual API](04-pipe-and-dual-api.md) — how to compose Effects before running them
- [Chapter 06 — Typed errors](06-typed-errors.md) — `Cause` is what `runPromise` rejects with; how to handle errors before they surface
- [Chapter 07 — Cause model](07-cause-model.md) — `Exit` and `Cause` in detail; what `runPromiseExit` and `runSyncExit` return
- [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md) — `runFork` returns a `RuntimeFiber`; fiber joining, interruption, and structured concurrency
- [Patterns Catalog: `Effect.runPromise` / `runSync` / `runFork`](../../research/02-patterns-catalog.md#effectrunpromise--runsync--runfork) — canonical reference entry for this chapter's patterns
- [Per-package note: effect](../../research/packages/effect.md) — full package inventory and surface area
