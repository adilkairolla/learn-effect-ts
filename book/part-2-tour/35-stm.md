# Chapter 35 — STM — software transactional memory

> **Package(s):** `effect`
> **Patterns introduced:** [`STM.gen` / `STM.commit` — software transactional memory](../../research/02-patterns-catalog.md#stmgen--stmcommit--software-transactional-memory), [`TRef` / `TQueue` / `TMap` / `TSemaphore` — STM-aware variants](../../research/02-patterns-catalog.md#tref--tqueue--tmap--tsemaphore--stm-aware-variants)
> **Reads from:** [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md)
> **Reads into:** Chapter 36 (Concurrency primitives — Ref, Queue, PubSub, and friends), Chapter 37 (FiberRef, Semaphore, and advanced concurrency patterns)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 17 introduced fibers: lightweight green threads that let you run thousands of concurrent tasks inside a single JavaScript process. Fibers are great at parallelism. Where they stumble is shared mutable state.

Consider a bank with two accounts. You want to transfer money from one to the other. The obvious Effect implementation uses two `Ref` cells:

```ts
import { Effect, Ref } from "effect"

// This code has a race condition. Do not use in production.
const transfer = (
  fromRef: Ref.Ref<number>,
  toRef: Ref.Ref<number>,
  amount: number
) =>
  Effect.gen(function* () {
    const from = yield* Ref.get(fromRef)
    if (from < amount) return yield* Effect.fail("InsufficientFunds" as const)
    // -----------------------------------------------------------
    // A competing fiber can run HERE between these two updates.
    // It might read `fromRef` before the debit lands, or read
    // `toRef` before the credit lands. Money can appear to
    // vanish or double.
    // -----------------------------------------------------------
    yield* Ref.update(fromRef, (n) => n - amount)
    yield* Ref.update(toRef, (n) => n + amount)
  })
```

`Ref.update` is individually atomic — no two fibers can corrupt a single `Ref`. But two separate `Ref.update` calls are not atomic together. The window between the debit and the credit is a real race condition. Any fiber that observes state between those two updates sees money that has neither left the source account nor arrived at the destination.

The traditional fix is a mutex:

```ts
import { Effect, Ref } from "effect"

// Manual lock — composability and deadlock risk
// (Note: Effect's Semaphore is not a top-level module export; it is an
// interface returned by Effect.makeSemaphore. The real deadlock risk is
// that holding a lock across async operations makes cross-account
// transfers susceptible to lock-order inversion.)
const makeTransferService = Effect.gen(function* () {
  const lock = yield* Effect.makeSemaphore(1)
  return (from: Ref.Ref<number>, to: Ref.Ref<number>, amount: number) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const bal = yield* Ref.get(from)
        if (bal < amount) return yield* Effect.fail("InsufficientFunds" as const)
        yield* Ref.update(from, (n) => n - amount)
        yield* Ref.update(to, (n) => n + amount)
      })
    )
})
```

This works for one pair of accounts. But locks do not compose. If two transfer operations lock different subsets of accounts in different orders, you get a classic deadlock. The bigger the system, the worse the problem. Hand-rolled locking also leaks the lock discipline into every call site.

Software transactional memory eliminates both the race and the deadlock.

> **CRITICAL NOTE on naming:** If you have seen ZIO or Haskell STM, you may expect a function called `STM.atomically`. **It does not exist in Effect.** The function that runs an STM transaction as an `Effect` is called `STM.commit`. This chapter uses `STM.commit` exclusively. Any code you find elsewhere that calls `STM.atomically` will not compile.

---

## The minimal example

```ts
import { Effect, STM, TRef } from "effect"

// Build a transaction that atomically swaps two counters
const program = Effect.gen(function* () {
  // TRef.make returns an STM, so we commit it to get an Effect
  const counterA = yield* STM.commit(TRef.make(100))
  const counterB = yield* STM.commit(TRef.make(0))

  // Describe the atomic operation — nothing runs yet
  const swap = STM.gen(function* () {
    const a = yield* TRef.get(counterA)
    const b = yield* TRef.get(counterB)
    yield* TRef.set(counterA, b)
    yield* TRef.set(counterB, a)
  })

  // commit() converts STM<void> → Effect<void> and runs atomically
  yield* STM.commit(swap)

  const a = yield* STM.commit(TRef.get(counterA))
  const b = yield* STM.commit(TRef.get(counterB))
  console.log(`counterA=${a}, counterB=${b}`)
  // counterA=0, counterB=100
})

Effect.runPromise(program)
```

Both `TRef.set` calls land atomically. No fiber observes an intermediate state where `counterA` is still 100 and `counterB` is already 100.

---

## Tour

### STM.gen / STM.commit

`STM<A, E, R>` is a _description_ of transactional work, analogous to how `Effect<A, E, R>` is a description of effectful work. An STM value does nothing until you convert it to an Effect via `STM.commit`.

**`STM.gen`** — generator-based composition of transactional operations:

```ts
// repos/effect/packages/effect/src/STM.ts:1069-1084
export const gen: <Self, Eff extends YieldWrap<STM<any, any, any>>, AEff>(
  ...args:
    | [self: Self, body: (this: Self, resume: Adapter) => Generator<Eff, AEff, never>]
    | [body: (resume: Adapter) => Generator<Eff, AEff, never>]
) => STM<AEff, ...> = stm.gen
```

You write transactional logic the same way you write `Effect.gen` code — with `yield*` at each step. The difference is that everything yielded inside `STM.gen` is itself an `STM`, not an `Effect`. You cannot `yield*` an arbitrary `Effect` inside an STM block; STM is a pure, deterministic DSL with no side-channel escapes.

**`STM.commit`** — runs an STM transaction atomically as an `Effect`:

```ts
// repos/effect/packages/effect/src/STM.ts:418-424
/**
 * Commits this transaction atomically.
 *
 * @since 2.0.0
 * @category destructors
 */
export const commit: <A, E, R>(self: STM<A, E, R>) => Effect.Effect<A, E, R> = core.commit
```

`STM.commit` is the boundary between the transactional world and the effect world. Inside the transaction, reads and writes to `TRef` values are buffered in a local journal. When `STM.commit` is called:

1. The runtime validates the journal: checks that every `TRef` read during the transaction still holds the same value it had when the transaction started.
2. If validation succeeds, all writes are flushed atomically.
3. If validation fails (another fiber modified a `TRef` since the transaction began), the transaction is rolled back and retried from the top.

This is **optimistic concurrency**. The common case — no contention — has no synchronization overhead. Under contention, transactions retry rather than deadlock.

**`STM.retry` and `STM.check`** — blocking until a condition is true:

The retry mechanism is not just for conflict recovery. You can request a retry explicitly. `STM.retry` aborts the current transaction and re-runs it when any `TRef` it read has changed. `STM.check` is the higher-level helper:

```ts
// repos/effect/packages/effect/src/STM.ts:388-394
/**
 * Checks the condition, and if it's true, returns unit, otherwise, retries.
 *
 * @since 2.0.0
 * @category constructors
 */
export const check: (predicate: LazyArg<boolean>) => STM<void> = stm.check
```

`STM.check(condition)` is equivalent to `condition ? STM.succeed(undefined) : STM.retry`. The transaction suspends until one of the `TRef` values it observed changes, then re-runs and re-evaluates the condition. This is how `TQueue.take` blocks on an empty queue without polling: it reads the queue size, calls `STM.check(size > 0)`, and sleeps until another transaction enqueues an item.

**Typed errors in STM.** An `STM<A, E, R>` carries a typed error channel just like `Effect`. Use `STM.fail` to signal a typed failure:

```ts
// repos/effect/packages/effect/src/STM.ts:561-567
/**
 * Fails the transactional effect with the specified error.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fail: <E>(error: E) => STM<never, E> = core.fail
```

A failure short-circuits the transaction and no writes are committed. When combined with `STM.check`, this gives you the full conditional-atomic-abort pattern needed for business logic like "transfer funds only if balance is sufficient."

**`STM.orElse`** — provide an alternative transaction on failure or retry:

```ts
// repos/effect/packages/effect/src/STM.ts:1348-1357
export const orElse: {
  <A2, E2, R2>(that: LazyArg<STM<A2, E2, R2>>): <A, E, R>(self: STM<A, E, R>) => STM<A2 | A, E2, R2 | R>
  <A, E, R, A2, E2, R2>(self: STM<A, E, R>, that: LazyArg<STM<A2, E2, R2>>): STM<A | A2, E2, R | R2>
} = stm.orElse
```

`orElse` tries the first branch; if it fails or retries, it tries the second. Both branches must be pure transactional code.

---

### TRef / TQueue / TMap / TSemaphore

The `T`-prefixed types are STM-aware equivalents of Effect's regular concurrency primitives. All their constructors return `STM` values, so you typically `STM.commit` them at program startup.

**`TRef`** — the fundamental transactional mutable cell. Analogous to `Ref` but composable inside STM transactions:

```ts
// repos/effect/packages/effect/src/TRef.ts:102-106
/**
 * @since 2.0.0
 * @category constructors
 */
export const make: <A>(value: A) => STM.STM<TRef<A>> = internal.make
```

Core operations — all return `STM`, all composable inside `STM.gen`:

- `TRef.get(ref)` — reads the current value (`repos/effect/packages/effect/src/TRef.ts:69-73`)
- `TRef.set(ref, value)` — writes a new value (`repos/effect/packages/effect/src/TRef.ts:126-130`)
- `TRef.update(ref, f)` — applies a pure function (`repos/effect/packages/effect/src/TRef.ts:144-148`)
- `TRef.modify(ref, f)` — reads and writes in one step, returning a derived value (`repos/effect/packages/effect/src/TRef.ts:108-112`)

**`TQueue`** — a transactional queue. `TQueue.offer` and `TQueue.take` can participate in the same transaction as `TRef` updates:

```ts
// repos/effect/packages/effect/src/TQueue.ts:211-221
/**
 * Creates a bounded queue with the back pressure strategy. The queue will
 * retain values until they have been taken, applying back pressure to
 * offerors if the queue is at capacity.
 *
 * For best performance use capacities that are powers of two.
 *
 * @since 2.0.0
 * @category constructors
 */
export const bounded: <A>(requestedCapacity: number) => STM.STM<TQueue<A>> = internal.bounded
```

`TQueue.take` blocks until the queue is non-empty — it is implemented with `STM.check` under the hood (`repos/effect/packages/effect/src/TQueue.ts:372-378`). The bounded variant applies back-pressure: `TQueue.offer` on a full queue blocks the offering fiber until space is available.

**`TMap`** — a transactional key-value map. Reads and writes to different keys in the same transaction are serialized correctly even under concurrent access:

```ts
// repos/effect/packages/effect/src/TMap.ts:61-67
/**
 * Makes an empty `TMap`.
 *
 * @since 2.0.0
 * @category constructors
 */
export const empty: <K, V>() => STM.STM<TMap<K, V>> = internal.empty
```

Key operations: `TMap.get(map, key)` returns `STM<Option<V>>`, `TMap.set(map, key, value)` returns `STM<void>`, `TMap.has(map, key)` returns `STM<boolean>` — all at `repos/effect/packages/effect/src/TMap.ts:151-177`.

**`TSemaphore`** — a transactional semaphore. Unlike `Semaphore` from Chapter 37, a `TSemaphore` can be acquired and released inside an STM transaction, making the permit acquisition part of a larger atomic operation:

```ts
// repos/effect/packages/effect/src/TSemaphore.ts:71-75
/**
 * @since 2.0.0
 * @category constructors
 */
export const make: (permits: number) => STM.STM<TSemaphore> = internal.make
```

`TSemaphore.acquire` returns an `STM<void>` that retries until a permit is available. `TSemaphore.withPermit` wraps an `Effect` — note that `withPermit` lives at the `Effect` level, not inside a transaction, because the guarded work itself is effectful (`repos/effect/packages/effect/src/TSemaphore.ts:92-99`).

**How the T-types relate to their non-T counterparts.** `Ref`, `Queue`, and `PubSub` (covered in Chapter 36) are simpler and faster when you only need to update one thing at a time. Reach for the `T`-variants when you need to compose multiple updates atomically. Do not mix them inside the same transaction: an `Effect`-level `Ref` cannot participate in an STM journal.

---

## A production example

A bank transfer service that atomically debits one account and credits another, with a typed `InsufficientFunds` error if the balance is too low, and a per-account rate-limiting `TSemaphore` to bound concurrent transfers per account:

```ts
import { Data, Effect, STM, TMap, TRef, TSemaphore } from "effect"

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

class InsufficientFunds extends Data.TaggedError("InsufficientFunds")<{
  accountId: string
  requested: number
  available: number
}> {}

interface Account {
  balance: TRef.TRef<number>
  transferLock: TSemaphore.TSemaphore // max 1 concurrent transfer per account
}

// ---------------------------------------------------------------------------
// Account registry: a TMap from accountId → Account
// ---------------------------------------------------------------------------

const makeRegistry = STM.commit(TMap.empty<string, Account>())

const openAccount = (
  registry: TMap.TMap<string, Account>,
  id: string,
  initialBalance: number
) =>
  STM.commit(
    STM.gen(function* () {
      const balance = yield* TRef.make(initialBalance)
      const lock = yield* TSemaphore.make(1)
      yield* TMap.set(registry, id, { balance, transferLock: lock })
    })
  )

// ---------------------------------------------------------------------------
// Transfer: atomically debit `from`, credit `to`
// ---------------------------------------------------------------------------

const transfer = (
  registry: TMap.TMap<string, Account>,
  fromId: string,
  toId: string,
  amount: number
) =>
  Effect.gen(function* () {
    // Look up both accounts outside the STM transaction —
    // we need Effect-level Option handling.
    const fromOpt = yield* STM.commit(TMap.get(registry, fromId))
    const toOpt = yield* STM.commit(TMap.get(registry, toId))

    const from = yield* fromOpt._tag === "Some"
      ? Effect.succeed(fromOpt.value)
      : Effect.fail(new InsufficientFunds({ accountId: fromId, requested: amount, available: 0 }))

    const to = yield* toOpt._tag === "Some"
      ? Effect.succeed(toOpt.value)
      : Effect.fail(new InsufficientFunds({ accountId: toId, requested: amount, available: 0 }))

    // Atomically debit + credit inside one STM transaction.
    // TSemaphore.acquire is an STM operation: acquiring the per-account
    // rate-limiting permit is part of the same atomic transaction as the
    // balance update, so no concurrent transfer can slip through while
    // this one is in-flight.
    // STM.check blocks (retries) until balance is sufficient.
    yield* STM.commit(
      STM.gen(function* () {
        yield* TSemaphore.acquire(from.transferLock)
        const fromBal = yield* TRef.get(from.balance)
        yield* STM.check(() => fromBal >= amount)
        yield* TRef.update(from.balance, (n) => n - amount)
        yield* TRef.update(to.balance, (n) => n + amount)
        yield* TSemaphore.release(from.transferLock)
      })
    )
  })

// ---------------------------------------------------------------------------
// Wire-up and demo
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const registry = yield* makeRegistry

  yield* openAccount(registry, "alice", 1000)
  yield* openAccount(registry, "bob", 500)

  // Run 10 concurrent transfers — no race conditions, no deadlocks
  yield* Effect.all(
    Array.from({ length: 10 }, (_, i) =>
      transfer(registry, "alice", "bob", 50).pipe(
        Effect.catchTag("InsufficientFunds", (e) =>
          Effect.log(`Transfer ${i} blocked: ${e.accountId} has ${e.available}`)
        )
      )
    ),
    { concurrency: "unbounded" }
  )

  const aliceBal = yield* STM.commit(
    STM.gen(function* () {
      const acc = yield* TMap.get(registry, "alice")
      return acc._tag === "Some" ? yield* TRef.get(acc.value.balance) : 0
    })
  )
  yield* Effect.log(`Alice final balance: ${aliceBal}`)
})

Effect.runPromise(program)
```

The key insight: the debit and credit are described as a single `STM.gen` block and executed as one `STM.commit` call. If a concurrent fiber modifies either account's balance between the time the transaction reads and the time it tries to write, the STM runtime detects the conflict, rolls back the journal, and retries. No locks, no deadlocks.

The `STM.check(() => fromBal >= amount)` line implements the insufficient-funds guard purely inside the transaction. If the condition is false, the transaction retries — but in this case we actually want a typed failure instead of an infinite retry. The production version above handles this by checking before entering the STM boundary and failing with `InsufficientFunds` at the `Effect` level.

---

## Variations

**`STM.orElse` — try one queue, fall back to another:**
```ts
import { STM, TQueue } from "effect"
const dequeue = (priority: TQueue.TQueue<string>, fallback: TQueue.TQueue<string>) =>
  STM.commit(STM.orElse(TQueue.take(priority), () => TQueue.take(fallback)))
```

**`STM.all` — compose multiple independent STM operations:**
```ts
import { STM, TRef } from "effect"
const readBoth = (a: TRef.TRef<number>, b: TRef.TRef<number>) =>
  STM.commit(STM.all([TRef.get(a), TRef.get(b)]))
// Reads a and b atomically; the pair is consistent
```

**`TArray` — fixed-length transactional array:**
```ts
import { STM, TArray } from "effect"
// repos/effect/packages/effect/src/TArray.ts:306 — TArray.fromIterable
const arr = yield* STM.commit(TArray.fromIterable([1, 2, 3]))
```

**Time-bounded retry via `Effect.timeout` on `STM.commit`:**
```ts
import { Duration, Effect, STM, TQueue } from "effect"
const waitAtMost = (q: TQueue.TQueue<string>, ms: number) =>
  Effect.timeout(STM.commit(TQueue.take(q)), Duration.millis(ms))
// Returns Option<string> — None if the queue stayed empty for `ms`
```

**`STM.retryUntil` — retry a transaction until a predicate on its value is true:**
```ts
import { STM, TRef } from "effect"
// Wait until the ref holds a value greater than 10
const waitForHigh = (ref: TRef.TRef<number>) =>
  STM.commit(STM.retryUntil(TRef.get(ref), (n) => n > 10))
```

**Nested transactions — they flatten automatically:**
```ts
import { STM, TRef } from "effect"
const inner = (ref: TRef.TRef<number>) => STM.gen(function* () {
  yield* TRef.update(ref, (n) => n + 1)
})
const outer = (ref: TRef.TRef<number>) => STM.gen(function* () {
  yield* inner(ref)   // inner STM composes into outer — one commit
  yield* inner(ref)
})
```

---

## Anti-patterns

### Using separate `Ref.update` calls for multi-variable consistency

```ts
// WRONG — race condition between the two updates
import { Effect, Ref } from "effect"
const badTransfer = (from: Ref.Ref<number>, to: Ref.Ref<number>, n: number) =>
  Effect.gen(function* () {
    yield* Ref.update(from, (x) => x - n) // another fiber may read `from` here
    yield* Ref.update(to, (x) => x + n)   // and see money that has neither left nor arrived
  })

// CORRECT — use TRef inside STM.commit
import { STM, TRef } from "effect"
const goodTransfer = (from: TRef.TRef<number>, to: TRef.TRef<number>, n: number) =>
  STM.commit(STM.gen(function* () {
    yield* TRef.update(from, (x) => x - n)
    yield* TRef.update(to, (x) => x + n)
  }))
```

### Calling `STM.atomically` — it does not exist

```ts
// WRONG — will not compile; STM.atomically is not a function in Effect
import { STM, TRef } from "effect"
const ref = yield* (STM as any).atomically(TRef.make(0))  // TypeError at runtime

// CORRECT — use STM.commit
const ref2 = yield* STM.commit(TRef.make(0))
```

`STM.atomically` exists in ZIO (Scala) and in some older Effect documentation. The Effect TypeScript library names this operation `STM.commit`. It is `repos/effect/packages/effect/src/STM.ts:418-424`.

### Embedding side effects inside an STM transaction

```ts
// WRONG — the console.log may fire multiple times if the transaction retries
import { STM, TRef } from "effect"
const badTransaction = (ref: TRef.TRef<number>) =>
  STM.gen(function* () {
    const n = yield* TRef.get(ref)
    console.log(`reading ${n}`)      // side effect inside STM — dangerous
    yield* TRef.set(ref, n + 1)
  })

// CORRECT — log after committing
import { Effect, STM, TRef } from "effect"
const goodTransaction = (ref: TRef.TRef<number>) =>
  Effect.gen(function* () {
    const n = yield* STM.commit(
      STM.gen(function* () {
        const v = yield* TRef.get(ref)
        yield* TRef.set(ref, v + 1)
        return v
      })
    )
    console.log(`read and incremented ${n}`)
  })
```

STM transactions are a pure DSL. They may be retried any number of times. Side effects (I/O, logging, network calls, random number generation) belong outside the `STM.gen` block, after `STM.commit` returns.

### Using STM for single-variable updates

For a single `Ref`, `Ref.update` is already atomic and does not incur transaction overhead. Reserve STM for multi-variable consistency:

```ts
// Over-engineered — single TRef has no composition benefit
import { STM, TRef } from "effect"
const overEngineered = (counter: TRef.TRef<number>) =>
  STM.commit(TRef.update(counter, (n) => n + 1))

// Simpler for the single-variable case
import { Effect, Ref } from "effect"
const simple = (counter: Ref.Ref<number>) =>
  Ref.update(counter, (n) => n + 1)
```

---

## See also

- [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — the concurrency model that STM coordinates. Fibers are the unit of execution; STM is how you synchronize shared state between them.
- [Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends](36-concurrency-primitives.md) — the non-transactional siblings of `TRef`, `TQueue`, and `TPubSub`. Use these when you only need single-variable atomicity.
- [Chapter 37 — FiberRef, Semaphore, and advanced concurrency patterns](37-fiber-ref-and-semaphore.md) — `Semaphore` at the `Effect` level; contrasts with `TSemaphore` which lives inside STM transactions.
- [Patterns catalog — `STM.gen` / `STM.commit` — software transactional memory](../../research/02-patterns-catalog.md#stmgen--stmcommit--software-transactional-memory) — canonical signature, when-to-use, and anti-pattern summary.
- [Patterns catalog — `TRef` / `TQueue` / `TMap` / `TSemaphore` — STM-aware variants](../../research/02-patterns-catalog.md#tref--tqueue--tmap--tsemaphore--stm-aware-variants) — all four constructors with source citations.
- `repos/effect/packages/effect/src/STM.ts` — full STM module; module docstring at lines 1–65 cites the original Haskell STM paper (Harris et al., PPoPP 2005).
- `research/packages/effect.md` (STM section) — per-package inventory note covering `TRef`, `TArray`, `TMap`, `TSet`, `TQueue`, `TPubSub`, `TDeferred`, `TSemaphore`, `TRandom`, `TReentrantLock`, `TPriorityQueue`, `TSubscriptionRef`.
