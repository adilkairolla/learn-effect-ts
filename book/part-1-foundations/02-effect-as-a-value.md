# Chapter 02 — Effect as a value: `Effect<A, E, R>` and the three type parameters

> **Patterns introduced:** [`Effect.succeed` / `fail` / `sync` / `promise` / `tryPromise`](../../research/02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise)
> **Reads from:** [Chapter 01 — Why Effect](01-why-effect.md)
> **Reads into:** Chapter 03 (Running Effects), Chapter 06 (Typed errors), Chapter 08 (Context and the R parameter)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

`Promise<A>` has one type parameter. That single slot is enough to describe what a successful async computation returns. It is not enough to describe anything else about the computation.

Consider a function you encounter in a real codebase:

```ts
async function loadUserConfig(userId: string): Promise<UserConfig> {
  const apiKey = process.env.CONFIG_API_KEY
  if (!apiKey) throw new Error("CONFIG_API_KEY is not set")

  const resp = await fetch(`https://config.example.com/users/${userId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

  const raw = await resp.json()
  return parseUserConfig(raw) // may throw ValidationError
}
```

The return type `Promise<UserConfig>` communicates exactly one fact: on success, you get a `UserConfig`. It communicates nothing about:

- **What it can fail with.** Three distinct failure modes are buried in the implementation: a missing environment variable, an HTTP error, and a validation failure. None of them appear in the type. A caller catching `unknown` has to read the source to know what to expect.
- **What it depends on.** The function silently reads `process.env.CONFIG_API_KEY` and calls the global `fetch`. Nothing in the signature makes these dependencies visible or testable.
- **Whether it is already running.** The moment you call `loadUserConfig(id)`, the network request begins. There is no way to pass this computation around, delay it, or combine it with another one before triggering execution.

These three gaps are exactly what `Effect<A, E, R>` addresses. Chapter 01 introduced them as the three axes where TypeScript's plain async model falls short. This chapter shows what the type looks like in code and how the five leaf constructors put values into it.

---

## The minimal example

```ts
import { Effect } from "effect"

// A value we already have — no computation needed.
const a = Effect.succeed(42)
// Effect<number, never, never>

// A typed failure — the error channel is now part of the type.
const b = Effect.fail("boom")
// Effect<never, string, never>

// A synchronous side effect deferred until run time.
const c = Effect.sync(() => Date.now())
// Effect<number, never, never>

// A Promise we trust will never reject.
const d = Effect.promise(() => Promise.resolve("hi"))
// Effect<string, never, never>

// A Promise that may reject, with a typed error channel.
class FetchFailed {
  readonly _tag = "FetchFailed"
  constructor(readonly message: string) {}
}

const e = Effect.tryPromise({
  try: () => fetch("/api/data").then((r) => r.text()),
  catch: (err) => new FetchFailed(String(err)),
})
// Effect<string, FetchFailed, never>
```

Read the inferred types in the comments — that is the lesson. Each constructor produces an `Effect` with specific types in each of its three slots. Nothing has run yet.

---

## How it works

### The three type parameters

The `Effect` interface is declared at `repos/effect/packages/effect/src/Effect.ts:111`:

```ts
export interface Effect<out A, out E = never, out R = never>
  extends Effect.Variance<A, E, R>, Pipeable
```

**`A` — the success type.** When the effect completes successfully, it produces a value of type `A`. This is the only slot `Promise<A>` has. `Effect.succeed(42)` produces `Effect<number, never, never>` — success type is `number`.

**`E` — the error type.** When the effect fails in an expected, recoverable way, the failure value is typed as `E`. `Effect.fail("boom")` produces `Effect<never, string, never>`. The `never` in the `A` slot means this effect can only fail, never succeed. When `E` is `never`, the effect cannot fail in a typed, recoverable way — it is an infallible computation. You will see this most often on pure effects like `Effect.succeed(42)`, which is `Effect<number, never, never>`.

**`R` — the requirements type.** This slot tracks what services and dependencies the computation needs before it can be executed. When `R` is `never`, the effect has no outstanding dependencies and can be run directly. When `R` is something like `DatabaseService`, the computation requires that service to be provided before `runPromise` will accept it. Chapter 08 covers the full mechanics of how tags and layers satisfy R.

All three type parameters are covariant in the TypeScript sense (`out A, out E, out R`), which is reflected in the variance struct at `repos/effect/packages/effect/src/Effect.ts:237-242`. This means an `Effect<number, never, never>` is assignable wherever an `Effect<number | string, never, never>` is expected, and composing effects widens their error union naturally: combining an `Effect<A, NotFound, never>` with an `Effect<B, NetworkError, never>` produces an `Effect<B, NotFound | NetworkError, never>` without any explicit annotation.

### Effects are descriptions, not running computations

The single most important thing to understand about `Effect<A, E, R>` is that it is a **description of a computation**, not the computation itself.

When you write `Effect.promise(() => fetch("/api/data").then(r => r.json()))`, nothing happens. No request is sent. You have constructed a value — a data structure that says "when run, perform this HTTP request". The request runs only when you call one of the `run*` functions from Chapter 03.

This is the opposite of `Promise`. A `Promise` starts as soon as it is created:

```ts
// This immediately starts a network request:
const p: Promise<Response> = fetch("/api/data")

// This does not start anything yet:
const e: Effect.Effect<Response, FetchFailed, never> = Effect.tryPromise({
  try: () => fetch("/api/data"),
  catch: (err) => new FetchFailed(String(err)),
})
```

Laziness is what makes composition safe. You can build a description of a program — combine it with error handlers, retry logic, timeouts, or dependency injection — and only trigger the actual side effects once, at a single well-known point. Chapter 03 covers the `run*` functions that serve as that execution point.

### The `never` sentinel

`never` in the `E` or `R` slot is TypeScript's bottom type, the type with no values. In these slots it means "I guarantee there is nothing here":

- `Effect<A, never, never>` — succeeds with `A`, cannot fail, needs nothing. This is what `Effect.succeed(42)` produces.
- `Effect<never, E, never>` — cannot succeed, fails with `E`. This is what `Effect.fail("boom")` produces.
- `Effect<A, E, never>` — can succeed or fail, but needs no services. Ready to run as-is.
- `Effect<A, E, SomeService>` — not yet runnable; `SomeService` must be provided first.

When you compose two effects, TypeScript unions the error types and unions the requirement types. Once all requirements are provided, `R` becomes `never` and the effect is runnable.

### The five leaf constructors

These five functions are the boundary where plain values and existing async APIs enter the Effect world. All cited lines are in `repos/effect/packages/effect/src/Effect.ts`.

**`Effect.succeed`** (`line 3160`) — wrap a value you already have. Produces `Effect<A, never, never>`. The thunk is not called; the value is captured as-is.

**`Effect.fail`** (`line 2575`) — produce a typed failure. The `E` slot gets the type of whatever you pass. Nothing in the runtime "throws" — the failure is a first-class value that will be routed through the error channel when the effect runs.

**`Effect.sync`** (`line 3326`) — defer a synchronous computation in a thunk. The thunk is not called until the effect runs. Use this whenever you have synchronous code that reads from the environment (`process.env`, `Date.now()`, local storage) and want to make it lazy and composable. If the thunk throws, the exception becomes a defect in the `Cause` model (Chapter 07); unlike `tryPromise`, there is no typed `catch` mapper.

**`Effect.promise`** (`lines 3131-3133`) — wrap a `PromiseLike` you trust will not reject. The `A` slot gets the resolved type; the `E` slot stays `never`. If the Promise does reject at runtime, it becomes a defect. Use this only when rejection is genuinely impossible or indicates a programmer error.

**`Effect.tryPromise`** (`lines 4677-4685`) — wrap a `PromiseLike` that may reject. The `catch` function maps the raw rejection value to a typed error `E`. This is the right tool for every external API call: `fetch`, database drivers, file system operations, third-party SDKs. The `catch` callback receives `unknown` — just like a real `catch` clause — and returns your typed error class.

---

## A production example

Here is a realistic fragment: read an API base URL from the environment, then fetch a remote configuration payload, and return the parsed result. The final type of the program is the lesson.

```ts
import { Effect, Data } from "effect"

// Typed errors — full story in Chapter 06.
class MissingEnvVar extends Data.TaggedError("MissingEnvVar")<{
  readonly name: string
}> {}

class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number
  readonly url: string
}> {}

class ParseFailure extends Data.TaggedError("ParseFailure")<{
  readonly message: string
}> {}

// Read a required environment variable.
// Effect.sync defers the read; we use Effect.fail for the typed error path.
const requireEnv = (name: string): Effect.Effect<string, MissingEnvVar> =>
  Effect.sync(() => process.env[name]).pipe(
    Effect.flatMap((value) =>
      value !== undefined
        ? Effect.succeed(value)
        : Effect.fail(new MissingEnvVar({ name }))
    )
  )

// Fetch a URL and return the parsed JSON body.
const fetchJson = (url: string): Effect.Effect<unknown, HttpError | ParseFailure> =>
  Effect.tryPromise({
    try: () => fetch(url),
    catch: (err) => new HttpError({ status: 0, url }),
  }).pipe(
    Effect.flatMap((resp) =>
      resp.ok
        ? Effect.tryPromise({
            try: () => resp.json(),
            catch: (err) => new ParseFailure({ message: String(err) }),
          })
        : Effect.fail(new HttpError({ status: resp.status, url }))
    )
  )

// Compose them — we'll cover Effect.gen in Chapter 05;
// for now read it as a generator-flavored async/await for Effects.
const loadRemoteConfig = Effect.gen(function* () {
  const baseUrl = yield* requireEnv("CONFIG_API_BASE_URL")
  const payload = yield* fetchJson(`${baseUrl}/config`)
  return payload
})
//
// Inferred type:
// Effect.Effect<unknown, MissingEnvVar | HttpError | ParseFailure, never>
//  ▲                ▲                                              ▲
//  │                │                                              │
//  │     All failure modes are                         No services
//  │     visible in the type.                          required — ready to run.
//  │
//  The success value (we haven't decoded it yet; Chapter 14 covers Schema).
```

The `never` in the `R` slot is the concrete signal that this program can be handed directly to `Effect.runPromise` — no dependency injection needed. The union in the `E` slot enumerates every failure mode the program can encounter, without any documentation, comments, or convention. The TypeScript compiler enforces that a caller either handles all three or propagates them to its own type.

---

## Variations

**`Effect.succeed(value)`** (`repos/effect/packages/effect/src/Effect.ts:3160`) — pure success wrapping a value already in hand. Use this when lifting a constant or a pure computed value into Effect context.

```ts
const config = Effect.succeed({ retries: 3, timeout: 5000 })
// Effect<{ retries: number; timeout: number }, never, never>
```

**`Effect.fail(error)`** (`repos/effect/packages/effect/src/Effect.ts:2575`) — typed failure. The error is a first-class value; it does not throw.

```ts
const notFound = Effect.fail(new MissingEnvVar({ name: "DB_URL" }))
// Effect<never, MissingEnvVar, never>
```

**`Effect.sync(thunk)`** (`repos/effect/packages/effect/src/Effect.ts:3326`) — defer any synchronous computation. Side effects inside the thunk are captured and deferred; they execute only when the surrounding Effect runs.

```ts
const now = Effect.sync(() => Date.now())
// Effect<number, never, never>
```

**`Effect.promise(thunk)`** (`repos/effect/packages/effect/src/Effect.ts:3131`) — wrap a `PromiseLike` that will not reject. The `AbortSignal` passed to the thunk is wired to Effect's interruption model, so if the Effect is interrupted, the signal fires.

```ts
const token = Effect.promise((signal) =>
  fetch("/auth/token", { signal }).then((r) => r.text())
)
// Effect<string, never, never>
```

**`Effect.tryPromise({ try, catch })`** (`repos/effect/packages/effect/src/Effect.ts:4677`) — wrap a `PromiseLike` that may reject. The `catch` callback receives the raw rejection and maps it to a typed error.

```ts
const data = Effect.tryPromise({
  try: (signal) => fetch("/api/items", { signal }).then((r) => r.json()),
  catch: (err) => new HttpError({ status: 0, url: "/api/items" }),
})
// Effect<unknown, HttpError, never>
```

**`Effect.async<A, E>((resume) => { ... })`** (`repos/effect/packages/effect/src/Effect.ts:2488`) — for callback-style APIs that do not return a Promise. Pass `resume(Effect.succeed(value))` on success and `resume(Effect.fail(error))` on failure. Full mechanics are deferred to Chapter 17 (Fibers and structured concurrency).

```ts
const fromCallback = Effect.async<string, Error>((resume) => {
  someCallbackApi((err, value) => {
    if (err) resume(Effect.fail(err))
    else resume(Effect.succeed(value!))
  })
})
// Effect<string, Error, never>
```

---

## Anti-patterns

### Using `Effect.promise` for a Promise that can reject

`Effect.promise` signals "I trust this will never reject". If the Promise does reject, the failure becomes a defect — an untyped, unrecoverable error in the `Cause` model — rather than a typed error you can handle:

```ts
// Wrong: if fetch throws (network error, CORS, etc.), the failure is
// untyped and not recoverable in the normal error channel.
const bad = Effect.promise(() => fetch("/api/data").then((r) => r.json()))
// Effect<unknown, never, never>  ← the never is a lie
```

The correct tool is `Effect.tryPromise` with a `catch` that maps the rejection to a typed error:

```ts
// Right: the failure is typed and handleable.
const good = Effect.tryPromise({
  try: () => fetch("/api/data").then((r) => r.json()),
  catch: (err) => new HttpError({ status: 0, url: "/api/data" }),
})
// Effect<unknown, HttpError, never>
```

Reserve `Effect.promise` for things that genuinely cannot reject: `Promise.resolve(value)`, `setTimeout` wrapped in a promise where the callback itself cannot throw, or `AbortSignal`-aware fetches where rejection is truly a programmer error.

### Calling `Effect.runPromise` inside business logic

Reaching for `Effect.runPromise` inside a service or a domain function to "convert back" to a `Promise` is the most common mistake in Effect codebases:

```ts
// Wrong: you are escaping the Effect runtime mid-program.
// Interruption, tracing, and context propagation all break here.
async function processItem(id: string): Promise<void> {
  const config = await Effect.runPromise(loadRemoteConfig)
  // ...
}
```

`Effect.runPromise` (and all `run*` functions) are the edge of the world. They belong at the top of the call stack — the `main` function, an HTTP handler, a test case. Business logic should stay in Effect and compose with `Effect.gen`, `Effect.flatMap`, or `pipe`. Chapter 03 covers the full set of `run*` functions and when to use each one.

---

## See also

- [Chapter 01 — Why Effect](01-why-effect.md) — the gaps in Promise, throw, and async that motivate the three type parameters
- [Chapter 03 — Running Effects](03-running-effects.md) — `runPromise`, `runSync`, `runFork`: turning a description into execution
- [Chapter 04 — pipe and dual API](04-pipe-and-dual-api.md) — the API style for chaining Effects with `pipe`
- [Chapter 05 — Effect.gen](05-effect-gen.md) — generator-based composition; how `yield*` sequences Effects
- [Chapter 06 — Typed errors](06-typed-errors.md) — the `E` parameter in full: `Data.TaggedError`, `catchTag`, and exhaustive error handling
- [Chapter 08 — Context and Tags](08-context-and-tags.md) — the `R` parameter in full: `Context.GenericTag`, `Tag`, and dependency injection
- [Patterns Catalog: Effect.succeed / fail / sync / promise / tryPromise](../../research/02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise) — canonical reference entry for this chapter's patterns
- [Per-package note: effect](../../research/packages/effect.md) — full package inventory and surface area
