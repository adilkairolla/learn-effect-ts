# Chapter 17 — Fibers and structured concurrency

> **Patterns introduced:** [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](../../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin), [Fiber — joining, interrupting, racing (Effect.fork return type)](../../research/02-patterns-catalog.md#fiber--joining-interrupting-racing-effectfork-return-type), [Structured concurrency via `Scope`](../../research/02-patterns-catalog.md#structured-concurrency-via-scope)
> **Reads from:** [Chapter 07 — Cause model](07-cause-model.md), [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md)
> **Reads into:** Part II Chapters 36 (Concurrency primitives), 37 (FiberRef, Semaphore)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

## The problem

JavaScript concurrency is unstructured. When you call `Promise.all`, fire a `setInterval`, or launch a web worker, there is no parent-child relationship between the thing that spawned the work and the work itself. If the parent fails or goes away, the children keep running unobserved.

The canonical `Promise.all` footgun makes this concrete:

```ts
async function fetchAll(ids: string[]) {
  // If any promise rejects, Promise.all throws — but the other fetches
  // keep running until they settle or the process exits. There is no
  // way to cancel them from here. They consume network, memory, and
  // CPU with nobody watching.
  return Promise.all(ids.map((id) => fetchUser(id)))
}
```

The rejected promise propagates an error, but the surviving promises run to completion invisibly. If those promises hold database connections, open file handles, or pending HTTP requests, those resources are leaked.

The ecosystem's answer is `AbortSignal` — but it is opt-in, every library implements it differently, passing the signal through every function call is boilerplate, and nesting cancellable work creates its own `AbortController` management nightmare.

The problem goes deeper than convenience. Without a parent-child model:

- A parent that fails has no way to tell its children to stop.
- A child that fails has no way to propagate that failure upward automatically.
- There is no guaranteed place to run cleanup code when a concurrent task is cancelled.
- Stack traces from async work are effectively meaningless because JS lost the call chain the moment execution crossed a microtask boundary.

Kotlin coroutines and the Python Trio library popularized a different approach called **structured concurrency**: every concurrent task has a parent, the parent's lifetime bounds the child's lifetime, a child's failure propagates to the parent, and cleanup always runs. Effect brings this model to TypeScript with **fibers**.

A fiber is:

- **Lightweight** — fibers are not OS threads. Effect's scheduler multiplexes thousands of fibers over a small JS event loop. You can fork tens of thousands of fibers without performance problems.
- **Hierarchical** — every fiber has a parent. The parent's scope bounds the child's lifetime.
- **Interruptible** — a fiber can receive an interruption signal and run finalizers before terminating. The signal propagates down to all nested Effects.
- **Scope-aware** — the lifetime of a fiber is linked to a `Scope` (introduced in Chapter 10). When the scope closes, the fiber is interrupted and finalizers run.

This chapter covers the four forking operators, how to interact with a `Fiber` value after forking, how racing works, and how the parent-child hierarchy makes the whole system self-cleaning.

## The minimal example

```ts
import { Effect, Fiber } from "effect"

const work = (label: string, ms: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(`${ms} millis`)
    return `${label} done`
  })

const program = Effect.gen(function* () {
  // Fork both — they start running immediately, in parallel
  const fiberA = yield* Effect.fork(work("A", 100))
  const fiberB = yield* Effect.fork(work("B", 200))

  // Join both — suspend until each fiber delivers its result
  const a = yield* Fiber.join(fiberA)
  const b = yield* Fiber.join(fiberB)

  return [a, b] // ["A done", "B done"]
})

Effect.runPromise(program).then(console.log)
// ["A done", "B done"]
```

`Effect.fork` returns immediately with a `Fiber.RuntimeFiber<A, E>`. The actual work starts concurrently. `Fiber.join` suspends the current fiber until the forked fiber completes and either delivers its value or re-raises its error.

## How it works

### Part A — The four `fork` variants

All four operators share the same shape: they accept an `Effect<A, E, R>` and return `Effect<Fiber.RuntimeFiber<A, E>, never, R>` (plus `Scope` in the case of `forkScoped`). The difference is which scope owns the resulting fiber — and therefore which scope's closure will interrupt it.

**`Effect.fork`** ties the child fiber to the parent fiber's scope.
(`repos/effect/packages/effect/src/Effect.ts:6241-6283`)

```ts
import { Effect, Fiber } from "effect"

const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(Effect.sleep("10 seconds"))
  // When this generator returns, the parent fiber's scope closes,
  // and the sleeping fiber is interrupted automatically.
  return "parent done"
})
```

The JSDoc states: "The forked fiber is attached to the parent fiber's scope. This means that when the parent fiber terminates, the child fiber will also be terminated automatically." This is the default choice for structured concurrency inside a single workflow.

**`Effect.forkDaemon`** ties the child fiber to the global runtime scope instead of the parent.
(`repos/effect/packages/effect/src/Effect.ts:6285-6334`)

```ts
import { Effect, Console, Schedule } from "effect"

const heartbeat = Effect.repeat(
  Console.log("still alive"),
  Schedule.fixed("1 second")
)

const program = Effect.gen(function* () {
  yield* Effect.forkDaemon(heartbeat)
  // heartbeat keeps running after this fiber exits
  yield* Effect.sleep("3 seconds")
})
```

The daemon fiber runs until the global runtime scope closes (i.e., until `runPromise` / `runFork` resolves the root program). The parent's termination does not interrupt it. This is the right tool for long-lived background services — metric reporters, health emitters — that must outlive any individual request fiber.

**`Effect.forkScoped`** ties the child fiber to the nearest `Scope` in the environment, not the parent fiber.
(`repos/effect/packages/effect/src/Effect.ts:6438-6506`)

```ts
import { Effect, Console, Schedule } from "effect"

const child = Effect.repeat(
  Console.log("child running"),
  Schedule.fixed("1 second")
)

const program = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.forkScoped(child) // tied to the scoped block's Scope
    yield* Effect.sleep("5 seconds")
    // When scoped() closes, child is interrupted, even if parent fiber lives on
  })
)
```

`forkScoped` is the canonical pattern inside `Layer.scoped` — you fork a background fiber that lives as long as the layer, not as long as any individual request that uses that layer. Because the return type adds `Scope` to the requirements (`Effect<RuntimeFiber<A, E>, never, Scope | R>`), the type system forces you to provide a scope before running.

**`Effect.forkIn(scope)`** ties the child fiber to an explicitly supplied `Scope`.
(`repos/effect/packages/effect/src/Effect.ts:6363-6435`)

```ts
import { Effect, Console, Schedule } from "effect"

const child = Effect.repeat(
  Console.log("child: still running!"),
  Schedule.fixed("1 second")
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const outerScope = yield* Effect.scope

    yield* Effect.scoped(
      Effect.gen(function* () {
        // Fork into the outer scope, not the inner one
        yield* Effect.forkIn(child, outerScope)
        yield* Effect.sleep("3 seconds")
        // inner scope closes here — child keeps running
      })
    )

    yield* Effect.sleep("5 seconds")
    // outer scope closes here — child is interrupted
  })
)
```

`forkIn` is useful when you need a fiber to outlive an inner scope but still be cleaned up by an outer one.

### Part B — `Fiber<A, E>` — what fork returns

All four variants return a `Fiber.RuntimeFiber<A, E>`, which extends `Fiber<A, E>`. The `Fiber` module provides the operations you need to observe and control a forked fiber.

**`Fiber.join(fiber)`** suspends the current fiber until the forked one completes. If the forked fiber succeeded, `join` returns its value. If it failed with a typed error, `join` re-raises that error in the joining fiber's error channel. If it was interrupted, the joining fiber receives an "inner interruption" — a `Cause.Interrupt` (see Chapter 07) — which can be caught.
(`repos/effect/packages/effect/src/Fiber.ts:517-527`)

**`Fiber.interrupt(fiber)`** sends an interruption signal to the fiber and waits until it has actually terminated (running any finalizers). It returns `Exit.Exit<A, E>`.
(`repos/effect/packages/effect/src/Fiber.ts:443-451`)

```ts
import { Effect, Fiber } from "effect"

const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(Effect.sleep("10 seconds"))
  yield* Effect.sleep("1 second")
  const exit = yield* Fiber.interrupt(fiber)
  // exit is Exit.Failure(Cause.interrupt(fiberId))
  return exit
})
```

**`Fiber.await(fiber)`** is like `join` but wraps the outcome in `Exit.Exit<A, E>` instead of re-raising errors. Use it when you want to inspect whether the fiber succeeded, failed, or was interrupted without immediately propagating a failure.
(`repos/effect/packages/effect/src/Fiber.ts:335-346` — exported as `Fiber.await`)

**`Fiber.all(fibers)`** combines an iterable of fibers into a single composite `Fiber` that produces an array of all results. The composite fiber fails as soon as any member fails. Useful when the number of concurrent fibers is dynamic.
(`repos/effect/packages/effect/src/Fiber.ts:371-378`)

**`Fiber.poll(fiber)`** is non-blocking: it returns `Effect<Option<Exit<A, E>>>` — `None` if the fiber is still running, `Some(exit)` if it has already completed. Use it in situations where you want to check a fiber's status without suspending.
(`repos/effect/packages/effect/src/Fiber.ts:629-636`)

### Part C — Racing

When you want the first result rather than all results, Effect provides race combinators that automatically interrupt the losers.

**`Effect.race(a, b)`** runs two effects concurrently. The first to succeed wins; the other is interrupted. If neither succeeds, the error channel contains both failures combined as a `Cause.Parallel`.
(`repos/effect/packages/effect/src/Effect.ts:8960-9100`)

```ts
import { Effect } from "effect"

const fast = Effect.succeed("fast").pipe(Effect.delay("50 millis"))
const slow = Effect.succeed("slow").pipe(Effect.delay("200 millis"))

const result = Effect.race(fast, slow)
// → "fast"; slow is interrupted
```

**`Effect.raceAll([a, b, c, ...])`** is the variadic version. The first to succeed wins; all others are interrupted.
(`repos/effect/packages/effect/src/Effect.ts:9102-9222`)

**`Effect.raceWith(a, b, { onSelfDone, onOtherDone })`** gives full control: both callbacks receive the `Exit` of the winner and a `Fiber` handle to the loser, so you can decide exactly what to do with the loser instead of always interrupting it.
(`repos/effect/packages/effect/src/Effect.ts:9365-9443`)

**`Effect.timeout(eff, duration)`** is the most common race pattern in practice. It races the effect against a timer and fails with `Cause.TimeoutException` if the timer wins first.
(`repos/effect/packages/effect/src/Effect.ts:7027-7030`)

```ts
import { Effect } from "effect"

const withDeadline = Effect.timeout(
  Effect.sleep("10 seconds"),
  "2 seconds"
)
// Fails with TimeoutException after 2 s
```

### Part D — Structured concurrency

The four fork variants are the mechanism; the principle they implement is structured concurrency.

The key guarantee is: **fork hierarchies match scope hierarchies**. When a scope closes — because the enclosing `Effect.scoped` block completed, because the parent fiber failed, because `Fiber.interrupt` was called — every fiber registered with that scope is interrupted. Effect propagates this interruption down the entire subtree, so nested fibers are also interrupted, and all registered finalizers run (in reverse registration order, mirroring the Chapter 10 `acquireRelease` guarantee).

This is fundamentally different from `Promise.all`. In `Promise.all`, if one promise rejects, the others continue running invisibly. In Effect, if a parent fiber fails, all its child fibers (those forked with `Effect.fork`) are interrupted before the error is propagated upward. The system is self-cleaning by construction.

Interruption is surfaced in the `Cause` model (see Chapter 07) as `Cause.Interrupt(fiberId)`. It is not a thrown exception; it is a structured value in the failure channel. That means you can observe it, log it, or recover from it with `Effect.catchAllCause`, while the default behavior is simply to let it propagate upward silently.

## A production example

The following shows a fan-out aggregator: fork N worker fibers, each sleeping to simulate I/O, collect all results, and race the whole batch against a timeout. If the timeout fires, all workers are interrupted cleanly.

```ts
import { Effect, Fiber, Exit, Cause } from "effect"

interface WorkerResult {
  id: number
  value: string
}

// Simulate a task that may take variable time
const worker = (id: number): Effect.Effect<WorkerResult> =>
  Effect.gen(function* () {
    yield* Effect.sleep(`${50 + id * 10} millis`)
    return { id, value: `result-${id}` }
  })

// Fan out: fork N workers, collect all fibers, wait for all results
const fanOut = (count: number): Effect.Effect<WorkerResult[]> =>
  Effect.gen(function* () {
    // Fork all workers; each is bound to this fiber's scope
    const fibers: Fiber.RuntimeFiber<WorkerResult>[] = []
    for (let i = 0; i < count; i++) {
      fibers.push(yield* Effect.fork(worker(i)))
    }

    // Combine into a single composite fiber, then join once
    const allFiber = Fiber.all(fibers)
    return yield* Fiber.join(allFiber)
  })

// Race the fan-out against a 500 ms deadline
const program: Effect.Effect<void> = Effect.gen(function* () {
  const exit = yield* Effect.exit(
    Effect.timeout(fanOut(8), "500 millis")
  )

  if (Exit.isSuccess(exit)) {
    console.log("All results:", exit.value)
  } else if (Cause.isInterruptedOnly(exit.cause)) {
    console.log("Interrupted (timeout or parent failure)")
  } else {
    console.log("Failed:", exit.cause)
  }
})

Effect.runPromise(program)
```

Several structured-concurrency patterns appear in the Effect monorepo itself. The cluster package forks supervisor fibers inside scoped layers:
`repos/effect/packages/cluster/src/ShardManager.ts` uses `Effect.forkScoped` to start a background reconciliation loop that is tied to the shard manager's scope. When the layer tears down, the reconciliation fiber is interrupted automatically — the same pattern shown in the `forkScoped` example above.

## Variations

```ts
import { Effect, Fiber, Schedule } from "effect"

// Parent-scope fork — child is interrupted when parent ends
const forkExample = Effect.fork(Effect.sleep("5 seconds"))

// Runtime-scope fork — child outlives parent, lives until program exits
const daemonExample = Effect.forkDaemon(
  Effect.repeat(Effect.log("tick"), Schedule.fixed("1 second"))
)

// Current-Scope fork — child lives until the enclosing Scope closes
const scopedExample = Effect.scoped(
  Effect.forkScoped(Effect.sleep("5 seconds"))
)

// Named-scope fork — child lives until the given Scope closes
const inScopeExample = (scope: import("effect").Scope.Scope) =>
  Effect.forkIn(Effect.sleep("5 seconds"), scope)

// Join / await / interrupt
const joinExample = (fiber: Fiber.RuntimeFiber<string>) =>
  Fiber.join(fiber) // Effect<string, E>

const awaitExample = (fiber: Fiber.RuntimeFiber<string>) =>
  Fiber.await(fiber) // Effect<Exit<string, E>>

const interruptExample = (fiber: Fiber.RuntimeFiber<string>) =>
  Fiber.interrupt(fiber) // Effect<Exit<string, E>>

// Race two effects — winner's value returned, loser interrupted
const raceExample = Effect.race(
  Effect.succeed("a").pipe(Effect.delay("100 millis")),
  Effect.succeed("b").pipe(Effect.delay("200 millis"))
)

// Timeout — common race shorthand
const timeoutExample = Effect.timeout(
  Effect.sleep("10 seconds"),
  "2 seconds"
)
```

## Anti-patterns

**Using `Promise.all` inside `Effect.gen`.**

```ts
// Wrong — Promise rejection bypasses Effect's Cause machinery;
// surviving promises are not interrupted; no structured cleanup.
const wrong = Effect.gen(function* () {
  const results = await Promise.all([fetchA(), fetchB(), fetchC()])
  return results
})

// Right — Effect manages the fibers; failures propagate through Cause;
// if one sub-effect fails, others are interrupted.
import { Effect } from "effect"
const right = Effect.all([fetchA(), fetchB(), fetchC()], {
  concurrency: "unbounded"
})
```

**Using `forkDaemon` for short-lived background work.**

```ts
import { Effect } from "effect"

// Wrong — daemon fiber is tied to the global runtime scope.
// If you forget to interrupt it, it leaks until the process exits.
const wrong = Effect.gen(function* () {
  yield* Effect.forkDaemon(processQueue())
})

// Right — forkScoped ties the fiber to the nearest Scope;
// when the scope closes (success, failure, or interruption),
// the fiber is interrupted and cleaned up automatically.
const right = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.forkScoped(processQueue())
    yield* doOtherWork()
  })
)
```

**Reading a forked fiber's result before joining.**

```ts
import { Effect, Fiber } from "effect"

// Wrong — fiber is asynchronous; accessing state outside join
// is a race condition.
const wrong = Effect.gen(function* () {
  let result: string | undefined
  const fiber = yield* Effect.fork(
    Effect.sync(() => { result = "done"; return "done" })
  )
  // result may still be undefined here — fork is async
  console.log(result)
})

// Right — always join (or await) to get the fiber's value.
const right = Effect.gen(function* () {
  const fiber = yield* Effect.fork(Effect.succeed("done"))
  const value = yield* Fiber.join(fiber)
  console.log(value) // "done", guaranteed
})
```

## See also

- [Chapter 03 — Running Effects](03-running-effects.md) — `Effect.runFork` returns a `Fiber.RuntimeFiber` you can join or interrupt from outside Effect
- [Chapter 07 — Cause model](07-cause-model.md) — `Cause.Interrupt` is what interrupted fibers produce; `Cause.isInterruptedOnly` is the right predicate to detect clean interruption
- [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md) — the `Scope` that bounds fiber lifetimes; `forkScoped` uses this directly
- [Chapter 16 — Stream](16-stream.md) — Streams are pulled by fibers internally; `Stream.runFork` is built on `Effect.fork`
- [Chapter 36 — Concurrency primitives](../part-2-tour/36-concurrency-primitives.md) — `Ref`, `Queue`, `PubSub`, and `Deferred` are the building blocks fibers communicate through
- [Chapter 37 — FiberRef and Semaphore](../part-2-tour/37-fiber-ref-and-semaphore.md) — `FiberRef` for fiber-local state; `Semaphore` for bounded concurrency; `FiberSet` / `FiberMap` / `FiberHandle` for lifecycle tracking
- [Patterns Catalog: Effect.fork variants](../../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin)
- [Patterns Catalog: Fiber](../../research/02-patterns-catalog.md#fiber--joining-interrupting-racing-effectfork-return-type)
- [Patterns Catalog: Structured concurrency via Scope](../../research/02-patterns-catalog.md#structured-concurrency-via-scope)
- [Per-package note: effect](../../research/packages/effect.md)
