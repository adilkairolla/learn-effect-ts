# @effect/experimental

> Source: `repos/effect/packages/experimental/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: experimental
> Effect deps: `effect` (peer), `@effect/platform` (peer); optional peers: `ioredis ^5`, `lmdb ^3`

> **CHURN WARNING:** This package is the Effect team's incubator. APIs can break across **minor** versions without a deprecation period; modules that graduate may vanish entirely. Reference these APIs only with explicit hedges and pin the exact package version.

## What it does

`@effect/experimental` is the staging area for promising abstractions not yet ready for stability guarantees. Its residents span four problem spaces: actor-model state machines (`Machine`), a reactive invalidation bus (`Reactivity`), a durable event-sourcing / local-first sync stack (`EventJournal`, `EventLog`, and companions), and persistence utilities (`Persistence`, `PersistedCache`, `PersistedQueue`).

## Public API surface

Grouped by problem domain, not alphabetically.

### Actor model

- **`Machine`** — typed actor / FSM. Defines `Machine<State, Public, Private, Input, InitErr, R>`, `SerializableMachine`, and the `Actor` / `SerializableActor` handles. `boot` launches inside a `Scope`; `send` dispatches a `Schema.TaggedRequest`; `snapshot` / `restore` persist state across restarts; per-send OpenTelemetry spans are built in. `repos/effect/packages/experimental/src/Machine.ts:58–908`
- **`Machine.procedures`** (`ProcedureList`) — builder DSL for declaring public/private procedures, initial state, and identifier. `repos/effect/packages/experimental/src/Machine/ProcedureList.ts:1–80`
- **`Machine.serializable`** (`SerializableProcedureList`) — extends `ProcedureList` with `Schema`-encoded request dispatch for wire-format callers (used by `DevTools`). `repos/effect/packages/experimental/src/Machine/SerializableProcedureList.ts`

### Reactivity / live queries

- **`Reactivity`** — invalidation-driven live-query service. `mutation(keys, effect)` runs an effect then signals invalidation; `query(keys, effect)` returns a `Mailbox` that replays the effect on every invalidation; `stream` wraps it as a `Stream`. Keys are either a flat array or a `Record<string, id[]>` for entity-level granularity. `repos/effect/packages/experimental/src/Reactivity.ts:1–271`

### EventLog / local-first sync

- **`Event`** — schema wrapper for a typed event: `tag`, `primaryKey` extractor, `payload`/`success`/`error` schemas, and a MsgPack codec. `repos/effect/packages/experimental/src/Event.ts:1–60`
- **`EventGroup`** — groups `Event` definitions into a named collection consumed by `EventLog.schema`. `repos/effect/packages/experimental/src/EventGroup.ts`
- **`EventJournal`** — low-level append-only log. Service tag with `write`, `writeFromRemote`, `withRemoteUncommited`, and `changes` (`Queue.Dequeue`). Implementations: `layerMemory` and `layerIndexedDb`. Entry IDs are UUID v7 for chronological sort. `repos/effect/packages/experimental/src/EventJournal.ts:1–607`
- **`EventLog`** — typed handler layer over `EventJournal`. Builds a schema from `EventGroup` definitions, wires event handlers, and calls `Reactivity.invalidate` on each commit. `repos/effect/packages/experimental/src/EventLog.ts:1–80`
- **`EventLogEncryption`** — optional AES-GCM entry encryption via Web Crypto `SubtleCrypto`. `repos/effect/packages/experimental/src/EventLogEncryption.ts:1–50`
- **`EventLogRemote`** — client-side WebSocket sync. `RcMap`-pooled connections per identity; handles chunked reassembly and ACK/NACK. `repos/effect/packages/experimental/src/EventLogRemote.ts:1–50`
- **`EventLogServer`** — server-side WebSocket handler (`makeHandler`). `PubSub` for broadcast; `FiberMap` for per-connection fibers. `repos/effect/packages/experimental/src/EventLogServer.ts:1–50`

### Persistence

- **`Persistence`** — two-layer model: `BackingPersistence` (raw KV store; adapters for `KeyValueStore`, `ioredis`, `lmdb`) and `ResultPersistence` (typed `Exit`-aware store keyed by `PrimaryKey + Schema.WithResult`). Errors split into `PersistenceParseError` and `PersistenceBackingError`. `repos/effect/packages/experimental/src/Persistence.ts:1–218`
- **`PersistedCache`** — two-tier cache: in-memory `Cache` for hot values, `ResultPersistence` for cold rehydration. `make({ storeId, lookup, timeToLive })`. `repos/effect/packages/experimental/src/PersistedCache.ts:1–60`
- **`PersistedQueue`** — durable at-least-once queue. `offer` is idempotent by id; `take(f, { maxAttempts })` retries `f` on failure (default 10 attempts). `repos/effect/packages/experimental/src/PersistedQueue.ts:1–60`

### Networking / utilities

- **`RateLimiter`** — `fixed-window` or `token-bucket` limiter backed by `RateLimiterStore`. `consume({ key, window, limit, algorithm, onExceeded })` returns `ConsumeResult` or fails with `RateLimitExceeded`. `repos/effect/packages/experimental/src/RateLimiter.ts:1–80`
- **`RequestResolver`** — `dataLoader` combinator: buffers requests arriving within a `window` into a single batch. `repos/effect/packages/experimental/src/RequestResolver.ts:1–60`
- **`Sse`** — SSE parser as an Effect `Channel`. `makeChannel` reads text chunks and emits typed `Event` / `Retry` values. `repos/effect/packages/experimental/src/Sse.ts:1–50`
- **`DevTools`** — WebSocket tracer layer. `layer(url)` forwards Effect spans to the DevTools app (default `ws://localhost:34437`). `repos/effect/packages/experimental/src/DevTools.ts:1–31`
- **`VariantSchema`** — multi-variant schema helper. Declare a `Struct` of `Field` definitions with per-field variant membership; call `extract(variant)` to derive a fully-typed `Schema` for each shape (e.g. "create" vs "read"). `repos/effect/packages/experimental/src/VariantSchema.ts:1–80`

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `Machine`, `Reactivity`, `PersistedQueue`, and `RateLimiter` are all instantiated via a `make` effect, not a class constructor.
- [`Layer.succeed` / `effect` / `scoped`](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layerMemory`, `layerIndexedDb`, `Reactivity.layer`, `DevTools.layer` all use `Layer.effect` or `Layer.scoped`.
- [`Context.GenericTag` / `Tag` class](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `EventJournal`, `Reactivity`, `BackingPersistence`, `ResultPersistence` use `Context.Tag`. `repos/effect/packages/experimental/src/EventJournal.ts:19–81`, `repos/effect/packages/experimental/src/Persistence.ts:124–128`.
- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — used in `Machine.boot`, `Reactivity.make`, `EventJournal.makeMemory` for sequential Effect programs.
- [`Schema.Class` and `Schema.TaggedClass`](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — `MachineDefect`, `EventJournalError`, `Entry`, `RemoteEntry`, and all `EventLogRemote` protocol messages are `Schema.TaggedClass` / `Schema.TaggedError`. `repos/effect/packages/experimental/src/Machine.ts:138–150`, `repos/effect/packages/experimental/src/EventJournal.ts:99–109`.
- [`FiberSet` / `FiberMap` / `FiberHandle`](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `Machine.boot` uses `FiberSet` for fire-and-forget forks and `FiberMap` for named replaceable forks; both are joined so defects surface to the actor loop. `repos/effect/packages/experimental/src/Machine.ts:602–784`.
- [`Mailbox`](../02-patterns-catalog.md#mailbox--ordered-message-inbox) — `Reactivity.query` pushes re-evaluated results into a `Mailbox` on each invalidation. `repos/effect/packages/experimental/src/Reactivity.ts:90–129`.
- [`RcRef` and `RcMap`](../02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources) — `EventLogRemote` uses `RcMap` to pool WebSocket connections per identity. `repos/effect/packages/experimental/src/EventLogRemote.ts:1–50`.
- [Dual data-first / data-last](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `Machine.retry`, `Reactivity.mutation`, `Reactivity.query`, and `RequestResolver.dataLoader` all use `dual(2, ...)`. `repos/effect/packages/experimental/src/Machine.ts:429–443`.
- [`Effect.acquireRelease` / `acquireUseRelease`](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `EventJournal.write` commits the journal entry only if the caller's effect succeeds. `repos/effect/packages/experimental/src/EventJournal.ts:248–270`.
- [`Request.of` / `RequestResolver.make`](../02-patterns-catalog.md#requestof--requestresolvermaker--effectrequest--request-batching) — `PersistedCache` and `RequestResolver.dataLoader` extend the `RequestResolver` pattern with persistence and time-window batching.
- [RateLimiter](../02-patterns-catalog.md#ratelimiter--token-bucket-rate-limiting) — the `RateLimiter` module is the incubating implementation for the pattern documented in the catalog.

## What's unique about this package's design

`Machine` is the only place in the monorepo that fuses an actor request loop, distributed tracing, `FiberSet`/`FiberMap` supervision, and schema-encoded serialization into one primitive. The structural description lives in `ProcedureList` (a plain data object); execution is entirely in `boot`, so machines can be passed around, decorated, and tested without launching a fiber. `repos/effect/packages/experimental/src/Machine.ts:319–337`. `sendUnknown` decodes raw `unknown` and re-encodes the `Exit`, letting the same actor serve both TypeScript and wire-format callers. `repos/effect/packages/experimental/src/Machine.ts:580–592`.

`EventJournal` is the only local-first sync architecture in the monorepo. UUID v7 IDs (`repos/effect/packages/experimental/src/EventJournal.ts:157–159`) sort chronologically; `writeFromRemote` delegates conflict resolution to a caller-supplied `compact` callback (`repos/effect/packages/experimental/src/EventJournal.ts:44–56`); `EventLogEncryption` plugs in transparently.

## Conventions observed

**Error shape:** Service errors uniformly carry `method: string` and `cause: unknown` / `Schema.Defect` — compare `EventJournalError` (`repos/effect/packages/experimental/src/EventJournal.ts:99–109`) and `PersistenceBackingError` (`repos/effect/packages/experimental/src/Persistence.ts:62–77`). This is a local convention not in `03-conventions.md`.

**TypeId duality:** `Machine` uses `Symbol.for(...)` on a `unique symbol` (monorepo standard); `PersistedQueue` and `RateLimiter` use the string-literal form `"~@effect/experimental/..."`. Both work, neither is documented as canonical. `repos/effect/packages/experimental/src/Machine.ts:58–64`, `repos/effect/packages/experimental/src/PersistedQueue.ts:17–23`.

**Optional peers:** `ioredis` and `lmdb` are `peerDependenciesMeta.optional: true` (`repos/effect/packages/experimental/package.json:57–64`). Their-dependent modules fail at runtime if the peer is missing, not at import time.

## "If you were authoring something similar, copy this"

- **`acquireUseRelease` for write-then-record atomicity:** `EventJournal.write` creates the entry, runs the caller's effect, then commits only on success. `repos/effect/packages/experimental/src/EventJournal.ts:248–270`
- **`FiberSet` + `FiberMap` for supervised forks inside a service loop:** `Machine.boot` joins both alongside the request loop so defects in background fibers kill the actor cleanly. `repos/effect/packages/experimental/src/Machine.ts:779–806`
- **Description / execution split:** `Machine.make` returns a plain data object; `boot` does all the work. This makes the machine a composable value. `repos/effect/packages/experimental/src/Machine.ts:319–337`
- **Caller-controlled merge via optional callback:** `writeFromRemote`'s `compact?` option keeps the primitive policy-free. `repos/effect/packages/experimental/src/EventJournal.ts:44–56`

## Open questions

1. **`Machine` graduation:** Tracing, serialization, and retry are all present. Is there a milestone for promotion to `effect` core or `@effect/actor`, and what API surface would change?
2. **`VariantSchema` vs `Schema.Struct` + `pick`:** Unclear whether this is the team's canonical approach for multi-variant domain objects or a stop-gap.
3. **`RateLimiterStore` implementations:** The file was truncated before the in-memory and Redis store constructors. Are they in `RateLimiter.ts` or a separate unexported module?
4. **`EventLog` handler timing:** Handlers integrate with `Reactivity.invalidate`, but it is not clear whether they run in the committing fiber or on a fork, and what failure behavior is.
5. **`Sse` + `HttpClient` composition:** `makeChannel` is a raw `Channel`; there is no shown path to compose it with `@effect/platform`'s `HttpClient` for a standard EventSource subscription.
