# Chapter 34 — Schedule — declarative retry, repeat, and cron

> **Package(s):** `effect`
> **Patterns introduced:** [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](../../research/02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs), [`Schedule.jittered` / `compose` — combinators](../../research/02-patterns-catalog.md#schedulejittered--compose--combinators), [`Cron.parse` / `make` and `DateTime.now` / `make` / `format`](../../research/02-patterns-catalog.md#cronparse--make-and-datetimenow--make--format)
> **Reads from:** [Chapter 05 — `Effect.gen` and generator-based composition](../part-1-foundations/05-effect-gen.md), [Chapter 06 — Typed errors and the error channel](../part-1-foundations/06-typed-errors.md)
> **Reads into:** Chapter 35 (STM — software transactional memory), Chapter 52 (Part III — the eviction fiber in `effect-cache` is Schedule-driven)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Every production service eventually needs the same three time-based behaviours: retry failing operations with backoff, repeat healthy operations on a schedule, and run jobs at calendar-specified times. Plain TypeScript solves all three with ad-hoc imperative code, and all three solutions share the same family of problems.

Here is a typical HTTP retry loop:

```ts
// Plain TypeScript — no Effect
async function fetchWithRetry(url: string): Promise<Response> {
  let attempt = 0
  const maxAttempts = 5
  while (attempt < maxAttempts) {
    try {
      return await fetch(url)
    } catch (err) {
      attempt++
      if (attempt >= maxAttempts) throw err
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms …
      const delay = 100 * Math.pow(2, attempt)
      await new Promise((res) => setTimeout(res, delay))
    }
  }
  throw new Error("unreachable")
}
```

Six problems are packed into twelve lines. First, there is no jitter: every client that hits the same outage retries at identical intervals and produces a second thundering herd. Second, the backoff formula lives in application code where it is easy to change accidentally. Third, the retry logic is tangled inside the function body — you cannot reuse it for a different function without copy-pasting. Fourth, there is no distinction between transient errors (connection reset) and permanent errors (404) — the loop retries both. Fifth, `setTimeout`-based delays are not interruptible; if the caller cancels, the sleep runs to completion anyway. Sixth, there is no structured termination: `throw new Error("unreachable")` is a code smell that the type system cannot help with.

Calendar scheduling has its own variant of the problem:

```ts
import cron from "node-cron"

// Runs a callback on a cron schedule — outside Effect entirely
cron.schedule("0 3 * * *", async () => {
  try {
    await runDailyCleanup()
  } catch (err) {
    console.error("cleanup failed", err)
  }
})
```

The callback is isolated from the Effect runtime. Errors are caught and discarded with `console.error`. The job is not interruptible. Test code cannot substitute a synthetic clock. The cron expression is a magic string with no type safety.

`Schedule`, `Cron`, and `DateTime` replace all three patterns with a composable, typed, interruptible, and testable system.

---

## The minimal example

Chapter 05 introduced `Effect.retry` and `Effect.repeat` and showed them working with simple schedules. This chapter goes deeper — but the foundation is the same combinator, so we link back rather than re-derive it.

```ts
import { Effect, Schedule } from "effect"

// Declare the base policy once, reuse it everywhere.
const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(4))
)

// A failing effect: succeeds on the 3rd attempt.
let attempts = 0
const unstable = Effect.tryPromise({
  try: () => {
    attempts++
    if (attempts < 3) return Promise.reject(new Error("transient"))
    return Promise.resolve({ data: "ok" })
  },
  catch: (e) => new Error(String(e))
})

const program = unstable.pipe(Effect.retry(retryPolicy))

Effect.runPromise(program).then(console.log)
// => { data: 'ok' }  (after 2 retried waits, each jittered exponentially)
```

The `retryPolicy` is a value. It is separate from both the operation it retries and the call site that uses it. It composes `exponential` backoff (100 ms, 200 ms, 400 ms …) with `jittered` noise and a maximum of 4 recurrences via `compose(Schedule.recurs(4))`. The whole schedule is pinned at `repos/effect/packages/effect/src/Schedule.ts:988-1006` (`exponential`), `:1742-1757` (`spaced`), `:1604` (`recurs`), `:1212-1232` (`jittered`), `:510-533` (`compose`).

---

## Tour

### Pattern 1 — Constructor schedules: `spaced`, `exponential`, `fixed`, `recurs`

A `Schedule<Out, In, R>` is a value that answers one question at each step: given the current input of type `In`, should I continue, and if so, after how long? The three type parameters are:

- `Out` — the output produced by the schedule at each step (often a count or a `Duration`).
- `In` — the value consumed by the schedule at each step (an error when used with `Effect.retry`, a success value when used with `Effect.repeat`).
- `R` — additional service requirements (usually `never` for the built-in constructors).

The model is described in full at `repos/effect/packages/effect/src/Schedule.ts:47-94`.

**`Schedule.spaced(duration)`** waits `duration` from the end of the last execution before triggering again (`repos/effect/packages/effect/src/Schedule.ts:1742-1757`). The count starts at zero and increases by one each step. Use this for heartbeats and polling loops where the gap between runs matters more than the wall-clock alignment.

**`Schedule.fixed(interval)`** recurs on a fixed absolute interval (`repos/effect/packages/effect/src/Schedule.ts:1040-1049`). Unlike `spaced`, it measures from the start of the last execution, so the schedule stays wall-clock-aligned even if individual runs take time. Use it for tasks that must run "every 10 seconds" rather than "10 seconds after the last run ended".

**`Schedule.exponential(base, factor?)`** starts at `base` and multiplies by `factor` (default `2`) after each recurrence: `base, base*2, base*4, base*8, …` (`repos/effect/packages/effect/src/Schedule.ts:988-1006`). The output type is `Duration`, not a count. Use it for any network retry where you want progressive backoff.

**`Schedule.recurs(n)`** runs exactly `n` more times and then stops (`repos/effect/packages/effect/src/Schedule.ts:1596-1604`). It produces a count of recurrences. Used alone it retries immediately with no delay — useful in tests. Combined with a delay schedule via `compose`, it caps the total number of attempts.

```ts
import { Schedule, Effect } from "effect"

// Runs at most 5 times, no delay (test-friendly)
const finite: Schedule<number> = Schedule.recurs(5)

// Runs forever with 2-second gaps
const heartbeat: Schedule<number> = Schedule.spaced("2 seconds")

// Clock-aligned: every 60s regardless of run duration
const clockAligned: Schedule<number> = Schedule.fixed("1 minute")

// Doubles from 50ms: 50ms, 100ms, 200ms, 400ms …
const backoff: Schedule<Duration> = Schedule.exponential("50 millis")
```

(Type imports: `Duration` comes from `"effect"` via `import { Schedule, Duration, Effect } from "effect"`.)

### Pattern 2 — Combinator schedules: `jittered`, `compose`, `andThen`, `union`, `intersect`, `tapOutput`, `whileInput`, `untilInput`

Schedules compose. The combinators in this section transform or combine existing schedules to produce new ones, without touching the operations being scheduled.

**`Schedule.jittered`** (`repos/effect/packages/effect/src/Schedule.ts:1212-1232`) randomly adjusts each delay to between 80% and 120% of its nominal value. This prevents the thundering-herd problem: when many clients recover from the same outage simultaneously and all retry at identical exponential intervals, they produce a second wave of traffic. Jitter spreads the retries across time. Add it to every production retry schedule.

**`Schedule.compose(a, b)`** (`repos/effect/packages/effect/src/Schedule.ts:510-533`) pipes the output of schedule `a` as the input of schedule `b`. The canonical use is capping an exponential schedule: `Schedule.exponential` produces `Duration` values; `Schedule.recurs` consumes `unknown` inputs (it ignores them) and produces a count. Composing them gives a schedule that backs off exponentially AND stops after N steps.

```ts
import { Schedule } from "effect"

// Exponential backoff, jittered, capped at 5 retries
const standard = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5))
)
```

**`Schedule.andThen(a, b)`** (`repos/effect/packages/effect/src/Schedule.ts:229-257`) runs `a` to exhaustion and then switches to `b`. Both schedules must accept compatible inputs. This is useful for a two-phase policy: retry fast at first, then switch to a slow fallback. The output type is `Out | Out2` (the union).

**`Schedule.union(a, b)`** (`repos/effect/packages/effect/src/Schedule.ts:1846-1876`) continues as long as at least one schedule wants to continue, selecting the shorter delay. Use it when you want "either condition is enough to keep going".

**`Schedule.intersect(a, b)`** (`repos/effect/packages/effect/src/Schedule.ts:1155-1179`) continues only when both schedules agree, selecting the longer delay. Use it for "both conditions must hold": for example, retry for at most 5 times AND for at most 30 seconds.

```ts
import { Schedule } from "effect"

// Retry up to 5 times OR up to 30 seconds, whichever comes first
const cappedByBoth = Schedule.intersect(
  Schedule.recurs(5),
  Schedule.upTo("30 seconds")
)
```

**`Schedule.tapOutput(f)`** (`repos/effect/packages/effect/src/Schedule.ts:1815-1829`) runs an effectful side action after each schedule step without altering the schedule's behaviour. Use it to emit a metric or log each retry attempt.

**`Schedule.whileInput(predicate)`** (`repos/effect/packages/effect/src/Schedule.ts:2025-2043`) continues only as long as the predicate returns `true` for the input. When used with `Effect.retry`, the input is the error value, so you can gate retries on error type.

**`Schedule.untilInput(predicate)`** (`repos/effect/packages/effect/src/Schedule.ts:1909-1932`) is the mirror: it stops as soon as the predicate returns `true`. Both combinators are critical for the retry-by-error-tag pattern: Chapter 06 showed how `Data.TaggedError` gives you discriminated errors; `whileInput` lets you act on that discrimination inside the schedule.

```ts
import { Schedule, Data, Effect } from "effect"

class NetworkError extends Data.TaggedError("NetworkError")<{}> {}
class AuthError extends Data.TaggedError("AuthError")<{}> {}

// Only retry NetworkError — never retry AuthError
const selectiveRetry = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5)),
  Schedule.whileInput((err: NetworkError | AuthError) => err._tag === "NetworkError")
)
```

### Pattern 3 — Cron and DateTime: `Cron.parse`, `Cron.make`, `Schedule.cron`, `DateTime.now`, `DateTime.format`

For calendar-based scheduling — "run at 03:00 UTC every night" — Effect provides `Cron` and `DateTime`, both in the core `effect` package.

**`Cron.parse(expression, tz?)`** (`repos/effect/packages/effect/src/Cron.ts:293-302`) parses a standard five-or-six-field cron expression into a typed `Cron` value. It returns `Either<Cron, ParseError>`, so the failure is explicit and recoverable. The optional `tz` argument accepts a `DateTime.TimeZone` or an IANA timezone string, making the schedule time-zone-aware.

```ts
import { Cron, Either } from "effect"

// Five-field cron: minute hour day-of-month month day-of-week
const dailyCleanup = Cron.parse("0 3 * * *") // 03:00 UTC every day
const mondayMorning = Cron.parse("0 9 * * 1", "America/New_York") // 09:00 ET on Mondays

if (Either.isLeft(dailyCleanup)) {
  console.error("bad expression:", dailyCleanup.left.message)
}
```

**`Cron.make(fields)`** (`repos/effect/packages/effect/src/Cron.ts:138-144`) builds a `Cron` value from typed field iterables instead of a string. Use it when the schedule is computed at runtime or when you want to avoid parse errors entirely.

**`Schedule.cron(cron)`** (`repos/effect/packages/effect/src/Schedule.ts:631-644`) converts a `Cron` value into a `Schedule<[number, number]>` that fires at each matching moment. The two-element tuple output is `[startMillis, endMillis]` of the cron window.

**`DateTime.now`** (`repos/effect/packages/effect/src/DateTime.ts:476-490`) is an `Effect<DateTime.Utc>` that reads the current time from Effect's `Clock` service. Unlike `new Date()`, it is deterministic in tests — provide `TestClock` and the time stays fixed until you advance it manually. Use `DateTime.now` inside any Effect that needs the current time.

**`DateTime.format(options?)`** (`repos/effect/packages/effect/src/DateTime.ts:1529-1545`) formats a `DateTime` value using the `Intl.DateTimeFormat` API, respecting the zone attached to the value.

```ts
import { DateTime, Effect } from "effect"

const logCurrentTime = Effect.gen(function* () {
  const now = yield* DateTime.now
  const label = DateTime.format(now, {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC"
  })
  yield* Effect.log(`current UTC time: ${label}`)
})
```

---

## A production example

This example assembles everything: an HTTP client with a selective exponential-backoff retry policy, telemetry tapped from the schedule, and a nightly cron job that runs separately. Both share the same Effect runtime.

```ts
import {
  Effect,
  Schedule,
  Data,
  Cron,
  DateTime,
  Either,
  Duration
} from "effect"

// ── Typed errors ──────────────────────────────────────────────────────────────

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly status: number
}> {}

class AuthError extends Data.TaggedError("AuthError")<{
  readonly reason: string
}> {}

type AppError = NetworkError | AuthError

// ── Retry policy ──────────────────────────────────────────────────────────────

// Only transient NetworkError is retried. AuthError is permanent.
// Schedule.whileInput gates on error tag (Chapter 06 typed errors).
// repos/effect/packages/effect/src/Schedule.ts:2025-2043  whileInput
// repos/effect/packages/effect/src/Schedule.ts:1212-1232  jittered
// repos/effect/packages/effect/src/Schedule.ts:510-533    compose
// repos/effect/packages/effect/src/Schedule.ts:1596-1604  recurs
// repos/effect/packages/effect/src/Schedule.ts:1815-1829  tapOutput
const httpRetryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(4)),
  Schedule.whileInput((err: AppError) => err._tag === "NetworkError"),
  Schedule.tapOutput((attempt) =>
    Effect.log(`retry attempt ${attempt} for HTTP request`)
  )
)

// ── HTTP client effect ────────────────────────────────────────────────────────

declare function rawFetch(url: string): Promise<{ status: number; body: string }>

const fetchResource = (url: string): Effect.Effect<string, AppError> =>
  Effect.tryPromise({
    try: () => rawFetch(url),
    catch: () => new NetworkError({ status: 0 })
  }).pipe(
    Effect.flatMap((res) => {
      if (res.status === 401)
        return Effect.fail(new AuthError({ reason: "unauthorized" }))
      if (res.status >= 500)
        return Effect.fail(new NetworkError({ status: res.status }))
      return Effect.succeed(res.body)
    })
  )

// Wrap with the retry policy. Effect.retry is introduced in Chapter 05.
const resilientFetch = (url: string) =>
  fetchResource(url).pipe(Effect.retry(httpRetryPolicy))

// ── Cron-driven nightly job ───────────────────────────────────────────────────

// repos/effect/packages/effect/src/Cron.ts:293-302   parse
// repos/effect/packages/effect/src/Schedule.ts:631-644  cron
const cleanupCron = Cron.parse("0 3 * * *") // 03:00 UTC daily

const dailyCleanupJob: Effect.Effect<void, never> = Either.match(cleanupCron, {
  onLeft: (err) => Effect.die(new Error(`invalid cron: ${err.message}`)),
  onRight: (cronValue) =>
    Effect.repeat(
      Effect.gen(function* () {
        // repos/effect/packages/effect/src/DateTime.ts:476-490  now
        const now = yield* DateTime.now
        // repos/effect/packages/effect/src/DateTime.ts:1529-1545  format
        const label = DateTime.format(now, { dateStyle: "short", timeStyle: "short" })
        yield* Effect.log(`[${label}] running nightly cleanup`)
        // ... real cleanup work here
      }),
      Schedule.cron(cronValue)
    )
})

// ── Entry point ───────────────────────────────────────────────────────────────

const main = Effect.gen(function* () {
  yield* Effect.fork(dailyCleanupJob)          // background fiber
  const body = yield* resilientFetch("https://api.example.com/data")
  yield* Effect.log(`got response: ${body.slice(0, 80)}`)
})

Effect.runPromise(main)
```

Key points in this example:

- `httpRetryPolicy` is a first-class value defined once and reused for all HTTP calls.
- `Schedule.whileInput` filters the schedule so that `AuthError` is never retried — the error propagates immediately. This is the intersection of Chapter 06's typed errors with the Schedule system.
- `Schedule.tapOutput` emits a log line at each retry step without modifying the schedule's output type or timing.
- The cron schedule is parsed eagerly with `Cron.parse`, which returns `Either`. A bad expression fails at startup rather than silently at the first scheduled run.
- `DateTime.now` inside the cleanup job reads from Effect's `Clock` service, making the timestamp reproducible in tests using `TestClock`.
- The cleanup fiber is forked with `Effect.fork` so it runs concurrently with the main business logic. See Chapter 17 for the fiber lifecycle.

---

## Variations

**Finite repetition with `Schedule.recurs`** — run exactly N times, no delay:

```ts
import { Effect, Schedule } from "effect"
const thrice = Effect.repeat(Effect.log("tick"), Schedule.recurs(3))
```

**Two-phase backoff with `Schedule.andThen`** — retry fast first, then slow:

```ts
import { Schedule } from "effect"
// repos/effect/packages/effect/src/Schedule.ts:229-257  andThen
const twoPhase = Schedule.recurs(3).pipe(
  Schedule.andThen(Schedule.spaced("30 seconds").pipe(Schedule.compose(Schedule.recurs(5))))
)
```

**Windowed schedule with `Schedule.windowed`** — divide time into windows of fixed width:

```ts
import { Schedule } from "effect"
// repos/effect/packages/effect/src/Schedule.ts:2113-2138  windowed
const windowed = Schedule.windowed("10 seconds")
// Produces recurrence count; each window is 10 seconds from the origin.
```

**Collect all outputs** — gather every schedule output into a `Chunk`:

```ts
import { Effect, Schedule } from "effect"
// repos/effect/packages/effect/src/Schedule.ts:444  collectAllOutputs
const collected = Effect.repeat(
  Effect.succeed(42),
  Schedule.spaced("1 second").pipe(
    Schedule.compose(Schedule.recurs(3)),
    Schedule.collectAllOutputs
  )
)
// Effect<Chunk<number>>  — outputs: [0, 1, 2, 3]
```

**Identity schedule** — passes each input through as output, runs indefinitely:

```ts
import { Schedule } from "effect"
// repos/effect/packages/effect/src/Schedule.ts:1127-1134  identity
const passThrough = Schedule.identity<string>()
// Schedule<string, string>
```

**Telemetry tap with `tapOutput`** — increment a metric counter on each retry:

```ts
import { Schedule, Metric, Effect } from "effect"
const retryCounter = Metric.counter("retry_count")
const instrumented = Schedule.exponential("200 millis").pipe(
  Schedule.tapOutput(() => Metric.increment(retryCounter))
)
```

---

## Anti-patterns

**Manual sleep loops instead of Schedule**

```ts
// Wrong: imperative, not interruptible, not composable
async function retryManually<T>(fn: () => Promise<T>, times: number): Promise<T> {
  for (let i = 0; i < times; i++) {
    try { return await fn() } catch {
      await new Promise((res) => setTimeout(res, 100 * Math.pow(2, i)))
    }
  }
  throw new Error("max retries exceeded")
}

// Correct: declarative, interruptible, composable
import { Effect, Schedule } from "effect"
const withRetry = <A, E>(eff: Effect.Effect<A, E>) =>
  eff.pipe(
    Effect.retry(Schedule.exponential("100 millis").pipe(
      Schedule.jittered,
      Schedule.compose(Schedule.recurs(5))
    ))
  )
```

**`setTimeout` or `setInterval` for recurring work**

```ts
// Wrong: callback is outside the Effect runtime — errors are untyped,
// the job is not interruptible, TestClock cannot control its timing.
setInterval(() => { runSync() }, 5000)

// Correct: use Effect.repeat with Schedule.spaced
import { Effect, Schedule } from "effect"
const recurring = Effect.repeat(
  Effect.sync(() => runSync()),
  Schedule.spaced("5 seconds")
)
```

**No jitter on production retries**

```ts
// Wrong: every client retries at exactly the same intervals —
// thundering herd recreated after every outage
const noJitter = Schedule.exponential("200 millis").pipe(Schedule.compose(Schedule.recurs(5)))

// Correct: add Schedule.jittered to spread retries
// repos/effect/packages/effect/src/Schedule.ts:1212-1232
const withJitter = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5))
)
```

**Retrying permanent errors with no `whileInput` guard**

```ts
// Wrong: AuthError and NetworkError are both retried — wasteful and wrong
const unguarded = Schedule.exponential("100 millis").pipe(Schedule.compose(Schedule.recurs(5)))

// Correct: gate retries on error kind — Chapter 06 typed errors + Schedule
// repos/effect/packages/effect/src/Schedule.ts:2025-2043
import { Schedule, Data } from "effect"
class NetworkError extends Data.TaggedError("NetworkError")<{}> {}
class AuthError extends Data.TaggedError("AuthError")<{}> {}
const guarded = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5)),
  Schedule.whileInput((e: NetworkError | AuthError) => e._tag === "NetworkError")
)
```

---

## See also

- [Chapter 05 — `Effect.gen` and generator-based composition](../part-1-foundations/05-effect-gen.md) — introduces `Effect.retry` and `Effect.repeat` (`:4400-4410`, `:10178-10192`); Schedule chapter deepens, does not re-derive.
- [Chapter 06 — Typed errors and the error channel](../part-1-foundations/06-typed-errors.md) — `Data.TaggedError` and `catchTag`; the `Schedule.whileInput` pattern relies on discriminated errors from Chapter 06.
- [Chapter 35 — STM — software transactional memory](35-stm.md) — the next chapter; STM `TRef` and `TQueue` compose naturally with Schedule-driven producer/consumer loops.
- [Chapter 52 — The second Layer: `Layer.scoped` for the eviction fiber](../part-3-authoring/52-layer-scoped-eviction.md) — Part III worked example (`effect-cache`): the TTL eviction loop is driven by `Schedule.spaced`, showing Schedule in a real production Layer.
- [Patterns Catalog — `Schedule.spaced` / `exponential` / `fixed` / `recurs`](../../research/02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) — constructor signatures, when-to-use, anti-pattern summary.
- [Patterns Catalog — `Schedule.jittered` / `compose` — combinators](../../research/02-patterns-catalog.md#schedulejittered--compose--combinators) — combinator signatures and thundering-herd rationale.
- [Patterns Catalog — `Cron.parse` / `make` and `DateTime.now` / `make` / `format`](../../research/02-patterns-catalog.md#cronparse--make-and-datetimenow--make--format) — cron + DateTime signatures, time-zone guidance, TestClock integration.
- [Per-package note — `effect`](../../research/packages/effect.md) — full Schedule section (`repos/effect/packages/effect/src/Schedule.ts:47-88`), `Cron` and `DateTime` module listings.
- [Chapter 41 — Stream deep-dive](41-stream-deep-dive.md) — `Stream.fromSchedule` turns any `Schedule` into a stream of ticks; the bridge between the two systems.
