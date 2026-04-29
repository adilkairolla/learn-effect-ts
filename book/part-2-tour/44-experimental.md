# Chapter 44 — Experimental patterns — Machine, PersistedCache, EventLog

> **Package(s):** `@effect/experimental`
> **Patterns introduced:** [SynchronizedRef — atomic effectful update](../../research/02-patterns-catalog.md#synchronizedref--atomic-effectful-update), [SubscriptionRef — observable Ref](../../research/02-patterns-catalog.md#subscriptionref--observable-ref), [RateLimiter — token-bucket rate limiting](../../research/02-patterns-catalog.md#ratelimiter--token-bucket-rate-limiting)
> **Reads from:** [Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends](36-concurrency-primitives.md), [Chapter 39 — Match — exhaustive pattern matching](39-match.md), [Chapter 26 — SQL part 2 — drivers](26-sql-drivers.md)
> **Reads into:** nothing — this is the final Part II chapter
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

> **WARNING — `@experimental` package:** Everything in `@effect/experimental` sits in the team's incubator. APIs can break across **minor** versions without a deprecation period, and entire modules may graduate out or vanish. Use these APIs with explicit version pinning and hedge any production use accordingly. This chapter names the package explicitly throughout rather than implying stability.

---

## The problem

Three recurring coordination problems appear in serious TypeScript services that the core `effect` library does not fully address out of the box.

**Hand-rolled state machines.** A connection manager, an order workflow, a WebSocket session — they all have named states with typed transitions between them. The idiomatic plain-TypeScript approach is a `switch` on a discriminated union (or a series of `if`/`else` branches), but nothing enforces that every state handles every message, nothing serializes state across restarts, and nothing surfaces background defects back to the caller:

```ts
// Plain TypeScript — hand-rolled FSM, no exhaustiveness, no serialization
type ConnState = "disconnected" | "connecting" | "connected" | "failed"

let state: ConnState = "disconnected"
const inbox: Array<{ type: string }> = []

async function dispatch(msg: { type: string }) {
  if (state === "disconnected" && msg.type === "Connect") {
    state = "connecting"
    await doConnect()   // What if this throws? state is stuck at "connecting".
    state = "connected"
  } else if (state === "connected" && msg.type === "Disconnect") {
    state = "disconnected"
  }
  // No compile-time check that every state handles every message type.
  // No recovery if the background task panics.
  // No way to snapshot / restore state across a process restart.
}
```

**In-memory caches that lose data on restart.** `effect`'s `Cache.make` from Chapter 26 is excellent for deduplication and TTL, but it is pure in-memory. Any cache entry that represents an expensive computation (a compiled query plan, an API token, a resolved DNS record) evaporates when the process restarts. Rebuilding it on every boot adds latency and hammers downstream services.

**Bolted-on audit trails.** Event sourcing — writing an immutable log of every state change and deriving the current view from that log — is a powerful pattern for local-first apps, sync, and auditing. In plain TypeScript it requires manually wiring a write-ahead log, a reader, conflict resolution, and an optional remote sync channel. The parts rarely compose cleanly.

---

## The minimal example

> This example uses `@effect/experimental`, which is **not stable**. Pin `"@effect/experimental": "0.x.x"` and treat the API as subject to change on minor bumps.

```ts
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Machine from "@effect/experimental/Machine"
import * as procedures from "@effect/experimental/Machine/ProcedureList"

// --- requests (typed messages sent to the actor) ---
class Increment extends Schema.TaggedRequest<Increment>()("Increment", {
  failure: Schema.Never,
  success: Schema.Number,
  payload: {}
}) {}

class Reset extends Schema.TaggedRequest<Reset>()("Reset", {
  failure: Schema.Never,
  success: Schema.Void,
  payload: {}
}) {}

// --- the machine description (a pure data value) ---
const CounterMachine = Machine.make(
  // initialize: returns a ProcedureList carrying the initial state
  Effect.gen(function* () {
    return procedures.make(0, { identifier: "Counter" }).pipe(
      // public procedure: Increment — returns new count
      procedures.add<Increment>()("Increment", ({ state }) =>
        Effect.succeed([state + 1, state + 1] as const)
      ),
      // public procedure: Reset — returns void, resets to 0
      procedures.add<Reset>()("Reset", () =>
        Effect.succeed([undefined, 0] as const)
      )
    )
  })
)

// --- boot and send ---
const program = Effect.scoped(
  Effect.gen(function* () {
    const actor = yield* Machine.boot(CounterMachine)
    const n1 = yield* actor.send(new Increment())   // 1
    const n2 = yield* actor.send(new Increment())   // 2
    yield* actor.send(new Reset())
    const n3 = yield* actor.send(new Increment())   // 1 again
    yield* Effect.log(`counts: ${n1}, ${n2}, ${n3}`)
  })
)
```

`Machine.boot` at `repos/effect/packages/experimental/src/Machine.ts:470–487` launches a long-lived fiber that owns the state and serializes every `send` through an unbounded `Queue`. The caller's fiber suspends until the procedure handler returns, making every send look like an ordinary effectful call.

---

## Tour

> All exports below come from `@effect/experimental`. The package is **`@experimental`**: treat every API here as potentially unstable across minor version bumps.

### Machine — typed actor / FSM

`Machine` is the `@effect/experimental` answer to stateful actor loops. The structural description — initial state, named procedures, identifier — lives in a `ProcedureList` (a plain data value). Execution is entirely deferred to `boot`, so the machine can be passed around, composed, and tested without launching a fiber.

**`Machine.make`** (`repos/effect/packages/experimental/src/Machine.ts:319–337`) accepts an `initialize` function that receives an optional input and an optional `previousState` (for replay after restart), and must return an `Effect<ProcedureList<State, Public, Private, R>>`. The result is a plain `Machine` record — no fiber is started:

```ts
export const make: {
  // overload 1: no input
  <State, Public, Private, InitErr, R>(
    initialize: Effect.Effect<ProcedureList<State, Public, Private, R>, InitErr, R>
  ): Machine<State, Public, Private, void, InitErr, ...>
  // overload 2: typed input
  <State, Public, Private, Input, InitErr, R>(
    initialize: Machine.Initialize<Input, State, Public, Private, R, InitErr, R>
  ): Machine<State, Public, Private, Input, InitErr, ...>
}
```

**`Machine.boot`** (`repos/effect/packages/experimental/src/Machine.ts:470–487`) launches the actor inside a `Scope`. It creates an unbounded `Queue` for requests, a `PubSub` for state updates, a `FiberSet` for fire-and-forget forks, and a `FiberMap` for named replaceable forks (`repos/effect/packages/experimental/src/Machine.ts:602–604`). All three are joined, so a defect in any background fiber surfaces as a `MachineDefect` to the actor loop rather than silently dying.

**`ProcedureList`** (`repos/effect/packages/experimental/src/Machine/ProcedureList.ts:60–68`) is the builder:

- `procedures.make(initialState, { identifier? })` — creates an empty list
- `procedures.add<Req>()("Tag", handler)` — appends a public procedure
- `procedures.addPrivate<Req>()("Tag", handler)` — appends a private procedure (internal sends only)

Each handler receives `{ request, state, send, fork, forkReplace, forkOne }` and must return `Effect<readonly [Reply, NextState]>`.

**`actor.send`** dispatches a tagged request and suspends until the handler returns the reply. Per-send OpenTelemetry spans are built in and can be toggled with `Machine.withTracingEnabled` (`repos/effect/packages/experimental/src/Machine.ts:458–464`).

**`Machine.makeSerializable`** adds a `Schema`-encoded request/reply path, enabling the same actor to serve both TypeScript and wire-format callers via `actor.sendUnknown` (`repos/effect/packages/experimental/src/Machine.ts:581–592`).

**`Machine.retry`** (`repos/effect/packages/experimental/src/Machine.ts:429–443`) attaches a `Schedule` to the `initialize` effect, restarting the machine on `InitErr` or `MachineDefect`.

The machine's type signature — `Machine<State, Public, Private, Input, InitErr, R>` — captures the full typed surface at compile time: state shape, legal messages, initialization error, and required environment.

> Note: `Machine` lives in `@effect/experimental`. The `Match` module (Chapter 39) is sometimes confused with it because both deal with discriminated dispatch, but `Match` is a pure utility in `effect` core. `Machine` builds its own tagged dispatch atop the `Request` protocol — it does not call `Match.value` internally.

### PersistedCache — SQL-backed two-tier cache

`PersistedCache` solves the "cache that survives restarts" problem by layering an in-memory `Cache` over a `ResultPersistence` store.

**`PersistedCache.make`** (`repos/effect/packages/experimental/src/PersistedCache.ts:47–57`) accepts:

```ts
export const make = <K extends ResultPersistence.KeyAny, R>(options: {
  readonly storeId: string
  readonly lookup: (key: K) => Effect.Effect<Schema.WithResult.Success<K>, Schema.WithResult.Failure<K>, R>
  readonly timeToLive: (...args: ResultPersistence.TimeToLiveArgs<K>) => Duration.DurationInput
  readonly inMemoryCapacity?: number   // default 64
  readonly inMemoryTTL?: DurationInput // default 10_000 ms
}): Effect.Effect<PersistedCache<K>, never, ... | ResultPersistence | Scope.Scope>
```

The returned `PersistedCache<K>` has two methods:

- `get(key)` — checks the in-memory `Cache` first; on a miss it checks `ResultPersistence`; on a second miss it calls `lookup`, stores the `Exit` in both tiers, and returns the result.
- `invalidate(key)` — removes the key from both the in-memory cache and the persistence store.

The cache key type `K` must satisfy `ResultPersistence.KeyAny` — a `Schema.WithResult`-encoded request. This binds the key's schema to its success/failure types, giving type-safe serialization for free.

**`ResultPersistence`** (`repos/effect/packages/experimental/src/Persistence.ts:146–152`) is the service interface for the cold tier. `BackingPersistence` (`repos/effect/packages/experimental/src/Persistence.ts:124–128`) is the raw KV store beneath it. Adapters exist for `KeyValueStore` (from `@effect/platform`), `ioredis`, and `lmdb` (the latter two are optional peers).

### EventLog — event-sourcing primitive

`EventLog` is the `@effect/experimental` local-first sync stack. It is more complex than `Machine` or `PersistedCache` and the API is younger — hedge it accordingly.

The building blocks:

- **`Event.ts`** — defines a single typed event: `tag`, `primaryKey` extractor, payload/success/error schemas, MsgPack codec.
- **`EventGroup.ts`** — groups `Event` definitions into a named collection.
- **`EventJournal`** — the append-only log service. Provides `write`, `writeFromRemote`, `changes` (a `Queue.Dequeue`), and `entries`. Entry IDs are UUID v7 for chronological sort.
- **`EventLog.schema`** (`repos/effect/packages/experimental/src/EventLog.ts:62–69`) — combines `EventGroup` instances into an `EventLogSchema`.
- **`EventLog.group`** (`repos/effect/packages/experimental/src/EventLog.ts:242–259`) — wires typed handler functions for each event in a group, returning a `Layer`.
- **`EventLog.makeClient`** (`repos/effect/packages/experimental/src/EventLog.ts:741–764`) — derives a typed write function from a schema.

The `EventLog` service tag (`repos/effect/packages/experimental/src/EventLog.ts:472–492`) exposes `write`, `entries`, `registerRemote`, `registerCompaction`, `registerReactivity`, and `destroy`.

Write semantics use `acquireUseRelease` for atomicity: the journal entry is created, the handler effect runs, and the entry is committed only if the handler succeeds (`repos/effect/packages/experimental/src/EventJournal.ts:248–270`). This ensures the log and the application state stay in sync.

For remote sync, `EventLogRemote` handles chunked WebSocket reassembly and `EventLogServer` manages per-connection fibers with `FiberMap`. Conflict resolution delegates to a caller-supplied `compact` callback, keeping the primitive policy-free.

### Reactivity — invalidation-driven live queries

`Reactivity` (`repos/effect/packages/experimental/src/Reactivity.ts:1–271`) is the `@effect/experimental` invalidation bus. It is the lightest primitive in the package:

```ts
// construction
export const make: Effect.Effect<Reactivity.Service>

// mutation: run an effect then signal invalidation on `keys`
mutation(keys, effect)

// query: re-run `effect` on every invalidation of `keys`, results in a Mailbox
query(keys, effect)
```

`EventLog` calls `reactivity.unsafeInvalidate` on every committed entry (`repos/effect/packages/experimental/src/EventLog.ts:598–604`), connecting the event journal to the live-query layer.

---

### SynchronizedRef — atomic effectful update

> **In core `effect`, not `@effect/experimental`.** `SynchronizedRef` is stable. This section introduces the pattern; the production example below shows it in context.

`SynchronizedRef` (`repos/effect/packages/effect/src/SynchronizedRef.ts:71`) extends `Ref` with one additional operation: `modifyEffect`. Where `Ref.modify` accepts a pure `(A) => [B, A]`, `modifyEffect` accepts `(A) => Effect<[B, A], E, R>`. The internal semaphore ensures no other fiber can observe the ref between the read and the write, even when the update effect yields to the scheduler.

```ts
import * as SynchronizedRef from "effect/SynchronizedRef"
import * as Effect from "effect/Effect"

// Wrong: Ref + manual Semaphore (see Chapter 36 anti-patterns)
// const v = yield* Ref.get(ref)
// const next = yield* expensiveLookup(v)  // another fiber can read here
// yield* Ref.set(ref, next)              // race condition

// Correct: SynchronizedRef.modifyEffect
const ref = yield* SynchronizedRef.make<string | null>(null)
const result = yield* SynchronizedRef.modifyEffect(ref, (current) =>
  current !== null
    ? Effect.succeed([current, current] as const)         // cache hit
    : Effect.map(fetchToken(), (token) => [token, token] as const)  // fetch + store atomically
)
```

`SynchronizedRef` is the right tool when the effectful update must be atomic — for example, lazy initialization of a connection or a cached token refresh. See the [pattern catalog entry](../../research/02-patterns-catalog.md#synchronizedref--atomic-effectful-update).

---

### SubscriptionRef — observable Ref

> **In core `effect`, not `@effect/experimental`.** `SubscriptionRef` is stable.

`SubscriptionRef` (`repos/effect/packages/effect/src/SubscriptionRef.ts:148`) is a `Ref` that also maintains a `PubSub` for change notifications. Its `changes` property is a `Stream<A>` that emits the current value and every subsequent update:

```ts
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Stream from "effect/Stream"
import * as Effect from "effect/Effect"

const program = Effect.scoped(Effect.gen(function* () {
  const countRef = yield* SubscriptionRef.make(0)

  // Observe all changes as a stream (Chapter 41)
  const watcher = yield* Stream.runForEach(
    countRef.changes,
    (n) => Effect.log(`count changed to ${n}`)
  ).pipe(Effect.fork)

  yield* SubscriptionRef.update(countRef, (n) => n + 1)  // logs "count changed to 1"
  yield* SubscriptionRef.update(countRef, (n) => n + 1)  // logs "count changed to 2"
}))
```

The anti-pattern this replaces is a `Ref` plus a `PubSub` kept in manual sync. `SubscriptionRef` performs the publish atomically with every update. See the [pattern catalog entry](../../research/02-patterns-catalog.md#subscriptionref--observable-ref) and Chapter 41 for `Stream` composition.

---

### RateLimiter — token-bucket rate limiting

Two distinct `RateLimiter` implementations exist in the monorepo. This section covers both.

**Core `effect/RateLimiter`** (`repos/effect/packages/effect/src/RateLimiter.ts:98`) is the stable, single-process limiter. It is a callable that wraps any effect:

```ts
import * as RateLimiter from "effect/RateLimiter"
import * as Effect from "effect/Effect"

const program = Effect.scoped(Effect.gen(function* () {
  const limiter = yield* RateLimiter.make({ limit: 10, interval: "1 seconds" })
  // Each call is delayed if necessary to stay within 10/s
  yield* limiter(callDownstreamApi())
}))
```

The `algorithm` option defaults to `"token-bucket"`, which spreads burst traffic smoothly. `"fixed-window"` allows full burst at the start of each window. Compose two limiters with `Function.compose(perSecondRL, perMinuteRL)`.

**`@effect/experimental/RateLimiter`** (`repos/effect/packages/experimental/src/RateLimiter.ts:50–57`) is the `@experimental` distributed variant, backed by a `RateLimiterStore` service. It is keyed — each call identifies itself with a `key` string — allowing a single service instance to enforce per-user or per-resource limits. It returns a `ConsumeResult` with `delay`, `remaining`, and `resetAfter` rather than transparently delaying. The `onExceeded: "delay" | "fail"` option controls whether the excess is queued or immediately rejected.

> Use core `effect/RateLimiter` for most production work. The experimental keyed variant is useful when limits must be enforced across multiple processes via a shared store (Redis/lmdb). See the [pattern catalog entry](../../research/02-patterns-catalog.md#ratelimiter--token-bucket-rate-limiting).

---

## A production example

This example shows a connection manager built with `@effect/experimental`. It is guided by the "copy this" patterns from `research/packages/experimental.md`.

> All `@effect/experimental` imports are **`@experimental`** and subject to API changes on minor bumps.

```ts
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as RateLimiter from "effect/RateLimiter"
import * as Stream from "effect/Stream"
import * as Machine from "@effect/experimental/Machine"
import * as procedures from "@effect/experimental/Machine/ProcedureList"
import * as PersistedCache from "@effect/experimental/PersistedCache"

// ---- requests ----

class Connect extends Schema.TaggedRequest<Connect>()("Connect", {
  failure: Schema.String,
  success: Schema.Struct({ host: Schema.String, connectedAt: Schema.Number }),
  payload: { host: Schema.String }
}) {}

class Disconnect extends Schema.TaggedRequest<Disconnect>()("Disconnect", {
  failure: Schema.Never,
  success: Schema.Void,
  payload: {}
}) {}

class Send extends Schema.TaggedRequest<Send>()("Send", {
  failure: Schema.String,
  success: Schema.Number,       // bytes written
  payload: { data: Schema.String }
}) {}

// ---- state ----

type ConnState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Active"; readonly host: string; readonly connectedAt: number }

// ---- active-connection count observable (SubscriptionRef — core, stable) ----

const makeActiveCount = SubscriptionRef.make(0)

// ---- cached connection metadata (PersistedCache — @experimental) ----

class MetaKey extends Schema.TaggedRequest<MetaKey>()("MetaKey", {
  failure: Schema.Never,
  success: Schema.Struct({ host: Schema.String, lastSeen: Schema.Number }),
  payload: { host: Schema.String }
}) {}

const makeMetaCache = PersistedCache.make({
  storeId: "conn-meta",
  lookup: (key: MetaKey) =>
    Effect.succeed({ host: key.host, lastSeen: Date.now() }),
  timeToLive: () => "5 minutes"
})

// ---- rate limiter for outbound sends (core RateLimiter — stable) ----

const makeSendLimiter = RateLimiter.make({ limit: 100, interval: "1 seconds" })

// ---- the Machine (@experimental) ----

const ConnectionMachine = Machine.make(
  Effect.gen(function* () {
    const activeCount = yield* makeActiveCount
    const metaCache = yield* makeMetaCache
    const sendLimiter = yield* makeSendLimiter

    return procedures.make<ConnState>({ _tag: "Idle" }, { identifier: "Connection" }).pipe(

      procedures.add<Connect>()("Connect", ({ request, state }) =>
        state._tag === "Active"
          ? Effect.succeed([
              { host: state.host, connectedAt: state.connectedAt },
              state
            ] as const)
          : Effect.gen(function* () {
              // store metadata in PersistedCache (survives restarts)
              yield* metaCache.get(new MetaKey({ host: request.host }))
              // update observable count (SubscriptionRef — stream-able)
              yield* SubscriptionRef.update(activeCount, (n) => n + 1)
              const connectedAt = Date.now()
              return [
                { host: request.host, connectedAt },
                { _tag: "Active" as const, host: request.host, connectedAt }
              ] as const
            })
      ),

      procedures.add<Disconnect>()("Disconnect", ({ state }) =>
        state._tag === "Active"
          ? Effect.map(
              SubscriptionRef.update(activeCount, (n) => Math.max(0, n - 1)),
              () => [undefined, { _tag: "Idle" as const }] as const
            )
          : Effect.succeed([undefined, state] as const)
      ),

      procedures.add<Send>()("Send", ({ request, state }) =>
        state._tag !== "Active"
          ? Effect.fail("not connected")
          : sendLimiter(
              Effect.succeed(request.data.length)
            )
      )
    )
  })
)

// ---- wire up and run ----

const program = Effect.scoped(
  Effect.gen(function* () {
    const actor = yield* Machine.boot(ConnectionMachine)

    // Watch active count stream from another fiber
    yield* Stream.runForEach(
      (yield* SubscriptionRef.make(0)).changes,
      (n) => Effect.log(`active connections: ${n}`)
    ).pipe(Effect.fork)

    const info = yield* actor.send(new Connect({ host: "db.example.com" }))
    yield* Effect.log(`connected to ${info.host}`)

    const bytes = yield* actor.send(new Send({ data: "SELECT 1" }))
    yield* Effect.log(`sent ${bytes} bytes`)

    yield* actor.send(new Disconnect())
  })
)
```

Points of composition with Part I patterns:

- `SubscriptionRef.make` (Chapter 36) provides an observable active-connection counter whose `.changes` stream can drive a metrics dashboard without polling.
- `RateLimiter.make` (this chapter, core) transparently paces outbound sends — the `Send` handler just calls `sendLimiter(effect)`.
- `PersistedCache.make` (this chapter, `@experimental`) stores connection metadata in a two-tier cache; the hot tier lives in memory while the cold tier survives restarts via `ResultPersistence`.
- `Machine.boot` (this chapter, `@experimental`) owns all mutable state inside a supervised actor loop; no `let` variables escape the fiber.

---

## Variations

**Machine with a retry policy on init failure.** Attach a `Schedule` via `Machine.retry` to restart the machine after a transient initialization error:

```ts
import * as Schedule from "effect/Schedule"
const ResilientMachine = Machine.retry(ConnectionMachine, Schedule.exponential("500 millis").pipe(
  Schedule.upTo("30 seconds")
))
```

**PersistedCache with a Redis backing store.** Swap the in-process `KeyValueStore` for an `ioredis`-backed adapter (optional peer dependency):

```ts
import * as Persistence from "@effect/experimental/Persistence"
// Layer.provide(Persistence.layerResultRedis(ioredisClient))
// The PersistedCache.make call is unchanged; only the Layer differs.
```

**EventLog replay for local-first state reconstruction.** Retrieve all journal entries and replay them through the handler pipeline:

```ts
import * as EventLog from "@effect/experimental/EventLog"
// Inside a Layer or Effect:
const log = yield* EventLog.EventLog
const allEntries = yield* log.entries  // ReadonlyArray<Entry>
yield* Effect.log(`${allEntries.length} events in log`)
```

**Reactivity stream merging across multiple mutation keys.** Register a query that re-runs on invalidation of any key in a set:

```ts
import * as Reactivity from "@effect/experimental/Reactivity"
const reactivity = yield* Reactivity.Reactivity
// query re-fires whenever "users" or "sessions" invalidates
const mailbox = yield* reactivity.query(["users", "sessions"], computeView)
```

**SubscriptionRef as a config hot-reload signal.** Use `SubscriptionRef.changes` (Chapter 41, `Stream`) to propagate new config values to running fibers without restarts:

```ts
const configRef = yield* SubscriptionRef.make(initialConfig)
yield* Stream.runForEach(configRef.changes, applyConfig).pipe(Effect.fork)
// Writer side (config loader):
yield* SubscriptionRef.set(configRef, newConfig)
```

**Composing two RateLimiters for dual constraints.** The core `RateLimiter` is a function, so function composition applies:

```ts
import { compose } from "effect/Function"
const bothLimits = compose(perSecondLimiter, perMinuteLimiter)
yield* bothLimits(callApi())
```

---

## Anti-patterns

**Using `Ref` where `SynchronizedRef` is needed — the read/update race.**

```ts
// WRONG — another fiber can update the ref between get and set
const token = yield* Ref.get(tokenRef)
const refreshed = yield* refreshToken(token)   // yields here
yield* Ref.set(tokenRef, refreshed)            // last writer wins

// CORRECT — modifyEffect is atomic
yield* SynchronizedRef.modifyEffect(tokenRef, (current) =>
  Effect.map(refreshToken(current), (next) => [next, next] as const)
)
```

`modifyEffect` holds the internal semaphore for the entire duration of the effectful update, preventing any interleaving. See the [SynchronizedRef pattern entry](../../research/02-patterns-catalog.md#synchronizedref--atomic-effectful-update) and Chapter 36 for the foundational `Ref` discussion.

**Using an in-memory cache for data that must survive restarts.**

```ts
// WRONG — all cached values are lost on process restart
import * as Cache from "effect/Cache"
const tokenCache = yield* Cache.make({ lookup: fetchApiToken, capacity: 100, timeToLive: "1 hour" })

// CORRECT (for production persistence) — use PersistedCache from @effect/experimental
// (with the @experimental hedge and version pin)
import * as PersistedCache from "@effect/experimental/PersistedCache"
const tokenCache = yield* PersistedCache.make({
  storeId: "api-tokens",
  lookup: fetchApiToken,
  timeToLive: () => "1 hour"
})
```

**Skipping rate limiting on external API calls.**

```ts
// WRONG — 1000 concurrent fibers each calling the API at full speed
yield* Effect.forEach(requests, callExternalApi, { concurrency: "unbounded" })

// CORRECT — single RateLimiter instance shared across all concurrent callers
const limiter = yield* RateLimiter.make({ limit: 100, interval: "1 seconds" })
yield* Effect.forEach(requests, (r) => limiter(callExternalApi(r)), { concurrency: "unbounded" })
```

Rate limiting only the _start_ of each effect (not its duration) means concurrent long-running calls are fine — the limiter just controls the launch rate. See the [RateLimiter pattern entry](../../research/02-patterns-catalog.md#ratelimiter--token-bucket-rate-limiting).

**Sharing a single `RateLimiter` across all users when per-user limits are required.**

```ts
// WRONG — single limiter pools budget across all users
const sharedLimiter = yield* RateLimiter.make({ limit: 10, interval: "1 seconds" })

// CORRECT for per-user limits — use RcMap (Chapter 36) to create one limiter per user
import * as RcMap from "effect/RcMap"
const limiters = yield* RcMap.make({
  lookup: (_userId: string) => RateLimiter.make({ limit: 10, interval: "1 seconds" }),
  idleTimeToLive: "5 minutes"
})
const userLimiter = yield* RcMap.get(limiters, userId)
yield* userLimiter(callApi())
```

---

## See also

- **Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends** — foundational reading for `SynchronizedRef` and `SubscriptionRef`; `Machine.boot` uses `Queue` and `PubSub` internally.
- **Chapter 39 — Match — exhaustive pattern matching** — the `Match` module is sometimes conflated with `Machine`; this chapter clarifies the distinction. Match is a pure dispatch utility in core `effect`; `Machine` is a stateful actor in `@effect/experimental`.
- **Chapter 26 — SQL part 2 — drivers** — `PersistedCache` relies on `ResultPersistence`, which in turn can sit on any SQL driver from Chapter 26 via `@effect/sql` adapters.
- **Chapter 25 — SQL part 1 — the `@effect/sql` abstraction layer** — the `BackingPersistence` and `ResultPersistence` service interfaces follow the same tag-and-layer convention as `SqlClient`.
- **Chapter 41 — Stream deep-dive** — `SubscriptionRef.changes` is a `Stream<A>`; Chapter 41 covers all the `Stream` combinators for transforming, debouncing, and merging those change streams.
- **[SynchronizedRef — atomic effectful update](../../research/02-patterns-catalog.md#synchronizedref--atomic-effectful-update)** — full pattern entry with the manual-semaphore anti-pattern it replaces.
- **[SubscriptionRef — observable Ref](../../research/02-patterns-catalog.md#subscriptionref--observable-ref)** — full pattern entry with the Ref-plus-PubSub anti-pattern.
- **[RateLimiter — token-bucket rate limiting](../../research/02-patterns-catalog.md#ratelimiter--token-bucket-rate-limiting)** — full pattern entry covering both core and experimental variants.
- **`research/packages/experimental.md`** — per-package deep-dive: actor model, EventJournal atomicity, FiberSet supervision, and open questions about graduation milestones.
- **[Chapter 37 — FiberRef, Semaphore, and advanced concurrency](../part-1-foundations/37-fiber-ref-and-semaphore.md)** — `SynchronizedRef`'s internal semaphore connects to the `Semaphore` discussion in Chapter 37; `Machine.boot`'s `FiberSet`/`FiberMap` usage extends the supervised-fork patterns from that chapter.
