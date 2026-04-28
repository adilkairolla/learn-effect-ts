# Chapter 05 — `Effect.gen` and generator-based composition

> **Patterns introduced:** [`Effect.gen` + `yield*`](../../research/02-patterns-catalog.md#effectgen--yield), [`Effect.fn` (named effect functions with auto-tracing)](../../research/02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing), [`Effect.all` / `Effect.repeat` / `Effect.retry` — combinators](../../research/02-patterns-catalog.md#effectall--effectrepeat--effectretry--combinators)
> **Reads from:** [Chapter 02 — Effect as a value](02-effect-as-a-value.md), [Chapter 03 — Running Effects](03-running-effects.md), [Chapter 04 — pipe and dual API](04-pipe-and-dual-api.md)
> **Reads into:** every subsequent chapter — `Effect.gen` is THE composition primitive
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 04 introduced `pipe` and the `.pipe()` method as the primary way to sequence Effect operations. For a short, linear sequence with no branching, this style is fine:

```ts
import { Effect } from "effect"

const result = fetchUser("u-1").pipe(
  Effect.map((user) => `${user.firstName} ${user.lastName}`),
  Effect.flatMap((name) => saveAuditLog(`fetched ${name}`).pipe(Effect.map(() => name))),
)
```

But consider what happens once the sequence grows or branches. In plain TypeScript, the analogous problem appears with `.then` chains. A fetch that needs five sequential steps looks like this:

```ts
fetchUser(id)
  .then((user) => fetchProfile(user.id))
  .then((profile) => fetchOrders(profile.accountId))
  .then((orders) => {
    if (orders.length === 0) {
      return Promise.reject(new EmptyOrdersError())
    }
    return enrichOrders(orders)
  })
  .then((enriched) => buildDashboard(enriched))
  .catch((e) => { /* one catch for everything */ })
```

Two problems appear immediately. First, every new step adds a callback frame. The logic — what the code actually does — is buried inside those frames. Second, the early return on line 9 forces you to use `Promise.reject` as a control-flow mechanism, which is semantically odd; you are not rejecting anything, you are signalling a business condition. Any branching — "if user is an admin, do X, else do Y" — adds further nesting inside a callback. Error handling with `.catch` at the end catches everything indiscriminately.

The Effect equivalent using `flatMap` pipelines has the same structural problem: five sequential `flatMap` calls with one callback each, and conditional logic requires reaching for `Effect.if`, `Effect.cond`, or nested `.pipe(...)` calls that further inflate the indentation.

The solution is generators — the same insight that motivated `async/await` in JavaScript, but applied to Effect rather than Promises. With generators you get:

- A flat, top-to-bottom read that mirrors sequential execution.
- Local bindings (`const a = yield* ...`) that are in scope for all subsequent steps.
- Normal `if`/`else`, `while`, `return` — all the control-flow tools you already know.
- Typed errors, typed dependencies, and interruption support, all preserved.

---

## The minimal example

```ts
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(1)
  const b = yield* Effect.succeed(2)
  return a + b
})

// program: Effect<number, never, never>
```

`program` is a plain `Effect`. Nothing has run. `Effect.gen` takes a generator function and returns an `Effect` that, when run, will execute the body step by step, suspending at each `yield*` and resuming with the unwrapped value. To actually run it:

```ts
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(1)
  const b = yield* Effect.succeed(2)
  return a + b
})

Effect.runPromise(program).then(console.log) // => 3
```

This looks like `async/await`. It is not. `async/await` is compiled down to Promise chains and runs on the microtask queue; it has no typed error channel, no dependency tracking, and no interruption. `Effect.gen` uses JavaScript's generator protocol — `function*` and `yield*` — to let the Effect runtime control scheduling, error propagation, and context injection. The surface syntax is similar; the semantics are entirely different.

---

## How it works

### Part A — `Effect.gen` and `yield*`

`Effect.gen` is exported at `repos/effect/packages/effect/src/Effect.ts:2760-2776`:

```ts
export const gen: {
  <Eff extends YieldWrap<Effect<any, any, any>>, AEff>(
    f: (resume: Adapter) => Generator<Eff, AEff, never>
  ): Effect<
    AEff,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect<infer _A, infer E, infer _R>>] ? E : never,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect<infer _A, infer _E, infer R>>] ? R : never
  >
  // ...second overload accepting a `this` binding
} = core.gen
```

The callback receives one argument conventionally named `_` or `resume` — the `Adapter`. You almost never use this adapter directly because modern TypeScript projects rely on `yield*` alone, but it is the value that was historically used in older Effect versions for `yield*(_(someEffect))` patterns. Today you write `yield* someEffect` directly and TypeScript infers correctly.

The `Adapter` interface is defined at `repos/effect/packages/effect/src/Effect.ts:2782-3042 — the Adapter interface (only the first two overloads are reproduced here)`:

```ts
export interface Adapter {
  <A, E, R>(self: Effect<A, E, R>): Effect<A, E, R>
  <A, _A, _E, _R>(a: A, ab: (a: A) => Effect<_A, _E, _R>): Effect<_A, _E, _R>
  // ... further overloads for pipe-like chaining
}
```

The `Adapter` is a function that can optionally chain transformations before yielding, so `yield* _(effect, transform1, transform2)` is valid — but in practice you just write `yield* effect` and run any transforms before the `yield*`.

**Why `yield*` and not `yield`:** `yield` sends a value out of the generator and suspends it. `yield*` delegates to another iterable or generator, walking it to completion and returning its final result. Effect values implement the iterator protocol, so `yield* someEffect` tells JavaScript: "iterate this Effect to completion; give me the unwrapped `A` value." If the Effect fails, the generator throws (which `Effect.gen`'s runner catches and converts to a typed failure). This delegation protocol is what makes the control flow work.

**`Option` and `Either` are also yieldable.** Both implement `EffectPrototype`, so `yield* someOption` and `yield* someEither` are valid inside a gen block. A `None` causes the generator to fail with `Cause.NoSuchElementException`; a `Left(e)` fails with `e` as a typed error. Chapter 12 covers this in depth.

**Conditional branches and early returns:**

```ts
import { Effect, Data } from "effect"

class UserNotActiveError extends Data.TaggedError("UserNotActiveError")<{
  userId: string
}> {}

const processPurchase = (userId: string, amount: number) =>
  Effect.gen(function* () {
    const user = yield* fetchUser(userId)

    if (!user.isActive) {
      // return is fine here — it short-circuits the gen and fails the Effect
      return yield* Effect.fail(new UserNotActiveError({ userId }))
    }

    const charged = yield* chargeAccount(userId, amount)
    yield* sendReceipt(userId, charged)
    return charged
  })
```

The `if (!user.isActive) { return yield* Effect.fail(...) }` pattern works exactly as you would expect. The `yield*` inside the `if` block executes the fail effect; the `return` exits the generator; `Effect.gen` converts the generator's thrown error into the Effect's `E` channel. No `else` block needed, no nested `.pipe(...)`, no `Effect.cond`. Normal TypeScript control flow is fully available.

**Type inference:** The return type of `Effect.gen(function* () { ... })` is inferred automatically. The `E` type is the union of all `yield*`ed effects' `E` types. The `R` type is the union of all `yield*`ed effects' `R` types. The `A` type is the return type of the generator function body. TypeScript's generator type inference handles this without annotation in most cases. There is a known limitation: deeply complex union types, especially when conditional types appear in the generator body, can cause TypeScript to widen inference to `unknown` or produce unexpected unions. When this happens, an explicit type annotation on the returned `Effect` (or on a `yield*` assignment) resolves it.

### Part B — `Effect.fn` (named effect functions)

`Effect.fn` is exported at `repos/effect/packages/effect/src/Effect.ts:14630-14636`:

```ts
export const fn:
  & fn.Gen
  & fn.NonGen
  & ((
    name: string,
    options?: Tracer.SpanOptions
  ) => fn.Gen & fn.NonGen) = function(nameOrBody, ...pipeables) { ... }
```

The common production form takes a string name first, then a generator function:

```ts
import { Effect } from "effect"

const loadUser = Effect.fn("loadUser")(function* (userId: string) {
  const row = yield* queryDatabase(userId)
  return parseUser(row)
})
```

`loadUser` is now a function `(userId: string) => Effect<User, DbError, DbService>`. Every time it is called, the resulting Effect carries a tracing span named `"loadUser"`. If you have an OpenTelemetry-compatible collector wired up (Chapter 33), every invocation appears as a named node in your traces with accurate start/end times and any attributes you attach.

Without `Effect.fn`, you would need to wrap every named function manually:

```ts
// Without Effect.fn — you must add withSpan at every call site or wrap the gen
const loadUserManual = (userId: string) =>
  Effect.gen(function* () {
    const row = yield* queryDatabase(userId)
    return parseUser(row)
  }).pipe(Effect.withSpan("loadUser"))
```

`Effect.fn` collapses the name and the generator into one declaration. For anonymous internal helpers, `Effect.gen` alone is fine. For anything that will appear in a service interface or a module's public API, `Effect.fn` is the preferred form.

### Part C — Combinators: `Effect.all`, `Effect.repeat`, `Effect.retry`

These three operators land outside the generator body and are typically chained onto a `gen` block with `.pipe()`. They handle the patterns that `gen` alone cannot express concisely.

**`Effect.all`** is exported at `repos/effect/packages/effect/src/Effect.ts:825-834`. It takes an array or struct of Effects and runs them, collecting results:

```ts
import { Effect } from "effect"

// Sequential (default) — processes one at a time
const sequential = Effect.all([fetchA(), fetchB(), fetchC()])
// Effect<[ResultA, ResultB, ResultC], ErrorA | ErrorB | ErrorC, never>

// Parallel — all three start immediately
const parallel = Effect.all([fetchA(), fetchB(), fetchC()], { concurrency: "unbounded" })

// Struct form — results are an object with matching keys
const struct = Effect.all({
  user: fetchUser(id),
  orders: fetchOrders(id),
}, { concurrency: "unbounded" })
// Effect<{ user: User; orders: Order[] }, UserError | OrderError, never>
```

The default `concurrency` is `1` (sequential). For independent operations you almost always want `{ concurrency: "unbounded" }` or a fixed number like `{ concurrency: 4 }`. If one Effect in the array fails, `Effect.all` interrupts the others before propagating the failure. Chapter 17 (Fibers and structured concurrency) covers the concurrency options in full.

**`Effect.retry`** is exported at `repos/effect/packages/effect/src/Effect.ts:4400-4410`. It retries a failing Effect according to a `Schedule`:

```ts
import { Effect, Schedule } from "effect"

const resilient = fetchFromApi(url).pipe(
  Effect.retry(Schedule.exponential("100 millis").pipe(
    Schedule.compose(Schedule.recurs(3))
  ))
)
// Retries up to 3 times with exponential back-off starting at 100ms
```

`retry` is a dual function: it works both as a pipeline operator and as a direct call. Chapter 34 (Schedule, Part II) covers all the `Schedule` combinators. For this chapter, the key point is that `retry` wraps any Effect — including a `gen` block — without any changes to the gen body itself.

**`Effect.repeat`** is exported at `repos/effect/packages/effect/src/Effect.ts:10178-10192`. It repeats a successful Effect on a schedule:

```ts
import { Effect, Schedule } from "effect"

const heartbeat = pingServer().pipe(
  Effect.repeat(Schedule.spaced("5 seconds"))
)
// Pings every 5 seconds, indefinitely
```

The runtime uses `Effect.repeat` internally: see `repos/effect/packages/effect/src/internal/channel.ts:1154` where `Effect.repeat({ until: ... })` drives channel read loops. Chapter 34 has the full `Schedule` story.

---

## A production example

Here is a realistic `loadUserDashboard` function that combines all three patterns: `Effect.fn` for tracing, `Effect.gen` for sequencing, `Effect.all` for parallel fetches, and `Effect.retry` for resilience.

```ts
import { Effect, Schedule, Data } from "effect"

// Error types — Chapter 06 covers these in full
class FetchUserError extends Data.TaggedError("FetchUserError")<{
  userId: string
  cause: unknown
}> {}

class FetchPostsError extends Data.TaggedError("FetchPostsError")<{
  userId: string
  cause: unknown
}> {}

interface User { id: string; name: string; email: string }
interface Post { id: string; title: string; authorId: string }
interface Dashboard { user: User; posts: Post[]; postCount: number }

// Simulated data-access effects (would be real service calls in production)
declare const getUser: (id: string) => Effect.Effect<User, FetchUserError>
declare const getPosts: (userId: string) => Effect.Effect<Post[], FetchPostsError>

// Effect.fn wraps the generator with a tracing span named "loadUserDashboard".
// Every call shows up as a named span in distributed traces (Chapter 33).
const loadUserDashboard = Effect.fn("loadUserDashboard")(
  // Effect.fn's complex union return type sometimes overwhelms TS's generator
  // inference; using `any` for the yield/next slots is the idiomatic workaround.
  function* (userId: string): Generator<
    any,
    Dashboard,
    any
  > {
    // Fetch user and posts in parallel — neither depends on the other.
    // Effect.all with concurrency:"unbounded" starts both immediately.
    const { user, posts } = yield* Effect.all(
      {
        user: getUser(userId),
        posts: getPosts(userId),
      },
      { concurrency: "unbounded" }
    )

    return {
      user,
      posts,
      postCount: posts.length,
    }
  }
)

// Wrap the function call with retry logic: exponential back-off, 3 attempts max.
// Effect.retry and the Schedule are added outside the gen body — the body is
// unchanged regardless of retry policy.
const resilientDashboard = (userId: string) =>
  loadUserDashboard(userId).pipe(
    Effect.retry(
      Schedule.exponential("200 millis").pipe(
        Schedule.compose(Schedule.recurs(3))
      )
    )
  )

// At the edge of the application
Effect.runPromise(resilientDashboard("user-abc")).then(
  (dashboard) => console.log(`Loaded ${dashboard.postCount} posts for ${dashboard.user.name}`),
  (err) => console.error("Dashboard load failed:", err)
)
```

A few things worth noting in this example. The `Effect.all` struct form means the two fetches start simultaneously; the result is destructured directly in the `yield*` assignment. The retry schedule is attached with `.pipe(Effect.retry(...))` after the `loadUserDashboard` call — no retry logic leaks into the generator body, which keeps the business logic clean. The tracing span `"loadUserDashboard"` wraps the entire operation including retries.

---

## Variations

**`Effect.gen(function* () { ... })`** — the basic form for anonymous sequential computation.

```ts
import { Effect } from "effect"
const program = Effect.gen(function* () {
  const n = yield* Effect.succeed(42)
  return n * 2
})
```

**`const value = yield* effect`** — binds the unwrapped success value of any `Effect`.

```ts
import { Effect } from "effect"
const program = Effect.gen(function* () {
  const text = yield* Effect.tryPromise({
    try: () => fetch("/api/data").then((r) => r.text()),
    catch: (e) => new Error(String(e))
  })
  return text.length
})
```

**`yield* someOption` / `yield* someEither`** — `Option.None` fails with `Cause.NoSuchElementException`; `Either.Left(e)` fails with `e`. Both `Option` and `Either` implement `EffectPrototype` and are directly yieldable. Chapter 12 covers bridging Option/Either into Effect in full. Note: `Option.Some<A>` is typed `extends Effect<A, Cause.NoSuchElementException>`, so the gen block's `E` channel will include `NoSuchElementException` whenever you `yield*` an Option — even if the runtime path can't actually fail. This is a typing artifact, not a runtime concern.

```ts
import { Effect, Option } from "effect"
const program = Effect.gen(function* () {
  const n = yield* Option.some(10)   // binds 10
  const m = yield* Option.none()     // fails with NoSuchElementException
  return n + m
})
```

**Early return with `return`** — exits the generator immediately; the returned value becomes the success value of the Effect.

```ts
import { Effect } from "effect"
const checked = (flag: boolean) => Effect.gen(function* () {
  if (!flag) return "skipped"
  yield* doWork()
  return "done"
})
```

**Conditional `yield*` inside `if`** — branches work naturally; the Effect on the true branch is only executed when the condition holds.

```ts
import { Effect } from "effect"
const guarded = Effect.gen(function* () {
  const user = yield* fetchUser("u-1")
  if (user.role === "admin") {
    yield* grantAdminAccess(user.id)
  }
  return user
})
```

**`Effect.gen(...).pipe(Effect.retry(schedule))`** — attach combinators to a gen block after the fact; the generator body is unchanged.

```ts
import { Effect, Schedule } from "effect"
const withRetry = Effect.gen(function* () {
  return yield* callFlakyService()
}).pipe(Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.compose(Schedule.recurs(5)))))
```

**`Effect.fn("name")(function* (...args) { ... })`** — named effect function with auto-tracing; use this for any function that will appear in a service interface or module public API.

```ts
import { Effect } from "effect"
const processOrder = Effect.fn("processOrder")(function* (orderId: string) {
  const order = yield* fetchOrder(orderId)
  yield* validateOrder(order)
  return yield* fulfillOrder(order)
})
```

---

## Anti-patterns

### Calling `Effect.runPromise` inside `Effect.gen`

The whole point of `Effect.gen` is to compose Effects without executing them — execution happens once, at the top of the call stack. Calling `runPromise` inside a gen block breaks the runtime's interruption, tracing, and context propagation.

```ts
import { Effect } from "effect"

// Wrong: running an Effect inside a gen block breaks the runtime contract.
const bad = Effect.gen(function* () {
  const user = await Effect.runPromise(fetchUser("u-1")) // DO NOT DO THIS
  return user.name
})

// Right: yield* sequences Effects without leaving the Effect runtime.
const good = Effect.gen(function* () {
  const user = yield* fetchUser("u-1")
  return user.name
})
```

### Using `try/catch` inside `Effect.gen` to catch `yield*` errors

When a `yield*`ed Effect fails, the error short-circuits the generator and surfaces in the `E` channel of the resulting Effect. A `try/catch` around a `yield*` will appear to work for defects (thrown JavaScript errors) but will not catch typed Effect failures. The Effect runtime drives the generator by calling `iterator.next(value)` and never `iterator.throw()`. When a `yield*`-ed effect fails, the runtime extracts the failure and returns it without re-entering the generator — so any `try/catch` wrapped around `yield*` in the generator body is bypassed entirely. See `repos/effect/packages/effect/src/internal/fiberRuntime.ts` near the `OP_ITERATOR` handler (lines 192-211) for this behaviour.

```ts
import { Effect } from "effect"

// Wrong: try/catch does not reliably catch typed Effect errors from yield*.
const bad = Effect.gen(function* () {
  try {
    const user = yield* fetchUser("u-1") // typed failures bypass try/catch
    return user
  } catch (e) {
    return null // this may not fire for typed Effect errors
  }
})

// Right: use Effect.catchTag (or catchAll) to handle typed errors.
const good = Effect.gen(function* () {
  const user = yield* fetchUser("u-1")
  return user
}).pipe(
  Effect.catchTag("UserNotFoundError", (e) => Effect.succeed(null))
)
```

### Mixing `await` inside `Effect.gen`

Generator functions and async functions are different JavaScript features. A `function*` generator cannot `await`; the `await` keyword is only valid inside `async function`. TypeScript and every modern JavaScript engine reject this as a SyntaxError. There is no fallback behavior to debug — the program won't compile.

```ts
import { Effect } from "effect"

// Wrong: await is not valid inside a generator function.
const bad = Effect.gen(function* () {
  const data = await fetch("/api/items").then((r) => r.json()) // TypeScript and every modern JavaScript engine reject this as a SyntaxError. There is no fallback behavior to debug — the program won't compile.
  return data
})

// Right: wrap Promises with Effect.tryPromise before yielding.
const good = Effect.gen(function* () {
  const data = yield* Effect.tryPromise({
    try: () => fetch("/api/items").then((r) => r.json()),
    catch: (e) => new Error(String(e))
  })
  return data
})
```

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the `Effect<A, E, R>` type and the constructors that produce values to `yield*`
- [Chapter 03 — Running Effects](03-running-effects.md) — `Effect.runPromise` and friends; where `gen` blocks ultimately execute
- [Chapter 04 — pipe and dual API](04-pipe-and-dual-api.md) — the `.pipe()` method used to attach `retry`, `repeat`, and `catchTag` to `gen` blocks
- [Chapter 06 — Typed errors](06-typed-errors.md) — error short-circuiting in `gen` and `Effect.catchTag` for recovery
- [Chapter 12 — Option and Either](12-option-and-either.md) — yielding `Option` and `Either` directly; `None` and `Left` semantics in a gen block
- [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md) — concurrency options on `Effect.all`; how parallel fibers are structured
- [Chapter 33 — Observability with @effect/opentelemetry](../part-2-tour/33-opentelemetry.md) — where Effect.fn's auto-traced spans become visible
- [Chapter 34 — Schedule](34-schedule.md) (Part II) — `Schedule.exponential`, `recurs`, `spaced`, and other schedules used with `retry` and `repeat`
- [Patterns Catalog: Effect.gen + yield*](../../research/02-patterns-catalog.md#effectgen--yield)
- [Patterns Catalog: Effect.fn (named effect functions with auto-tracing)](../../research/02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing)
- [Patterns Catalog: Effect.all / Effect.repeat / Effect.retry — combinators](../../research/02-patterns-catalog.md#effectall--effectrepeat--effectretry--combinators)
