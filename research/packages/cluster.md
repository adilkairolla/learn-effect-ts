# @effect/cluster

> Source: `repos/effect/packages/cluster/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/rpc`, `@effect/sql`, `@effect/workflow`

## What it does

`@effect/cluster` is a distributed-systems runtime for Effect applications. It provides consistent-hash sharding of named entities across a fleet of runners, durable message storage so no request is lost across restarts or shard migrations, and a complete workflow execution engine that maps `@effect/workflow` definitions onto sharded entities. Teams building stateful microservices, saga orchestration, or scheduled background jobs use this package as the single integration point: without it they would have to stitch together a shard manager, a durable mailbox, a distributed cron scheduler, and a workflow engine from scratch.

## Public API surface

**Identity primitives** (`EntityType`, `EntityId`, `EntityAddress`, `ShardId`, `MachineId`, `Snowflake`)
- `EntityType` — a branded `NonEmptyTrimmedString` used as a discriminant for routing (`repos/effect/packages/cluster/src/EntityType.ts:10-11`)
- `EntityId` — string brand identifying one instance within a type (`repos/effect/packages/cluster/src/EntityId.ts`)
- `EntityAddress` — composite of `entityType + entityId + shardId`, the routing key that every message carries (`repos/effect/packages/cluster/src/EntityAddress.ts`)
- `Snowflake` — 64-bit bigint ID encoding millisecond timestamp, 10-bit machine-id, and 12-bit sequence; epoch fixed at `2025-01-01` (`repos/effect/packages/cluster/src/Snowflake.ts:83-102`)

**Entity definition and client** (`Entity`)
- `Entity.make(type, rpcs)` — creates an `Entity<Type, Rpcs>` from a string name and an array of `Rpc` definitions (`repos/effect/packages/cluster/src/Entity.ts:390-400`)
- `entity.toLayer(handlers, options)` — builds a `Layer` that registers the entity with `Sharding` (`repos/effect/packages/cluster/src/Entity.ts:239-273`)
- `entity.toLayerMailbox(behaviour, options)` — alternative registration via a raw `Mailbox<Request>` + `Replier` pair, unbounded concurrency (`repos/effect/packages/cluster/src/Entity.ts:275-355`)
- `entity.client` — `Effect` that yields `(entityId: string) => RpcClient`, backed by the `Sharding` context (`repos/effect/packages/cluster/src/Entity.ts:234-238`)
- `Entity.makeTestClient` — in-process test harness that wires server and client without a real cluster (`repos/effect/packages/cluster/src/Entity.ts:497-589`)

**Sharding service** (`Sharding`, `ShardingConfig`, `ShardingRegistrationEvent`)
- `Sharding` — central `Context.Tag` service; exposes `registerEntity`, `registerSingleton`, `makeClient`, `send`, `sendOutgoing`, `notify`, `reset`, `pollStorage`, `activeEntityCount`, and `getSnowflake` (`repos/effect/packages/cluster/src/Sharding.ts:68-188`)
- `Sharding.layer` — wires `Sharding` from `ShardingConfig | Runners | MessageStorage | RunnerStorage | RunnerHealth` (`repos/effect/packages/cluster/src/Sharding.ts:1434-1440`)
- `ShardingConfig` — all tuning knobs: `shardsPerGroup` (default 300), `entityMaxIdleTime` (1 min), `shardLockRefreshInterval` (10 s), `runnerAddress` (set to `None` for client-only mode), and eighteen more fields (`repos/effect/packages/cluster/src/ShardingConfig.ts:22-124`); loaded from env via `ShardingConfig.configFromEnv` (`repos/effect/packages/cluster/src/ShardingConfig.ts:268-274`)

**Message persistence** (`MessageStorage`, `SqlMessageStorage`, `SqlRunnerStorage`)
- `MessageStorage` — abstract `Context.Tag` for durable message storage; defines `saveRequest`, `saveReply`, `unprocessedMessages`, `requestIdForPrimaryKey`, `clearReplies`, and nine other operations (`repos/effect/packages/cluster/src/MessageStorage.ts:32-145`)
- `MessageStorage.layerMemory` — fully in-memory implementation backed by `MemoryDriver`; suitable for tests and single-node dev (`repos/effect/packages/cluster/src/MessageStorage.ts:898-904`)
- `MessageStorage.layerNoop` — no-op implementation that discards all messages; used when persistence is not required (`repos/effect/packages/cluster/src/MessageStorage.ts:892-893`)
- `SqlMessageStorage.layer` — production SQL backend; runs auto-migrations for `cluster_messages` and `cluster_replies` tables at startup; supports PostgreSQL, MySQL, MSSQL, and SQLite with dialect-aware SQL (`repos/effect/packages/cluster/src/SqlMessageStorage.ts:593-599`)
- `SqlRunnerStorage.layer` — SQL backend for runner registry and shard locks

**Transports** (`HttpRunner`, `SocketRunner`, `SingleRunner`)
- `HttpRunner` — wires inter-runner communication over HTTP using `@effect/platform` `HttpRouter`; exposes `layerClientProtocolHttp` and `layerServer` (`repos/effect/packages/cluster/src/HttpRunner.ts:32-57`)
- `SocketRunner` — WebSocket/raw-socket transport variant
- `SingleRunner` — single-process mode; all entities run in one runner with no network hops

**Workflow engine** (`ClusterWorkflowEngine`)
- `ClusterWorkflowEngine.layer` — provides `WorkflowEngine` (from `@effect/workflow`) backed by the cluster; every workflow is mapped to a sharded `Entity<"Workflow/<name>">` with four built-in RPCs: `run`, `activity`, `deferred`, `resume` (`repos/effect/packages/cluster/src/ClusterWorkflowEngine.ts:552-574`)
- `ClusterWorkflowEngine.make` — `Effect.gen` factory that builds the engine; wires durable clocks, deferred signals, activity retry, and sub-workflow parent links (`repos/effect/packages/cluster/src/ClusterWorkflowEngine.ts:46-522`)

**Distributed cron** (`ClusterCron`)
- `ClusterCron.make(options)` — returns a `Layer` that registers a cron entity plus a singleton that fires the first run; each subsequent run schedules itself as a new entity message with `DeliverAt` semantics (`repos/effect/packages/cluster/src/ClusterCron.ts:27-124`)

**Singleton scheduling** (`Singleton`)
- `Singleton.make(name, run, options)` — registers an effect to run on exactly one runner; shard-pinned via `Sharding.registerSingleton` (`repos/effect/packages/cluster/src/Singleton.ts:13-23`)

**Kubernetes integration** (`K8sHttpClient`)
- `K8sHttpClient.layer` — builds an `HttpClient` pre-configured for the in-cluster service-account token and `https://kubernetes.default.svc/api`; used by `RunnerStorage` implementations to discover pod IPs (`repos/effect/packages/cluster/src/K8sHttpClient.ts:32-52`)
- `K8sHttpClient.makeGetPods` — cacheable (10 s TTL) pod-list effect filtered by `Running` phase and optional label selector (`repos/effect/packages/cluster/src/K8sHttpClient.ts:58-93`)

**Annotations** (`ClusterSchema`)
- `Persisted` — `Context.Reference` annotation; when `true` on an `Rpc`, the message is written to `MessageStorage` before delivery (`repos/effect/packages/cluster/src/ClusterSchema.ts:12-14`)
- `Uninterruptible` — controls whether a client interrupt is forwarded to the server (`true` | `"client"` | `"server"`) (`repos/effect/packages/cluster/src/ClusterSchema.ts:20-39`)
- `ShardGroup` — annotation function `(entityId: EntityId) => string`; default is `() => "default"` (`repos/effect/packages/cluster/src/ClusterSchema.ts:45-47`)
- `ClientTracingEnabled` — suppresses client-side spans on internal RPCs like cron ticks (`repos/effect/packages/cluster/src/ClusterSchema.ts:53-57`)

**Scheduling primitive** (`DeliverAt`)
- Protocol-level interface `{ [symbol](): DateTime }` on message payloads; `SqlMessageStorage` reads `deliverAt` and skips messages with a future timestamp, enabling at-time-delivery without external scheduler infrastructure (`repos/effect/packages/cluster/src/DeliverAt.ts:10-36`)

**Metrics** (`ClusterMetrics`)
- Gauge counters for `shards`, `runners`, `runnersHealthy`, and `singletons`; updated inline by `Sharding` on shard assignment changes (`repos/effect/packages/cluster/src/ClusterMetrics.ts`)

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — every transport, storage backend, and workflow engine is exposed as a `Layer`; `Sharding.layer` is `Layer.scoped` because it manages shard locks with a scope finalizer (`repos/effect/packages/cluster/src/Sharding.ts:1434-1440`)
- [Layer.merge / provide / fresh — Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `ClusterWorkflowEngine.layer` uses `Layer.provideMerge` to thread the internal `ClockEntityLayer` alongside the `WorkflowEngine` service (`repos/effect/packages/cluster/src/ClusterWorkflowEngine.ts:653-659`)
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `Sharding`, `MessageStorage`, `RunnerStorage`, `RunnerHealth`, `K8sHttpClient`, `ShardingConfig` are all defined as `Context.Tag` classes; `Persisted`, `Uninterruptible`, `ShardGroup` use `Context.Reference` with a `defaultValue` so they never require explicit provision (`repos/effect/packages/cluster/src/ClusterSchema.ts:12-57`)
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — the entire `Sharding` implementation is one long `Effect.gen` factory (`repos/effect/packages/cluster/src/Sharding.ts:200-1428`) running five named sub-loops as forked fibers
- [Effect.fn (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — `Effect.fnUntraced` is used throughout (e.g., `releaseShard`, `registerEntity`, `resetActivityAttempt`) to compose pipeable transformers without adding spans to internal machinery (`repos/effect/packages/cluster/src/Sharding.ts:266-295`)
- [Mailbox — ordered message inbox](../02-patterns-catalog.md#mailbox--ordered-message-inbox) — `Entity.toLayerMailbox` exposes the entity's incoming request stream as a `Mailbox<Request<Rpcs>>` for consumers that prefer an actor-style receive loop over per-RPC handlers (`repos/effect/packages/cluster/src/Entity.ts:275-355`)
- [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `singletonFibers` is a `FiberMap<SingletonAddress>` so singletons are started/stopped by shard-assignment changes without leaking fibers (`repos/effect/packages/cluster/src/Sharding.ts:1196-1263`)
- [PubSub — multi-subscriber broadcast](../02-patterns-catalog.md#pubsub--multi-subscriber-broadcast) — `getRegistrationEvents` is a `Stream.fromPubSub(events)` that broadcast `EntityRegistered` and `SingletonRegistered` events; consumers can react to topology changes (`repos/effect/packages/cluster/src/Sharding.ts:227-228`)
- [Schema.Class and Schema.TaggedClass](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — `CronPayload`, `ClockPayload`, `PodStatus`, `Pod` all use `Schema.Class`; `EntityNotAssignedToRunner`, `MalformedMessage`, `PersistenceError`, `MailboxFull`, `AlreadyProcessingMessage` use `Schema.TaggedError` for first-class schema-encoded errors (`repos/effect/packages/cluster/src/ClusterError.ts:31-193`)
- [Schema.brand / filter — constraints](../02-patterns-catalog.md#schemabrand--filter--constraints) — `EntityType` is `Schema.NonEmptyTrimmedString.pipe(Schema.brand("EntityType"))`, guaranteeing routing keys are never blank or padded (`repos/effect/packages/cluster/src/EntityType.ts:10`)
- [RcRef and RcMap — reference-counted resources](../02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources) — the `clients` map inside `Sharding` and the `clients` / `clientsPartial` maps inside `ClusterWorkflowEngine` are both `RcMap` with a 5-minute TTL, so idle `RpcClient` instances are released automatically (`repos/effect/packages/cluster/src/ClusterWorkflowEngine.ts:116-132`)
- [Metric.counter / gauge / histogram / summary](../02-patterns-catalog.md#metriccounter--gauge--histogram--summary) — `ClusterMetrics` defines `Metric.gauge` for shards, runners, healthy runners, and singletons; `unsafeUpdate` is called from deep inside `Sharding` on every topology change (`repos/effect/packages/cluster/src/Sharding.ts:357`, `884-885`)
- [Schedule.spaced / exponential / fixed / recurs](../02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) — retry policies throughout: `ClusterCron` and `ClusterWorkflowEngine` share `Schedule.exponential(200, 1.5).pipe(Schedule.union(Schedule.spaced("1 minute")))` as a standard backoff (`repos/effect/packages/cluster/src/ClusterCron.ts:126-128`)
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `ShardingConfig.config` assembles all tuning parameters from environment variables via `Config.all`; `layerFromEnv` wires it into a `Layer` (`repos/effect/packages/cluster/src/ShardingConfig.ts:171-262`)
- [The internal/ folder and index.ts re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — `entityManager`, `entityReaper`, `hash`, `interruptors`, `resourceMap` live under `src/internal/`; every public module imports from `./internal/` not from each other's internals

## What's unique about this package's design

The most important insight is that `@effect/cluster` unifies persistent entity sharding with durable workflow execution through a single abstraction: every workflow is just a specially annotated sharded entity. `ClusterWorkflowEngine.make` calls `sharding.registerEntity(ensureEntity(workflow), ...)` to create a `Workflow/<name>` entity whose four RPCs (`run`, `activity`, `deferred`, `resume`) are each annotated `Persisted: true` and `Uninterruptible: true` (`repos/effect/packages/cluster/src/ClusterWorkflowEngine.ts:552-574`). This means workflows survive runner restarts for free — the durable clock mechanism is itself a tiny cluster entity (`ClockEntity`, `Workflow/-/DurableClock`) that stores a `DeliverAt` timestamp and fires `deferredDone` when it wakes up (`repos/effect/packages/cluster/src/ClusterWorkflowEngine.ts:611-645`).

The `Persisted` and `Uninterruptible` annotations on `Rpc` definitions are the second key design decision. They are `Context.Reference` values with safe defaults (both off), so non-durable entities pay no storage overhead. Flipping `Persisted: true` on a single `Rpc` causes `Sharding.sendOutgoing` to route through `MessageStorage.saveRequest` before delivery and sets up reply handlers — all without any change to handler code (`repos/effect/packages/cluster/src/Sharding.ts:829-835`).

The shard locking mechanism separates assignment from ownership: `RunnerStorage` assigns shards via a consistent hash ring over healthy runners, but `Sharding` only considers a shard "active" after acquiring a distributed lock with `runnerStorage.acquire` and must refresh that lock every `shardLockRefreshInterval` or lose it (`repos/effect/packages/cluster/src/Sharding.ts:303-413`). This prevents split-brain even when `RunnerStorage` polling lags behind reality.

The `DeliverAt` protocol interface enables at-time delivery of any message payload that implements `[DeliverAt.symbol](): DateTime` — no external scheduler needed. `SqlMessageStorage` reads the `deliver_at` column in `unprocessedMessages` and filters by `<= now` (`repos/effect/packages/cluster/src/SqlMessageStorage.ts:326-333`). `ClusterCron` and `ClusterWorkflowEngine`'s durable clock both use this mechanism.

## Conventions observed

**File layout:** One public concept per file; the file name always matches the exported namespace name (e.g., `ClusterCron.ts` exports `ClusterCron.*`). Internal implementation details live in `src/internal/` (`entityManager.ts`, `entityReaper.ts`, `resourceMap.ts`, `hash.ts`, `interruptors.ts`) and are never re-exported via `src/index.ts`.

**Error shape:** All errors extend `Schema.TaggedError` (not `Data.TaggedError`), making them schema-encodable over the wire. Each error class carries a `[TypeId]` property and a static `.is()` guard. The `PersistenceError.refail` and `MalformedMessage.refail` static methods wrap raw `SqlError` or `ParseError` into typed cluster errors (`repos/effect/packages/cluster/src/ClusterError.ts:74-103`).

**Annotations over inheritance:** Instead of subclassing entities to add behavior (durable, uninterruptible, sharded differently), the package annotates `Rpc` and `Entity` objects with `Context.Reference` values that change routing and storage decisions downstream. This keeps entity definition flat and avoids an inheritance hierarchy.

**`Config` / env-driven configuration:** `ShardingConfig.layerFromEnv` reads all 18+ fields from environment variables in `CONSTANT_CASE` via `ConfigProvider.fromEnv().pipe(ConfigProvider.constantCase)`, with `defaults` providing safe out-of-the-box values for development (`repos/effect/packages/cluster/src/ShardingConfig.ts:267-287`).

**SQL dialect portability:** `SqlMessageStorage` uses `sql.onDialectOrElse` for every dialect-specific expression (e.g., `ON CONFLICT DO NOTHING` vs `INSERT IGNORE` vs `MERGE ... HOLDLOCK`) rather than runtime branching, keeping query text fully typed and auditable (`repos/effect/packages/cluster/src/SqlMessageStorage.ts:203-285`).

**Tracer suppression for internal RPCs:** Low-level cluster messages (cron ticks, durable clock signals, health checks) annotate their entities with `ClusterSchema.ClientTracingEnabled = false` to avoid polluting distributed traces with infrastructure noise (`repos/effect/packages/cluster/src/ClusterCron.ts:63-64`).

## "If you were authoring something similar, copy this"

- **Shard-pinned singletons via `FiberMap`.** Registering a singleton calls `FiberMap.run(singletonFibers, address, wrappedRun)`, and the sync loop starts/stops fibers purely by comparing `acquiredShards` to the registered shard ID — no explicit lifecycle management in the caller (`repos/effect/packages/cluster/src/Sharding.ts:1196-1263`). Steal this for any system where a process should run on exactly one node.

- **`Context.Reference` as an open annotation system.** Rather than accepting a large options object, add orthogonal behavior by letting callers annotate protocol objects. Downstream code reads `Context.get(rpc.annotations, Persisted)` at dispatch time. New behaviors can be added without touching existing API surfaces (`repos/effect/packages/cluster/src/ClusterSchema.ts:12-57`).

- **The `DeliverAt` symbol protocol for scheduler-free delayed delivery.** Define `[symbol](): DateTime` on any payload class; the storage layer reads it and withholds delivery until that time. This composes with durable messages so "schedule at time T" is just "persist with deliverAt = T" (`repos/effect/packages/cluster/src/DeliverAt.ts:10-36`, `repos/effect/packages/cluster/src/ClusterCron.ts:130-139`).

- **Two-layer storage abstraction.** `MessageStorage.Encoded` is the raw database interface; `MessageStorage.makeEncoded(encoded)` wraps it with Schema decode/encode logic, reply-handler registration, and defect-to-reply conversion. Implementors only implement the `Encoded` interface; the high-level `MessageStorage` type is derived automatically (`repos/effect/packages/cluster/src/MessageStorage.ts:217-322`, `348-646`).

- **Idempotent message save via primary key.** Every durable `Rpc` can carry a `primaryKey` accessor; `MessageStorage.saveRequest` returns `SaveResult.Duplicate({ originalId, lastReceivedReply })` when a message with that key already exists, letting callers resume from the last known reply without re-executing (`repos/effect/packages/cluster/src/MessageStorage.ts:151-211`).

- **`simulateRemoteSerialization` flag in config.** When `true` (the default in dev), local sends still go through full Schema encode/decode, catching serialization bugs before production. A single boolean controls this tradeoff (`repos/effect/packages/cluster/src/ShardingConfig.ts:122-124`).

- **K8s pod-list caching with `Effect.cachedWithTTL`.** `K8sHttpClient.makeGetPods` wraps the pod-list request in `Effect.cachedWithTTL("10 seconds")` to avoid hammering the API server. This is the idiomatic place to apply this pattern — at the leaf IO boundary, not in business logic (`repos/effect/packages/cluster/src/K8sHttpClient.ts:91-93`).

## Open questions

1. **Schema evolution of persisted messages.** The `SqlMessageStorage` stores `payload` as raw JSON. There is no visible migration strategy for changing the payload schema of a `Persisted` `Rpc` after messages have been written. How does the cluster handle old messages with stale schemas on a rolling deploy?

2. **`shardsPerGroup` immutability.** The config comment says "this value should be consistent across all runners" but there is no enforcement. What happens if two runners in the same cluster are started with different `shardsPerGroup` values? The hash ring would produce incompatible shard assignments.

3. **`SingleRunner` vs `HttpRunner` vs `SocketRunner` feature parity.** `SingleRunner` clearly exists for single-process dev/test. It is unclear whether `SocketRunner` is production-ready or an experimental alternative to `HttpRunner`.

4. **Workflow and activity error handling.** `ClusterWorkflowEngine` catches interrupts from `RpcServer.fiberIdClientInterrupt` and converts them to `Workflow.Suspended`. It is unclear how client-initiated interrupts interact with the `Uninterruptible: "server"` annotation on `ActivityRpc`.

5. **`EntityResource` module.** `src/EntityResource.ts` is exported from `index.ts` but was not examined in depth. Its role in the resource lifecycle (likely a scope-tracked entity handle) is not fully understood.

6. **`RunnerStorage` interface and advisory locks.** `ShardingConfig.shardLockDisableAdvisory` suggests an advisory-lock-based fast path in `SqlRunnerStorage`, but the conditions under which advisory locks are unavailable (e.g., PgBouncer in transaction mode) are not documented publicly.
