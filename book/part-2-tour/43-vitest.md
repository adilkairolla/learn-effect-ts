# Chapter 43 — Testing Effect programs with @effect/vitest

> **Package(s):** `@effect/vitest`
> **Patterns introduced:** [Runtime — pre-built runtime for executing Effects](../../research/02-patterns-catalog.md#runtime--pre-built-runtime-for-executing-effects), [RuntimeFlags — concurrency, tracing, interruption controls](../../research/02-patterns-catalog.md#runtimeflags--concurrency-tracing-interruption-controls)
> **Reads from:** [Chapter 03 — Running Effects](../part-1-foundations/03-running-effects.md), [Chapter 09 — Layer](../part-1-foundations/09-layer.md), [Chapter 10 — Layer.scoped and Scope](../part-1-foundations/10-layer-scoped-and-scope.md), [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md)
> **Reads into:** Part III worked-example chapters (all integration tests use `it.effect` / `it.scoped` / `it.live`)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Testing an Effect program with vanilla Vitest is possible but produces a steady stream of small annoyances that compound as the test suite grows.

The first issue is boilerplate. Every test that touches Effect must call `Effect.runPromise` explicitly and wire up any required services by hand:

```ts
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { Database, DatabaseLive } from "./Database.js"

describe("UserService", () => {
  it("creates a user", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function*() {
        const db = yield* Database
        return yield* db.createUser({ name: "Alice" })
      }).pipe(Effect.provide(DatabaseLive))
    )
    expect(result.name).toBe("Alice")
  })

  it("rejects duplicate emails", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function*() {
          const db = yield* Database
          yield* db.createUser({ name: "Alice", email: "a@x.com" })
          return yield* db.createUser({ name: "Alice2", email: "a@x.com" })
        }).pipe(Effect.provide(DatabaseLive))
      )
    ).rejects.toThrow()
  })
})
```

This works, but three things are wrong. First, `DatabaseLive` is rebuilt from scratch for every `it()` call — connection pool torn down, reconnected, re-migrated. For ten tests that is ten connection pools. Second, the test has no access to `TestClock`. Any effect that calls `Effect.sleep` or `Clock.sleep` will hit the real system clock, so "sleep 1 hour then retry" tests either time out or require manually mocking Date. Third, fiber cleanup is not guaranteed. If the test times out, Vitest's `async` wrapper cancels the Promise at the JavaScript boundary but the Effect fiber may still be running, holding resources.

The deeper issue is that `Effect.runPromise` runs an Effect in isolation. It has no TestContext, no deterministic clock, no deterministic random, and no fiber-aware teardown. The test passes or fails at the boundary between the JavaScript promise and the Effect runtime, which means error messages strip the Effect Cause tree down to a raw `Error` before Vitest's reporter sees it.

`@effect/vitest` solves all of this by inverting the ownership: the test runner, not the test author, provides `TestContext`. The package re-exports the entire Vitest namespace (`repos/effect/packages/vitest/src/index.ts:17`), so a single import line replaces `vitest` entirely and adds Effect-aware `it` variants that accept `Effect.Effect` return values directly.

---

## The minimal example

```ts
import { expect } from "@effect/vitest"
import { it } from "@effect/vitest"
import { Effect, TestClock } from "effect"

it.effect("delayed value is available after clock advance", () =>
  Effect.gen(function*() {
    let triggered = false

    const fiber = yield* Effect.fork(
      Effect.sleep("5 seconds").pipe(Effect.andThen(Effect.sync(() => { triggered = true })))
    )

    // The TestClock starts frozen. Nothing has elapsed yet.
    expect(triggered).toBe(false)

    // Advance the virtual clock by 5 seconds — the sleeping fiber wakes.
    yield* TestClock.adjust("5 seconds")
    yield* fiber

    expect(triggered).toBe(true)
  })
)
```

`it.effect` accepts a zero-argument function returning `Effect.Effect<void, E, TestServices>`. The harness provides `TestContext` (which includes `TestClock`, `TestRandom`, `TestConsole`, and `TestConfig`) before the test body runs. No `Effect.runPromise`, no manual `provide`, no real wall-clock waiting.

---

## Tour

### The four test runners

`@effect/vitest` exposes four variants of `it`, each differing only in what environment it injects. All four are produced by the same `makeTester` factory (`repos/effect/packages/vitest/src/internal/internal.ts:86-158`), which wraps a Vitest `it` call and runs the test body through a `mapEffect` pipeline before execution.

**`it.effect`** injects `TestContext` plus removes the default logger (`repos/effect/packages/vitest/src/internal/internal.ts:62-64`, `297`):

```ts
const TestEnv = TestContext.TestContext.pipe(
  Layer.provide(Logger.remove(Logger.defaultLogger))
)
// it.effect is: makeTester(Effect.provide(TestEnv), it)
```

`TestContext` is the test-aware implementation of `Clock`, `Random`, `Console`, and `Config`. The clock starts frozen at epoch zero. Any `Effect.sleep` or `Clock.sleep` call inside the test body suspends the fiber until `TestClock.adjust` or `TestClock.setTime` is called explicitly. Logger removal keeps test output clean by default — opt back in by providing `Logger.pretty` or switching to `it.live`.

**`it.scoped`** is `it.effect` with an automatic `Effect.scoped` wrapper (`repos/effect/packages/vitest/src/internal/internal.ts:298`). Use it when the test body yields resources that implement `acquireRelease` — the scope closes when the test finishes, whether by success, failure, or timeout. This is the right choice for any test that opens a database connection, starts a server, or acquires a lock. Chapter 10 covers `Effect.scoped` and `Scope` in detail.

**`it.live`** runs with no injected environment at all (`repos/effect/packages/vitest/src/internal/internal.ts:299`). The real system clock is in scope, logs are emitted, and randomness is non-deterministic. Use `it.live` only for integration tests that genuinely need wall-clock time — for example, testing that an HTTP client correctly follows a `Retry-After` header. If you use `it.live` for a test that calls `Effect.sleep`, that test will wait for real time.

**`it.scopedLive`** combines `it.live` with `Effect.scoped` (`repos/effect/packages/vitest/src/internal/internal.ts:300`). This is for integration tests that acquire real resources and need real time.

All four expose the full Vitest modifier chain — `.skip`, `.only`, `.skipIf(condition)`, `.runIf(condition)`, `.each(cases)`, and `.fails` — via the same `Object.assign` pattern as Vitest's own `it` (`repos/effect/packages/vitest/src/internal/internal.ts:158`).

### `expect.fail` and TaggedError

Effect's `TaggedError` (from Chapter 06) carries a `_tag` discriminant and typed fields. Inside `it.effect` or `it.scoped`, the test body is an Effect generator, so you can `yield*` a failing effect and catch the typed error directly:

```ts
import { it, expect } from "@effect/vitest"
import { Effect, Data } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}

const findUser = (id: string): Effect.Effect<string, NotFound> =>
  id === "admin"
    ? Effect.succeed("Administrator")
    : Effect.fail(new NotFound({ id }))

it.effect("TaggedError carries typed fields", () =>
  Effect.gen(function*() {
    const exit = yield* Effect.exit(findUser("ghost"))
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const err = exit.cause
      // Cause.failureOption gives the typed error back
      expect(err._tag).toBe("Fail")
    }
  })
)
```

For tests that should fail with a specific error type, `Effect.flip` is idiomatic:

```ts
it.effect("missing user yields NotFound", () =>
  Effect.gen(function*() {
    const err = yield* Effect.flip(findUser("unknown"))
    expect(err._tag).toBe("NotFound")
    expect(err.id).toBe("unknown")
  })
)
```

### TestClock for time-controlled tests

`TestClock.adjust` advances the virtual clock by a duration, which releases all fibers sleeping until that point or earlier (`repos/effect/packages/effect/src/TestClock.ts:38-82`). The `TestClock` interface exposes three operations:

- `adjust(duration)` — advance the clock by an offset from now
- `setTime(epochMs)` — jump the clock to an absolute epoch timestamp
- `sleeps` — inspect the list of pending sleep deadlines (useful for asserting that a fiber is waiting)

The canonical pattern is fork-adjust-join:

```ts
import { it, expect } from "@effect/vitest"
import { Effect, TestClock, Fiber, Option } from "effect"

it.effect("Effect.timeout cancels after the right interval", () =>
  Effect.gen(function*() {
    const fiber = yield* Effect.fork(
      Effect.sleep("1 minute").pipe(Effect.timeout("30 seconds"))
    )

    // Advance past the timeout threshold.
    yield* TestClock.adjust("30 seconds")

    const result = yield* Fiber.join(fiber)
    expect(result).toStrictEqual(Option.none())
  })
)
```

Without `TestClock`, this test would block for 30 real seconds (or forever, because `it.effect`'s default timeout would fire first). With `TestClock.adjust`, the entire test runs in microseconds.

### Runtime: the pre-built runtime per test

`it.effect` uses a fresh runtime for every invocation. Internally, `makeTester` applies `mapEffect` to the test body and runs the resulting Effect through `runPromise` (`repos/effect/packages/vitest/src/internal/internal.ts:59`), which calls `Effect.runPromise` on a fully-provided, context-free Effect. This means each test gets its own `TestClock` state (always starting at epoch zero), its own `TestRandom` seed, and its own fiber tree — no bleed between tests.

The `Runtime` type represents this pre-built execution context (`repos/effect/packages/effect/src/Runtime.ts:40-53`):

```ts
export interface Runtime<in R> extends Pipeable {
  readonly context: Context.Context<R>
  readonly runtimeFlags: RuntimeFlags.RuntimeFlags
  readonly fiberRefs: FiberRefs.FiberRefs
}
```

`Runtime.defaultRuntime` (`repos/effect/packages/effect/src/Runtime.ts:205`) is the baseline runtime with no services in context. Every `Effect.runPromise(effect)` call at the top level uses it. For `it.effect`, the harness creates a runtime that includes `TestContext` — your test body executes inside that enriched runtime without any explicit `Effect.provide` call.

When you use `it.layer` (described below), the harness calls `Layer.toRuntimeWithMemoMap` once and caches the resulting `Runtime` for every test in the suite. This is the pattern from the patterns catalog: a pre-built runtime carrying your application services, reused across calls, avoiding per-call layer reconstruction.

### RuntimeFlags: the runtime control surface

`RuntimeFlags` is a bitset that controls low-level runtime behaviors (`repos/effect/packages/effect/src/RuntimeFlags.ts:19-21`). The available flags are:

- `Interruption` — whether the scheduler will deliver interruption signals to fibers (`repos/effect/packages/effect/src/RuntimeFlags.ts:48-49`)
- `OpSupervision` — enables per-operation supervision for profiling (`repos/effect/packages/effect/src/RuntimeFlags.ts:59-60`)
- `RuntimeMetrics` — enables fiber-level metrics collection (`repos/effect/packages/effect/src/RuntimeFlags.ts:72`)
- `WindDown` — fibers complete their execution even after receiving an interrupt (`repos/effect/packages/effect/src/RuntimeFlags.ts:83`)
- `CooperativeYielding` — the runtime yields to other fibers cooperatively (`repos/effect/packages/effect/src/RuntimeFlags.ts:91-92`)

In test code you almost never construct or modify `RuntimeFlags` directly. The defaults (interruption enabled, supervision disabled) are appropriate for all `it.effect` tests. The one testing-relevant consequence is that `it.effect` gets fiber interruption for free: when a test times out, Vitest's `onTestFinished` hook fires `Fiber.interrupt` on the running test fiber, which the runtime honors because `Interruption` is enabled (`repos/effect/packages/vitest/src/internal/internal.ts:33-36`). Finalizers registered via `Effect.addFinalizer` or `Effect.acquireRelease` run during the interrupt, so cleanup is guaranteed even on timeout.

`it.live` is the practical way to "change runtime behavior" in tests: by skipping `TestContext`, you get a runtime whose clock service maps to the real system clock rather than the frozen test clock. You are not changing `RuntimeFlags`, but you are changing what services the runtime carries.

### `it.layer` for shared service setup

When many tests share the same services, `it.layer` builds the layer once and provides a context-local `it` to the callback. This avoids rebuilding the layer for every test:

```ts
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Database, DatabaseLive } from "./Database.js"

it.layer(DatabaseLive)("user suite", (it) => {
  it.effect("reads a user", () =>
    Effect.gen(function*() {
      const db = yield* Database
      // ...
    })
  )

  it.effect("creates a user", () =>
    Effect.gen(function*() {
      const db = yield* Database
      // ...
    })
  )
})
```

The layer is built once in `beforeAll` and the scope is closed in `afterAll` (`repos/effect/packages/vitest/src/internal/internal.ts:253-274`). Every `it.effect` call in the callback receives the pre-built runtime from `Layer.toRuntimeWithMemoMap` (`repos/effect/packages/vitest/src/internal/internal.ts:219-223`). `TestContext` is merged automatically; pass `{ excludeTestServices: true }` only when you intentionally want a live-only runtime.

### `it.flakyTest` for retry-aware tests

`flakyTest` wraps an Effect in a retry schedule: up to 10 retries while total elapsed time is within the timeout (default 30 seconds) (`repos/effect/packages/vitest/src/internal/internal.ts:278-292`). It is intended for genuinely non-deterministic effects such as polling-based assertions, port-availability checks, or external service liveness probes — not for tests that should be deterministic:

```ts
import { it, flakyTest } from "@effect/vitest"
import { Effect } from "effect"

it.live("port eventually becomes available", () =>
  flakyTest(
    Effect.gen(function*() {
      // check TCP port is open
    }),
    "10 seconds"
  )
)
```

`flakyTest` uses `Schedule.recurs(10)` composed with `Schedule.elapsed` and `Schedule.whileOutput(Duration.lessThanOrEqualTo(timeout))`. If all retries are exhausted, `Effect.orDie` converts the last failure into a defect, which surfaces as an unhandled exception in Vitest's reporter.

---

## A production example

The following shows a realistic test file for a caching service that issues retries with exponential back-off. The service has a `TaggedError`, the layer is shared across tests with `it.layer`, and time-sensitive behavior is validated with `TestClock.adjust`.

```ts
import { it, expect } from "@effect/vitest"
import {
  Context,
  Data,
  Duration,
  Effect,
  Fiber,
  Layer,
  Schedule,
  TestClock
} from "effect"

// --- Service definition ---

class FetchError extends Data.TaggedError("FetchError")<{
  url: string
  status: number
}> {}

interface FetchService {
  readonly fetch: (url: string) => Effect.Effect<string, FetchError>
}

const FetchService = Context.GenericTag<FetchService>("FetchService")

// --- Test double: fails the first call, succeeds on the second ---

const makeFlakyFetch = Effect.gen(function*() {
  let calls = 0
  const fetch = (url: string): Effect.Effect<string, FetchError> =>
    Effect.suspend(() => {
      calls += 1
      if (calls === 1) return Effect.fail(new FetchError({ url, status: 503 }))
      return Effect.succeed(`response from ${url}`)
    })
  return { fetch } satisfies FetchService
})

const FlakyFetchLive = Layer.effect(FetchService, makeFlakyFetch)

// --- Service under test: retries once after 2 seconds ---

const fetchWithRetry = (url: string) =>
  FetchService.pipe(
    Effect.flatMap((svc) => svc.fetch(url)),
    Effect.retry(
      Schedule.exponential("2 seconds").pipe(Schedule.intersect(Schedule.recurs(1)))
    )
  )

// --- Tests ---

it.layer(FlakyFetchLive)("fetchWithRetry", (it) => {
  it.effect("succeeds on the second attempt", () =>
    Effect.gen(function*() {
      // Fork so we can advance the clock while the retry is sleeping.
      const fiber = yield* Effect.fork(fetchWithRetry("https://api.example.com/data"))

      // First attempt fires immediately. The retry is now sleeping for 2 seconds.
      // Advance clock to release it.
      yield* TestClock.adjust("2 seconds")

      const result = yield* Fiber.join(fiber)
      expect(result).toBe("response from https://api.example.com/data")
    })
  )

  it.effect("propagates FetchError when retries are exhausted", () =>
    Effect.gen(function*() {
      // A service that always fails.
      const alwaysFail: FetchService = {
        fetch: (url) => Effect.fail(new FetchError({ url, status: 500 }))
      }
      const err = yield* Effect.flip(
        fetchWithRetry("https://api.example.com/broken").pipe(
          Effect.provide(Layer.succeed(FetchService, alwaysFail))
        )
      )
      expect(err._tag).toBe("FetchError")
      expect(err.status).toBe(500)
    })
  )

  it.scoped("FetchService resource is released on scope close", () =>
    Effect.gen(function*() {
      // Demonstrate that it.scoped wraps the body in Effect.scoped.
      const svc = yield* FetchService
      const result = yield* svc.fetch("https://api.example.com/ok").pipe(
        Effect.retry(Schedule.recurs(1))
      )
      expect(result).toContain("response")
    })
  )

  it.live("real-time smoke test: fetch completes within 5 s", () =>
    Effect.gen(function*() {
      // This variant uses the live clock — only for genuine integration checks.
      const svc = yield* FetchService
      const result = yield* Effect.timeout(
        svc.fetch("https://api.example.com/ok"),
        Duration.seconds(5)
      )
      expect(result._tag).not.toBe("None")
    })
  )
})
```

Key points: `it.layer(FlakyFetchLive)` builds the layer once and closes the scope after all tests run. The `it.effect` tests use `TestClock` so no real time elapses. `it.scoped` demonstrates that `acquireRelease` resources tied to `Scope` are cleaned up at test end. `it.live` is labeled explicitly to signal intent and appears at the bottom of the suite, separate from the deterministic tests.

---

## Variations

**`it.effect.only` to focus on a single test during development:**

```ts
it.effect.only("just this one", () => Effect.gen(function*() { /* ... */ }))
```

**`it.effect.skip` to suppress a test without deleting it:**

```ts
it.effect.skip("known broken: issue #42", () => Effect.gen(function*() { /* ... */ }))
```

**`it.effect.each` for table-driven tests:**

```ts
it.effect.each([
  { input: "admin", expected: "Administrator" },
  { input: "guest", expected: "Guest" }
])("resolves role for $input", ({ input, expected }) =>
  Effect.gen(function*() {
    const role = yield* resolveRole(input)
    expect(role).toBe(expected)
  })
)
```

**`addEqualityTesters()` in `setupFiles` for structural Effect equality:**

```ts
// vitest.setup.ts
import { addEqualityTesters } from "@effect/vitest"
addEqualityTesters()
// Now expect(Option.some(1)).toEqual(Option.some(1)) uses Equal.equals
// instead of reference equality — refs: repos/effect/packages/vitest/src/internal/internal.ts:67-79
```

**`Effect.tap` for mid-test debug logging:**

```ts
it.live("debug intermediate value", () =>
  Effect.gen(function*() {
    const result = yield* computeExpensiveThing().pipe(
      Effect.tap((v) => Effect.logDebug("intermediate", v))
    )
    expect(result).toBeDefined()
  })
)
```

**Nested `it.layer` for composable service stacks:**

```ts
it.layer(DatabaseLive)((it) => {
  it.layer(UserServiceLive)("UserService suite", (it) => {
    it.effect("reads user", () => Effect.gen(function*() { /* ... */ }))
  })
})
```

---

## Anti-patterns

**Plain `it()` with `Effect.runPromise` — loses TestClock and fiber cleanup:**

```ts
// Wrong: no TestClock, no fiber interrupt on timeout, layer rebuilt every test.
it("computes value", async () => {
  const result = await Effect.runPromise(
    myEffect.pipe(Effect.provide(MyLayer))
  )
  expect(result).toBe(42)
})

// Correct: TestContext injected, fiber interrupted on timeout.
it.effect("computes value", () =>
  Effect.gen(function*() {
    const result = yield* myEffect
    expect(result).toBe(42)
  })
)
```

**Using `it.live` for time-sensitive unit tests — tests become slow and non-deterministic:**

```ts
// Wrong: waits for 30 real seconds.
it.live("retries after delay", () =>
  Effect.gen(function*() {
    const fiber = yield* Effect.fork(retryingEffect)
    yield* Effect.sleep("30 seconds")  // real sleep!
    yield* Fiber.join(fiber)
  })
)

// Correct: TestClock.adjust advances virtual time instantly.
it.effect("retries after delay", () =>
  Effect.gen(function*() {
    const fiber = yield* Effect.fork(retryingEffect)
    yield* TestClock.adjust("30 seconds")
    yield* Fiber.join(fiber)
  })
)
```

**Forgetting `it.scoped` for resource-acquiring tests — scope leaks on failure:**

```ts
// Wrong: if the assertion fails, the acquired resource is never released.
it.effect("uses a scoped resource", () =>
  Effect.gen(function*() {
    const conn = yield* acquireConnection  // acquireRelease resource
    const rows = yield* conn.query("SELECT 1")
    expect(rows.length).toBeGreaterThan(0)
  })
)

// Correct: Effect.scoped is applied, finalizer runs on success or failure.
it.scoped("uses a scoped resource", () =>
  Effect.gen(function*() {
    const conn = yield* acquireConnection
    const rows = yield* conn.query("SELECT 1")
    expect(rows.length).toBeGreaterThan(0)
  })
)
```

**Rebuilding the layer inside every test — expensive and prevents shared state tests:**

```ts
// Wrong: layer built and torn down 100 times for 100 tests.
it.effect("test N", () =>
  myEffect.pipe(Effect.provide(HeavyLayer))
)

// Correct: layer built once, shared runtime passed to all tests.
it.layer(HeavyLayer)("suite", (it) => {
  it.effect("test N", () => myEffect)
})
```

---

## See also

- [Chapter 03 — Running Effects](../part-1-foundations/03-running-effects.md) — `Effect.runPromise` is what `it.effect` calls internally after applying `mapEffect`; understanding the execution boundary helps reason about what happens at test edges.
- [Chapter 09 — Layer](../part-1-foundations/09-layer.md) — `it.layer` calls `Layer.toRuntimeWithMemoMap` and `Layer.provideMerge`; understanding layer composition explains how `TestContext` is merged with user layers.
- [Chapter 10 — Layer.scoped and Scope](../part-1-foundations/10-layer-scoped-and-scope.md) — `it.scoped` applies `Effect.scoped` to the test body; the Scope created by `it.layer` closes in `afterAll`; both behaviors are explained by Chapter 10's coverage of `acquireRelease` and `Scope.close`.
- [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — `TestClock.adjust` works by releasing fibers suspended on `Effect.sleep`; understanding the fork-adjust-join pattern requires knowing how `Effect.fork` creates child fibers.
- Part III worked-example chapters — all integration and unit tests in Part III use `it.effect`, `it.scoped`, `it.live`, and `it.layer` directly; Chapter 43 is the prerequisite for reading those test files.
- [Runtime — pre-built runtime for executing Effects](../../research/02-patterns-catalog.md#runtime--pre-built-runtime-for-executing-effects) — the patterns catalog entry explains when to use `Runtime` directly vs `ManagedRuntime`; `it.layer` demonstrates the same pattern in a test context.
- [RuntimeFlags — concurrency, tracing, interruption controls](../../research/02-patterns-catalog.md#runtimeflags--concurrency-tracing-interruption-controls) — the flags that govern fiber interruption, the mechanism that makes `onTestFinished` cleanup reliable.
- Per-package research note: `research/packages/vitest.md` — API surface details, open questions about `addEqualityTesters()` opt-in, and the `excludeTestServices` type gap.
