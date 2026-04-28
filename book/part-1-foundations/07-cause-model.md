# Chapter 07 — The `Cause` model: Fail, Die, Interrupt, and their composition

> **Patterns introduced:** [`Cause` — `fail` / `die` / `interrupt` variants](../../research/02-patterns-catalog.md#cause--fail--die--interrupt-variants), [Exit — Effect outcome value (Success / Failure of Cause)](../../research/02-patterns-catalog.md#exit--effect-outcome-value-success--failure-of-cause)
> **Reads from:** [Chapter 06 — Typed errors](06-typed-errors.md)
> **Reads into:** Chapter 17 (Fibers and structured concurrency — interruption in detail), every chapter that touches concurrency
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 06 showed that typed errors give the `E` channel of `Effect<A, E, R>` real structure. A function that might fail with `UserNotFound | RateLimited` documents that contract in its return type. But the `E` channel only captures one category of failure — recoverable, expected, domain-level errors that callers are supposed to handle.

A concurrent runtime encounters at least three fundamentally different kinds of failure, and plain JavaScript's `Error` class cannot distinguish them:

**Recoverable domain errors.** "User not found." "Quota exceeded." These are expected; callers know about them and can act on them. They belong in `E`.

**Defects (programmer bugs).** A null pointer dereference, an out-of-bounds array access, an assertion failure, an uncaught exception thrown inside code that was supposed to be safe. These are not expected by callers. Silently recovering from a null dereference hides a bug; the right response is usually to surface it loudly so it gets fixed. They do not belong in `E` — putting them there would force every caller to handle what is really a programmer mistake.

**Structured cancellation.** When a parent fiber in a concurrent program decides to cancel a child fiber — because the user navigated away, because a timeout fired, because a different branch of a race succeeded first — the child sees an interruption signal. That is not an error at all; it is a controlled shutdown. Logging it as "error: fiber interrupted" creates noise that obscures real problems.

Now consider what happens when two parallel effects both fail, one with a domain error and one with a defect. What is the "error"? With plain JavaScript, you pick one and discard the other. Effect's runtime is lossless: it records all failures that occurred, the order they occurred in (sequential vs. simultaneous), and what kind each one was.

That richer description is the `Cause<E>`.

Effect uses `Cause<E>` as the complete failure record for every effect execution. The `E` channel you deal with in day-to-day code is just one piece of it — the `Fail` leaf of the tree. `Cause` holds the whole story.

---

## The minimal example

```ts
import { Cause, Effect, Exit } from "effect"

// Three distinct failure modes
const typed: Effect.Effect<never, string>  = Effect.fail("BAD")         // typed error
const defect: Effect.Effect<never, never>  = Effect.die("PANIC")        // unrecoverable defect
const cancel: Effect.Effect<never, never>  = Effect.interrupt           // structured cancellation

// runPromiseExit never rejects — it always resolves to an Exit
const result: Exit.Exit<never, string> = await Effect.runPromiseExit(typed)

if (Exit.isFailure(result)) {
  const cause = result.cause  // Cause<string>

  if (Cause.isFailType(cause)) {
    // cause.error is the typed value — "BAD"
    console.log("typed error:", cause.error)
  }

  if (Cause.isDieType(cause)) {
    // cause.defect is the raw panic value
    console.log("defect:", cause.defect)
  }

  if (Cause.isInterruptType(cause)) {
    // cause.fiberId identifies which fiber was interrupted
    console.log("interrupted by fiber:", cause.fiberId)
  }
}
```

---

## How it works

### `Exit<A, E>` — the outcome of running an effect

When the Effect runtime finishes executing an effect it produces an `Exit<A, E>`. This type is defined at `repos/effect/packages/effect/src/Exit.ts:26`:

```ts
export type Exit<A, E = never> = Success<A, E> | Failure<A, E>
```

`Success` carries the value `A` (`repos/effect/packages/effect/src/Exit.ts:69-78`, simplified — internal fields like `_op` and Unify symbols omitted for clarity):

```ts
export interface Success<out A, out E> extends Effect.Effect<A, E>, Pipeable, Inspectable {
  readonly _tag: "Success"
  readonly value: A
}
```

`Failure` carries a `Cause<E>` (`repos/effect/packages/effect/src/Exit.ts:35-44`):

```ts
export interface Failure<out A, out E> extends Effect.Effect<A, E>, Pipeable, Inspectable {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
}
```

`Effect.runPromiseExit` always resolves with an `Exit`, never rejects (`repos/effect/packages/effect/src/Effect.ts:12197-12200`). This gives you a typed, inspectable record of whatever happened. `Effect.runPromise`, by contrast, rejects with a `FiberFailure` object that wraps the `Cause` — useful for integrating with Promise-based infrastructure, but less convenient for inspection.

Inspect an `Exit` with `Exit.isSuccess`, `Exit.isFailure`, and `Exit.match`:

```ts
import { Cause, Effect, Exit } from "effect"

const inspect = async (effect: Effect.Effect<number, string>) => {
  const exit = await Effect.runPromiseExit(effect)
  return Exit.match(exit, {
    onSuccess: (value) => `succeeded: ${value}`,
    onFailure: (cause) => `failed: ${Cause.pretty(cause)}`,
  })
}
```

### `Cause<E>` — the algebraic failure tree

`Cause<E>` is a discriminated union defined at `repos/effect/packages/effect/src/Cause.ts:254-260`:

```ts
export type Cause<E> =
  | Empty
  | Fail<E>
  | Die
  | Interrupt
  | Sequential<E>
  | Parallel<E>
```

Each variant has a precise meaning.

**`Empty`** (`repos/effect/packages/effect/src/Cause.ts:455-457`) — the no-failure leaf. Used as the identity element when combining causes. `Cause.empty` constructs it (`repos/effect/packages/effect/src/Cause.ts:575`).

**`Fail<E>`** (`repos/effect/packages/effect/src/Cause.ts:474-477`) — a typed, recoverable error. The `error` field holds the `E` value:

```ts
export interface Fail<out E> extends Cause.Variance<E>, Equal.Equal, Pipeable, Inspectable {
  readonly _tag: "Fail"
  readonly error: E
}
```

`Effect.fail(e)` produces an effect whose `Cause` is a `Fail` leaf. `Cause.fail(e)` constructs the `Cause` value directly (`repos/effect/packages/effect/src/Cause.ts:591`). `Cause.isFailType(c)` narrows to this variant (`repos/effect/packages/effect/src/Cause.ts:683`).

**`Die`** (`repos/effect/packages/effect/src/Cause.ts:494-497`) — an unrecoverable defect. The `defect` field is `unknown` — it carries the raw panic value:

```ts
export interface Die extends Cause.Variance<never>, Equal.Equal, Pipeable, Inspectable {
  readonly _tag: "Die"
  readonly defect: unknown
}
```

`Effect.die(panic)` produces a defect-only effect (`repos/effect/packages/effect/src/Effect.ts:2647`). Throwing an uncaught exception inside `Effect.sync` also produces a `Die`. `Cause.die(d)` constructs the cause directly (`repos/effect/packages/effect/src/Cause.ts:607`). `Cause.isDieType(c)` narrows to it (`repos/effect/packages/effect/src/Cause.ts:693`).

**`Interrupt`** (`repos/effect/packages/effect/src/Cause.ts:515-518`) — fiber cancellation. Carries the `FiberId` of the fiber that was interrupted:

```ts
export interface Interrupt extends Cause.Variance<never>, Equal.Equal, Pipeable, Inspectable {
  readonly _tag: "Interrupt"
  readonly fiberId: FiberId.FiberId
}
```

`Effect.interrupt` is an effect that immediately interrupts itself (`repos/effect/packages/effect/src/Effect.ts:4881`). Structured concurrency uses interruption extensively — Chapter 17 covers this in depth. `Cause.interrupt(fiberId)` constructs the cause directly (`repos/effect/packages/effect/src/Cause.ts:623`). `Cause.isInterruptType(c)` narrows to it (`repos/effect/packages/effect/src/Cause.ts:703`).

**`Sequential<E>`** (`repos/effect/packages/effect/src/Cause.ts:556-560`) — two causes that occurred one after another. This happens when the main effect fails and then a finalizer (e.g., from `Effect.acquireRelease`) also fails. Both failures are preserved:

```ts
export interface Sequential<out E> extends Cause.Variance<E>, Equal.Equal, Pipeable, Inspectable {
  readonly _tag: "Sequential"
  readonly left: Cause<E>
  readonly right: Cause<E>
}
```

`Cause.sequential(c1, c2)` constructs it (`repos/effect/packages/effect/src/Cause.ts:655`).

**`Parallel<E>`** (`repos/effect/packages/effect/src/Cause.ts:535-539`) — two causes that occurred simultaneously. This appears when `Effect.all` or other concurrency combinators run multiple effects and more than one fails:

```ts
export interface Parallel<out E> extends Cause.Variance<E>, Equal.Equal, Pipeable, Inspectable {
  readonly _tag: "Parallel"
  readonly left: Cause<E>
  readonly right: Cause<E>
}
```

`Cause.parallel(c1, c2)` constructs it (`repos/effect/packages/effect/src/Cause.ts:639`).

**Why the distinction matters.** A `Sequential` cause carries causal ordering — typically "the body failed, then the finalizer failed" — and a caller may want to surface them as a chain or retry the body independently of the finalizer. A `Parallel` cause means the failures happened with no causal relationship — typical of `Effect.all([f1, f2])` where both branches fail. Recovery and reporting strategies differ: parallel causes often want aggregation (one consolidated error containing all branches); sequential causes often want temporal narrative ("failed during cleanup"). When you fold a `Cause` with `Cause.failures` or `Cause.defects`, the distinction is flattened — but if you walk the tree by hand (rare), you can preserve it.

### Utility functions for inspecting causes

**`Cause.pretty(cause)`** renders the full cause tree as a human-readable string, suitable for logging (`repos/effect/packages/effect/src/Cause.ts:1513-1515`). This is the first thing to reach for when debugging.

**`Cause.failureOption(cause)`** extracts the first `Fail<E>` value as `Option<E>` (`repos/effect/packages/effect/src/Cause.ts:860`). Use it when you need the typed error out of a cause without pattern-matching the full tree.

**`Cause.isInterruptedOnly(cause)`** returns `true` when the cause contains only `Interrupt` leaves and no `Fail` or `Die` (`repos/effect/packages/effect/src/Cause.ts:804`). This is the idiomatic check for "did this fail only because it was cancelled, with no real error?"

**`Cause.failures(cause)`** returns a `Chunk` of all `E` values from all `Fail` leaves (`repos/effect/packages/effect/src/Cause.ts:818`). Useful when a parallel cause may have multiple typed failures.

**`Cause.defects(cause)`** returns a `Chunk` of all `unknown` values from all `Die` leaves (`repos/effect/packages/effect/src/Cause.ts:832`).

### Cause and the error-handling operators

`Effect.catchTag` from Chapter 06 works by looking inside the `Fail` leaf of the `Cause`. It can only see typed errors. It does not see `Die` or `Interrupt`. If you run `catchTag("NotFound", ...)` on an effect that produced a `Die`, the `Die` passes through untouched.

To handle defects or inspect the full `Cause`, use `Effect.catchAllCause` (`repos/effect/packages/effect/src/Effect.ts:3518-3526`). It hands you the entire `Cause<E>` and lets you decide what to do. Alternatively, use `Effect.sandbox` (`repos/effect/packages/effect/src/Effect.ts:4246`) to promote the `Cause` into the error channel, apply ordinary `catchTag` / `catchAll` operators that can now see the cause structure, then call `Effect.unsandbox` to restore the normal channel shape.

---

## A production example

Three parallel fetches where two fail with typed errors and one panics. The resulting `Cause` is a tree, and you can walk it to log each failure appropriately.

```ts
import { Cause, Data, Effect, Exit } from "effect"

// ---- Typed error types ----

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string
  readonly status: number
}> {}

class ParseError extends Data.TaggedError("ParseError")<{
  readonly field: string
}> {}

// ---- Service stubs ----

declare const fetchUser: (id: string) => Effect.Effect<string, NetworkError>
declare const fetchOrders: (id: string) => Effect.Effect<string[], ParseError>
// fetchMetrics panics (simulates a bug — dies with a defect)
const fetchMetrics = (id: string): Effect.Effect<number, never> =>
  Effect.die(new Error(`metrics service unreachable for ${id}`))

// ---- Run all three in parallel, collect the Exit ----

const program = Effect.all(
  [fetchUser("u-1"), fetchOrders("u-1"), fetchMetrics("u-1")],
  { concurrency: "unbounded" }
)

const exit = await Effect.runPromiseExit(program)

// ---- Inspect whatever came back ----

if (Exit.isSuccess(exit)) {
  console.log("all succeeded:", exit.value)
} else {
  // exit.cause is Cause<NetworkError | ParseError>
  // Walk it and log each failure type appropriately
  const cause = exit.cause

  // Human-readable summary for structured logs
  console.error("run failed:\n" + Cause.pretty(cause))

  // Pull typed errors out of any Fail leaves
  const typedErrors = Cause.failures(cause)
  for (const err of typedErrors) {
    if (err._tag === "NetworkError") {
      console.warn(`network error on ${err.url}: HTTP ${err.status}`)
    } else if (err._tag === "ParseError") {
      console.warn(`parse error on field: ${err.field}`)
    }
  }

  // Check for defects separately — these are bugs, not domain errors
  const bugs = Cause.defects(cause)
  for (const bug of bugs) {
    console.error("DEFECT (bug in code):", bug)
  }

  // Only suppress if *all* failures were cancellations
  if (Cause.isInterruptedOnly(cause)) {
    console.info("run was cancelled — no real errors")
  }
}
```

When both `fetchUser` and `fetchOrders` fail concurrently, the runtime combines their causes with `Cause.parallel`. When `fetchMetrics` panics (a `Die`), that too is folded in. The final `Cause` tree is something like:

```
Parallel(
  Parallel(Fail(NetworkError), Fail(ParseError)),
  Die(Error("metrics service unreachable for u-1"))
)
```

Nothing is lost. `Cause.pretty` renders the whole tree. `Cause.failures` collects both typed errors. `Cause.defects` surfaces the bug. You deal with each in the way that makes sense.

---

## Variations

**`Effect.fail(e)` — typed domain error**

```ts
import { Data, Effect } from "effect"
class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}
const effect = Effect.fail(new NotFound({ id: "u-1" }))
// Cause: Fail(NotFound)
```

**`Effect.die(panic)` — unrecoverable defect**

```ts
import { Effect } from "effect"
const effect = Effect.die(new Error("assertion failed: invariant violated"))
// Cause: Die(Error("assertion failed: invariant violated"))
```

**`Effect.interrupt` — structured cancellation**

```ts
import { Effect } from "effect"
const effect = Effect.interrupt
// Cause: Interrupt(fiberId)
// Chapter 17 covers when the runtime issues interruption automatically.
```

**`Effect.failCause(cause)` — fail with an explicit cause**

```ts
import { Cause, Effect } from "effect"
// Useful inside catchAllCause when re-raising a modified cause:
const rethrow = (cause: Cause.Cause<string>) =>
  Effect.failCause(cause)
// repos/effect/packages/effect/src/Effect.ts:2591
```

**`Cause.fail(e)` / `Cause.die(d)` / `Cause.interrupt(fiberId)` — direct cause constructors**

```ts
import { Cause, FiberId } from "effect"
const typed = Cause.fail("domain error")          // repos/effect/packages/effect/src/Cause.ts:591
const defect = Cause.die(new RangeError("oops"))  // repos/effect/packages/effect/src/Cause.ts:607
const cancelled = Cause.interrupt(FiberId.none)   // repos/effect/packages/effect/src/Cause.ts:623
```

**`Cause.sequential(c1, c2)` / `Cause.parallel(c1, c2)` — compose causes**

```ts
import { Cause } from "effect"
const seq = Cause.sequential(Cause.fail("first"), Cause.fail("second"))
const par = Cause.parallel(Cause.fail("left"), Cause.die(new Error("right")))
// repos/effect/packages/effect/src/Cause.ts:655 and 639
```

**`Cause.isInterruptedOnly(c)` — distinguish cancellation from real failure**

```ts
import { Cause, FiberId } from "effect"
// Returns true only when the cause tree contains Interrupt nodes and nothing else.
// repos/effect/packages/effect/src/Cause.ts:804
const onlyCancel = Cause.isInterruptedOnly(Cause.interrupt(FiberId.none))
```

---

## Anti-patterns

### Using `Effect.fail` for unrecoverable programmer errors

```ts
import { Effect } from "effect"

// Wrong: a null pointer bug disguised as a typed, recoverable error.
const lookupIndex = (arr: number[], i: number) =>
  i < 0 ? Effect.fail("index out of bounds") : Effect.succeed(arr[i])
```

"Index out of bounds" caused by wrong logic at the call site is a programmer error, not a domain error callers should recover from. Surfacing it through `Effect.fail` forces every caller to handle a bug that should never occur. Use `Effect.die` (or let the runtime catch the throw):

```ts
import { Effect } from "effect"

// Right: a programming mistake becomes a defect, not a recoverable error.
const lookupIndex = (arr: number[], i: number) =>
  i < 0
    ? Effect.die(new RangeError(`index ${i} out of bounds`))
    : Effect.succeed(arr[i])
```

Alternatively, place a plain bounds-check inside `Effect.sync(() => { ... })` — if it throws, the runtime turns the throw into a `Die` automatically.

### Catching `Cause.Die` with `catchTag` like a typed error

```ts
import { Effect } from "effect"

// Wrong: Die does not appear in the E channel.
// This catchTag silently never fires when the Cause is a Die.
const bad = Effect.die(new Error("bug")).pipe(
  Effect.catchTag("Error", (_e) => Effect.succeed("recovered")) // never matches
)
```

`catchTag` only sees `Fail` leaves. To observe a `Die` you must reach for `Effect.catchAllCause` or `Effect.sandbox`. Reserve that for observability boundaries — logging, alerting — and generally let defects propagate so they surface visibly:

```ts
import { Cause, Effect } from "effect"

// Right: use catchAllCause at the edge of the system to log defects,
// then re-raise so the program still fails.
const withDefectLogging = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catchAllCause((cause) =>
      Cause.isDieType(cause)
        ? Effect.zipRight(
            Effect.logError("defect detected", cause),
            Effect.failCause(cause)
          )
        : Effect.failCause(cause)
    )
  )
```

### Ignoring `Cause.Interrupt` and logging it as an error

```ts
import { Cause, Effect, Exit } from "effect"

// Wrong: treats normal cancellation as a reportable error.
const exit = await Effect.runPromiseExit(Effect.interrupt)
if (Exit.isFailure(exit)) {
  // This will fire even for a clean shutdown, generating spurious alerts.
  console.error("something went wrong:", Cause.pretty(exit.cause))
}
```

Interruption is a normal part of structured concurrency — timeouts, races, and parent-fiber cleanup all produce `Interrupt` causes. Log or alert only when the failure contains something other than interruption:

```ts
import { Cause, Effect, Exit } from "effect"

// Right: skip logging for pure cancellation.
const exit = await Effect.runPromiseExit(Effect.interrupt)
if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
  console.error("real failure:", Cause.pretty(exit.cause))
}
```

---

## See also

- [Chapter 03 — Running Effects](03-running-effects.md) — `runPromise` rejects with `FiberFailure` carrying the full `Cause`; `runPromiseExit` always resolves and gives you `Exit<A, E>` directly
- [Chapter 06 — Typed errors](06-typed-errors.md) — typed errors live in `Cause.Fail`; `catchTag` operates on the `E` inside that leaf
- [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md) — interruption in depth: when it is issued, how it propagates, and how to suppress it for expected cancellation
- [Chapter 33 — Observability with @effect/opentelemetry](../part-2-tour/33-opentelemetry.md) — `Cause` values become span events and log data; `Cause.pretty` feeds into structured log fields
- [Patterns Catalog: Cause](../../research/02-patterns-catalog.md#cause--fail--die--interrupt-variants)
- [Patterns Catalog: Exit](../../research/02-patterns-catalog.md#exit--effect-outcome-value-success--failure-of-cause)
- [Per-package note: effect](../../research/packages/effect.md)
