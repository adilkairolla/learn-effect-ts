# Chapter 30 — Distributed actors with @effect/cluster

> **Package(s):** `@effect/cluster`
> **Patterns introduced:** [`LayerMap — keyed map of layers (per-tenant / per-request)`](../../research/02-patterns-catalog.md#layermap--keyed-map-of-layers-per-tenant--per-request)
> **Reads from:** Chapter 09 (Layer), Chapter 25 (sql-core), Chapter 28 (type-safe RPC), Chapter 29 (durable workflows)
> **Reads into:** Part III (cluster-style services as a worked-example variation)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Imagine a chat server with rooms. Each room is a tiny stateful object: a list of members, a message backlog, a rate limiter. On a single node, this is easy — every room lives in a `Map<string, RoomState>`, updates are synchronous, and nothing is lost.

Then the product grows. One node cannot handle 50,000 concurrent rooms, so you add a second node and put a load balancer in front. Now you have a problem you did not design for:

```ts
// Node A and Node B each hold their own in-memory Map
// A client connected to node A sends a message to "room-42"
// node B also has members connected to "room-42"
// node B never sees the message — it is trapped in node A's Map

const rooms = new Map<string, RoomState>() // one per process — no cross-node awareness

function postMessage(roomId: string, text: string) {
  const room = rooms.get(roomId)
  if (!room) throw new Error(`Room ${roomId} not found on this node`)
  room.messages.push(text)
  // members connected to the OTHER node never receive this
}
```

You need sticky sessions — every request for the same room must land on the same node. You implement that with a consistent-hash proxy. Then a node restarts during a shard rebalance and half your rooms migrate. While they migrate, messages arrive at the old node, queue up, and are lost. You implement a durable outbox. Then the shard manager itself becomes a single point of failure, so you replicate it. Each of these is a week of careful, error-prone infrastructure work, and none of it is your product.

> **Note:** `@effect/cluster` is tagged `@experimental` as of `effect@3.21.2`. Its API surface may change between minor versions. Hedge accordingly in production deployments and pin the SHA `39c934c1476be389f7469433910fdf30fc4dad82`.

`@effect/cluster` absorbs this entire problem. It provides consistent-hash sharding, a distributed shard lock so no two runners own the same shard simultaneously, durable message storage so no request is lost across restarts or rebalances, and Snowflake IDs for globally unique entity addresses. You declare *what* your stateful entity does; the cluster handles *where* it runs.

---

## The minimal example

A counter entity — one message type, one reply. The full cluster is wired in under 40 lines.

```ts
import { Rpc } from "@effect/rpc"
import * as Entity from "@effect/cluster/Entity"
import * as Singleton from "@effect/cluster/Singleton"
import * as Sharding from "@effect/cluster/Sharding"
import * as SingleRunner from "@effect/cluster/SingleRunner"
import * as MessageStorage from "@effect/cluster/MessageStorage"
import { Effect, Layer, Schema } from "effect"

// --- Protocol ---
class Increment extends Rpc.make("Increment", {
  payload: Schema.Struct({ amount: Schema.Number }),
  success: Schema.Number,
}) {}

// --- Entity definition ---
const Counter = Entity.make("Counter", [Increment])

// --- Entity handler layer ---
const CounterLive = Counter.toLayer(
  Effect.gen(function*() {
    let count = 0
    return {
      Increment: ({ payload }) =>
        Effect.sync(() => {
          count += payload.amount
          return count
        }),
    }
  })
)

// --- Wire up and run ---
const program = Effect.gen(function*() {
  const client = yield* Counter.client
  const counter = client("my-counter")
  const result = yield* counter.Increment({ amount: 5 })
  yield* Effect.log(`Counter is now: ${result}`)
})

program.pipe(
  Effect.provide(CounterLive),
  Effect.provide(Layer.mergeAll(
    SingleRunner.layer,
    MessageStorage.layerNoop,
  )),
  Effect.runPromise
)
```

---

## Tour

> **`@effect/cluster` is `@experimental`.** Every export discussed below is subject to breaking changes. The patterns are stable in intent, but the API surface is still evolving.

`@effect/cluster` is the distributed-systems runtime of the Effect ecosystem. It builds directly on `@effect/rpc` (Chapter 28) for typed message protocols, `@effect/workflow` (Chapter 29) for durable execution, and `@effect/sql` (Chapter 25) for persistent storage. Rather than repeating those foundations here, this chapter covers the five cluster-specific concepts: Entity, Sharding, Singleton, MessageStorage, and Snowflake — then introduces the `LayerMap` pattern that fits naturally into cluster design.

### Entity — declarative actor with typed messages

`Entity.make` produces an `Entity<Type, Rpcs>`. It takes a string type name and an array of `Rpc` definitions from `@effect/rpc`, the same definitions used in Chapter 28.

```
repos/effect/packages/cluster/src/Entity.ts:383-400
```
(`/**` opens at line 383.)

```ts
export const make = <const Type extends string, Rpcs extends ReadonlyArray<Rpc.Any>>(
  type: Type,
  protocol: Rpcs
): Entity<Type, Rpcs[number]>
```

The `type` string becomes the routing discriminant — every message in the cluster carries it so the shard manager knows which handler to invoke. Once you have an `Entity`, you register it in two ways:

- `entity.toLayer(handlers)` — maps each Rpc name to an Effect handler. This is the idiomatic path. Handlers can close over services from the environment, including `CurrentAddress` to discover which entity ID is currently being handled.
- `entity.toLayerMailbox(build)` — gives you a raw `Mailbox<Request>` and a `Replier`. Prefer this when your entity wants to process messages as a stream rather than individual handlers.
- `entity.client` — yields `(entityId: string) => RpcClient` backed by the ambient `Sharding` context.

The `Entity` interface also carries `annotate` and `annotateRpcs` for attaching `ClusterSchema` annotations (see "MessageStorage" below) without changing the handler shape. Source: `repos/effect/packages/cluster/src/Entity.ts:56-118`.

### Sharding — partitioning, shard manager, and runner addresses

`Sharding` is the central `Context.Tag` service. It manages the consistent-hash ring that decides which runner owns each shard, and it exposes `registerEntity` / `registerSingleton` / `makeClient` / `send` / `sendOutgoing` / `notify` / `pollStorage` / `activeEntityCount` / `getSnowflake`. Source: `repos/effect/packages/cluster/src/Sharding.ts:64-188`.

`Sharding.layer` is `Layer.scoped` because it holds distributed shard locks for the lifetime of the runner process. Its requirements are:

```
ShardingConfig | Runners | MessageStorage | RunnerStorage | RunnerHealth
```

Source: `repos/effect/packages/cluster/src/Sharding.ts:1430-1440`.

`ShardingConfig` contains all tuning parameters — `shardsPerGroup` (default 300), `entityMaxIdleTime`, `shardLockRefreshInterval`, `runnerAddress` (set to `None` for client-only mode), and eighteen more fields. All are loaded from environment variables via `ShardingConfig.configFromEnv`.

For development and tests, `SingleRunner.layer` collapses all runners into one in-process instance, removing the network layer entirely. For production, `HttpRunner` wires inter-runner communication over HTTP using `@effect/platform`.

### Singleton — exactly-one services across the cluster

`Singleton.make` registers an Effect to run on exactly one runner at a time. The implementation uses `FiberMap` internally: when the shard manager reassigns the singleton's pinned shard, the old fiber is stopped and the new runner starts a fresh one.

Source: `repos/effect/packages/cluster/src/Singleton.ts:1-23`.

```ts
export const make = <E, R>(
  name: string,
  run: Effect.Effect<void, E, R>,
  options?: { readonly shardGroup?: string | undefined }
): Layer.Layer<never, never, Sharding | Exclude<R, Scope>>
```

The `name` uniquely identifies the singleton across the cluster. Use `Singleton.make` for:

- A global presence tracker that aggregates online state across all entity instances.
- A scheduled job that must run once per cluster, not once per runner.
- A leader-election process that holds a distributed resource.

Unlike a plain service, a `Singleton` participates in the shard lifecycle: it starts on the runner that owns its designated shard and stops if that runner loses the shard. Calling `yield* Singleton.make(...)` outside a shard context (e.g., in a non-cluster `Layer`) will fail with a missing `Sharding` dependency, which is intentional — it prevents accidental "one per node" behavior.

### MessageStorage and persistence

`MessageStorage` is an abstract `Context.Tag` for durable message storage. It defines `saveRequest`, `saveReply`, `unprocessedMessages`, `clearReplies`, and related operations. Source: `repos/effect/packages/cluster/src/MessageStorage.ts:32-145`.

Two built-in implementations ship out of the box:

- `MessageStorage.layerNoop` — discards all messages; use for unit tests where you only care about handler logic. Source: `repos/effect/packages/cluster/src/MessageStorage.ts:888-892`.
- `MessageStorage.layerMemory` — fully in-memory; use for integration tests and single-process dev. Source: `repos/effect/packages/cluster/src/MessageStorage.ts:894-904`.
- `SqlMessageStorage.layer` — production SQL backend; auto-migrates `cluster_messages` and `cluster_replies` tables; supports PostgreSQL, MySQL, MSSQL, and SQLite.

Persistence is opt-in per message. The `Persisted` annotation (`ClusterSchema`) is a `Context.Reference` with `defaultValue: false`. Annotating an `Rpc` with `Persisted: true` causes `Sharding.sendOutgoing` to write the message to `MessageStorage` before delivery; the runner then has a durable record to replay if it restarts mid-execution.

Source: `repos/effect/packages/cluster/src/ClusterSchema.ts:8-14`.

```ts
export class Persisted extends Context.Reference<Persisted>()(
  "@effect/cluster/ClusterSchema/Persisted",
  { defaultValue: constFalse }
) {}
```

The companion `Uninterruptible` annotation controls whether a client interrupt propagates to the server handler. `ClusterSchema.ts:16-39` defines three modes: `true` (both sides), `"client"` (interrupt client fiber but keep server running), `"server"` (server is uninterruptible but client cancels). Source: `repos/effect/packages/cluster/src/ClusterSchema.ts:16-39`.

### Snowflake IDs

`Snowflake` is a 64-bit `bigint` brand encoding millisecond timestamp, 10-bit machine ID, and 12-bit sequence counter. The epoch is fixed at `2025-01-01`. `Sharding.getSnowflake` produces a cluster-unique ID from the runner's machine ID and sequence. Source: `repos/effect/packages/cluster/src/Snowflake.ts:91-102`.

Snowflake IDs are monotonically increasing within a machine and nearly monotonic across machines (clock skew aside). They are the default primary key for persisted messages, which is why `MessageStorage.saveRequest` can detect duplicates without a separate idempotency table.

### LayerMap — keyed layers per entity

`LayerMap` is a core Effect pattern (see [patterns catalog](../../research/02-patterns-catalog.md#layermap--keyed-map-of-layers-per-tenant--per-request)) that connects naturally to cluster design. An entity instance is a named actor — `("Counter", "user-42")` is a distinct actor from `("Counter", "user-99")`. When each actor needs its own isolated service (a per-room rate limiter, a per-tenant database connection, a per-session audit log), you want to create a layer on demand, keyed by entity ID, and release it when the entity goes idle.

`LayerMap.make` does exactly this. Source: `repos/effect/packages/effect/src/LayerMap.ts:1-5` (`@experimental` noted at the module level) and `114-132`:

```ts
export const make: <
  K,
  L extends Layer.Layer<any, any, any>,
  PreloadKeys extends Iterable<K> | undefined = undefined
>(
  lookup: (key: K) => L,
  options?: {
    readonly idleTimeToLive?: Duration.DurationInput | undefined
    readonly preloadKeys?: PreloadKeys
  }
) => Effect.Effect<LayerMap<K, ...>, ..., Scope>
```

> **`LayerMap` is also `@experimental`** — it is marked `@experimental` in `repos/effect/packages/effect/src/LayerMap.ts:3`.

The `lookup` function is called once per distinct key, producing a `Layer`. Subsequent calls for the same key return the cached `Layer`. The optional `idleTimeToLive` releases the underlying resources after a period of inactivity, matching entity idle-time semantics in `ShardingConfig.entityMaxIdleTime`.

`LayerMap.Service` provides the idiomatic wrapper for cluster use:

```ts
import { LayerMap, Layer, Context, Effect } from "effect"

// Per-room rate-limiter service
class RoomRateLimiter extends Context.Tag("RoomRateLimiter")<
  RoomRateLimiter,
  { allow: Effect.Effect<boolean> }
>() {}

// A LayerMap keyed by room ID
class RoomServices extends LayerMap.Service<RoomServices>()("RoomServices", {
  lookup: (roomId: string) =>
    Layer.succeed(RoomRateLimiter, {
      allow: Effect.sync(() => Math.random() < 0.9), // placeholder
    }),
  idleTimeToLive: "5 minutes",
  dependencies: [],
}) {}
```

Inside an entity handler, `Effect.provide(RoomServices.get(entityId))` injects the per-room rate limiter for that specific invocation. Source: `repos/effect/packages/effect/src/LayerMap.ts:252-265` (the `TagClass.get` signature).

This pattern is the `LayerMap` analog of what `KeyedPool` (Chapter 23) does for connection pools: a resource map keyed by a discriminant, with lazy initialization and TTL-based eviction.

---

## A production example

A multi-room chat server. Each room is an `Entity` with member management and message history. A `Singleton` tracks global online presence. A `LayerMap` provides per-room rate-limiting services.

```ts
import { Rpc } from "@effect/rpc"
import * as Entity from "@effect/cluster/Entity"
import * as Singleton from "@effect/cluster/Singleton"
import { Persisted } from "@effect/cluster/ClusterSchema"
import * as SingleRunner from "@effect/cluster/SingleRunner"
import * as MessageStorage from "@effect/cluster/MessageStorage"
import {
  Context,
  Effect,
  Layer,
  LayerMap,
  Ref,
  Schema,
} from "effect"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
class JoinRoom extends Rpc.make("JoinRoom", {
  payload: Schema.Struct({ userId: Schema.String }),
  success: Schema.Struct({ memberCount: Schema.Number }),
}) {}

class PostMessage extends Rpc.make("PostMessage", {
  payload: Schema.Struct({ userId: Schema.String, text: Schema.String }),
  success: Schema.Void,
}).pipe(Rpc.annotate(Persisted, true)) {}

class GetHistory extends Rpc.make("GetHistory", {
  payload: Schema.Void,
  success: Schema.Array(Schema.String),
}) {}

// ---------------------------------------------------------------------------
// Per-room rate limiter (via LayerMap)
// ---------------------------------------------------------------------------
// Note: LayerMap is @experimental — hedge if used in production
class RoomRateLimiter extends Context.Tag("RoomRateLimiter")<
  RoomRateLimiter,
  { readonly check: (userId: string) => Effect.Effect<boolean> }
>() {}

class RoomServices extends LayerMap.Service<RoomServices>()("RoomServices", {
  lookup: (_roomId: string) =>
    Layer.effect(RoomRateLimiter, Effect.gen(function*() {
      const counts = yield* Ref.make(new Map<string, number>())
      return {
        check: (userId) => Ref.modify(counts, (m) => {
          const n = (m.get(userId) ?? 0) + 1
          return [n < 10, new Map([...m, [userId, n]])]
        }),
      }
    })),
  idleTimeToLive: "10 minutes",
  dependencies: [],
}) {}

// ---------------------------------------------------------------------------
// Chat room entity
// ---------------------------------------------------------------------------
const ChatRoom = Entity.make("ChatRoom", [JoinRoom, PostMessage, GetHistory])

const ChatRoomLive = ChatRoom.toLayer(
  Effect.gen(function*() {
    const members = yield* Ref.make<Set<string>>(new Set())
    const history = yield* Ref.make<Array<string>>([])

    return ChatRoom.of({
      JoinRoom: ({ payload }) =>
        Effect.gen(function*() {
          yield* Ref.update(members, (s) => new Set([...s, payload.userId]))
          const size = yield* Ref.get(members).pipe(Effect.map((s) => s.size))
          return { memberCount: size }
        }),

      PostMessage: ({ payload }) =>
        Effect.gen(function*() {
          // per-room rate limiter from LayerMap
          const limiter = yield* RoomRateLimiter
          const allowed = yield* limiter.check(payload.userId)
          if (!allowed) return yield* Effect.fail(new Error("rate limit exceeded"))
          const line = `${payload.userId}: ${payload.text}`
          yield* Ref.update(history, (h) => [...h, line])
        }),

      GetHistory: () =>
        Ref.get(history),
    })
  })
)

// ---------------------------------------------------------------------------
// Global presence singleton
// ---------------------------------------------------------------------------
class PresenceStore extends Context.Tag("PresenceStore")<
  PresenceStore,
  Ref.Ref<number>
>() {}

const presenceSingleton = Singleton.make(
  "GlobalPresence",
  Effect.gen(function*() {
    const store = yield* PresenceStore
    yield* Effect.log(`Tracking global presence`).pipe(
      Effect.flatMap(() => Ref.updateAndGet(store, (n) => n + 1)),
      Effect.flatMap((n) => Effect.log(`Total sessions: ${n}`)),
      Effect.forever,
    )
  }),
)

// ---------------------------------------------------------------------------
// Full layer composition
// ---------------------------------------------------------------------------
const AppLive = Layer.mergeAll(
  ChatRoomLive,
  presenceSingleton,
  RoomServices.Default,
  SingleRunner.layer,
  MessageStorage.layerMemory,
)

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------
const program = Effect.gen(function*() {
  const client = yield* ChatRoom.client
  const room = client("general")

  yield* room.JoinRoom({ userId: "alice" })
  yield* room.PostMessage({ userId: "alice", text: "Hello, cluster!" }).pipe(
    Effect.provide(RoomServices.get("general")),
  )
  const history = yield* room.GetHistory()
  yield* Effect.log(`Messages: ${JSON.stringify(history)}`)
})

program.pipe(
  Effect.provide(AppLive),
  Effect.runPromise,
)
```

Key points:

- `PostMessage` is annotated `Persisted: true`, so the cluster writes it to `MessageStorage` before delivery. Swap `layerMemory` for `SqlMessageStorage.layer` in production.
- `RoomServices` is a `LayerMap.Service` that lazily initializes a per-room `RoomRateLimiter`. The `idleTimeToLive` of 10 minutes matches a reasonable entity idle window.
- `presenceSingleton` runs on exactly one runner thanks to `Singleton.make`. It would track actual join/leave events in production via a `PubSub`.
- `ChatRoomLive` composes clean handler Effects using `Effect.gen`, with all Part I patterns intact (Ref, Effect.fn, typed errors via `Effect.fail`).

---

## Variations

**In-memory shard manager for tests.** Replace `MessageStorage.layerNoop` with `MessageStorage.layerMemory` and `SingleRunner.layer` to run the full entity logic without any network or database:

```ts
const TestLive = Layer.mergeAll(SingleRunner.layer, MessageStorage.layerMemory)
```

**Persistent SQL storage in production.** Swap `layerMemory` for the SQL backend; auto-migration runs at startup:

```ts
import * as SqlMessageStorage from "@effect/cluster/SqlMessageStorage"

const ProdStorage = SqlMessageStorage.layer.pipe(Layer.provide(PgLive))
```

**Custom shard count.** Override `shardsPerGroup` for workloads with very large entity counts (more shards = finer-grained placement, more lock overhead):

```ts
import * as ShardingConfig from "@effect/cluster/ShardingConfig"

const CustomConfig = ShardingConfig.layerFromEnv.pipe(
  Layer.provideMerge(
    Layer.succeed(ShardingConfig, ShardingConfig.defaults({ shardsPerGroup: 1000 }))
  )
)
```

**Message reliability tier.** Annotate only the messages that truly need durability; leave lightweight query RPCs un-persisted to avoid storage overhead:

```ts
class WriteEvent extends Rpc.make("WriteEvent", { ... }).pipe(
  Rpc.annotate(Persisted, true),    // durable
  Rpc.annotate(Uninterruptible, "server"),
) {}

class ReadState extends Rpc.make("ReadState", { ... }) {} // not persisted — fast path
```

**Mailbox-style entity.** Use `entity.toLayerMailbox` for a receive-loop pattern instead of per-handler registration:

```ts
const CounterMailbox = Counter.toLayerMailbox((mailbox, replier) =>
  Effect.gen(function*() {
    let count = 0
    for (const envelope of yield* mailbox) {
      count += envelope.payload.amount
      yield* replier.succeed(envelope, count)
    }
  })
)
```

**Kubernetes runner discovery.** In Kubernetes, swap `SingleRunner` for `HttpRunner` and add `K8sHttpClient.layer` for automatic pod-IP discovery without a separate service registry:

```ts
import * as HttpRunner from "@effect/cluster/HttpRunner"
import * as K8sHttpClient from "@effect/cluster/K8sHttpClient"

const K8sLive = Layer.mergeAll(HttpRunner.layerServer, K8sHttpClient.layer)
```

---

## Anti-patterns

**Storing entity state in module-level variables.**

```ts
// WRONG — state is lost on shard rebalance; two runners may share the variable
const roomCache = new Map<string, RoomState>()

const ChatRoomLive = ChatRoom.toLayer({
  JoinRoom: ({ payload }) => Effect.sync(() => {
    roomCache.get(payload.roomId)?.members.add(payload.userId)
    // ...
  }),
})
```

Entity state must live inside the handler Effect factory, which is called once per entity activation:

```ts
// CORRECT — Ref lives inside the handler closure, scoped to one entity lifetime
const ChatRoomLive = ChatRoom.toLayer(
  Effect.gen(function*() {
    const members = yield* Ref.make<Set<string>>(new Set())
    return {
      JoinRoom: ({ payload }) =>
        Ref.update(members, (s) => new Set([...s, payload.userId])).pipe(
          Effect.map(() => ({ memberCount: 0 }))
        ),
    }
  })
)
```

**Bypassing Sharding for cross-entity messages.** Calling another entity's handler directly (e.g., importing and calling a function) bypasses the shard manager. The target entity may live on a different runner; a direct call will read stale local state or fail entirely.

```ts
// WRONG — direct call ignores which runner owns chatRoom
import { chatRoomState } from "./roomState"
chatRoomState.get(roomId)?.postMessage(text)

// CORRECT — go through the typed client
const room = (yield* ChatRoom.client)("general")
yield* room.PostMessage({ userId: "alice", text })
```

**Treating Singletons as ordinary services.** A `Singleton` is cluster-wide and shard-pinned. Providing it as a plain `Layer` in multiple runners creates independent instances — the opposite of a singleton.

```ts
// WRONG — each runner creates its own PresenceSingleton
const AppLive = Layer.mergeAll(
  PresenceSingletonLive, // this is a Layer, not Singleton.make(...)
  ShardingLive,
)

// CORRECT — Singleton.make ensures exactly one runner activates it
const presenceSingleton = Singleton.make("GlobalPresence", presenceEffect)
const AppLive = Layer.mergeAll(presenceSingleton, ShardingLive)
```

**Hard-coding runner addresses.** `ShardingConfig.runnerAddress` must match the actual network interface of each runner. Hard-coding it makes the cluster brittle when pods are rescheduled or IPs change. Always load it from the environment:

```ts
// WRONG
const config = ShardingConfig.defaults({ runnerAddress: Option.some({ host: "10.0.0.5", port: 2551 }) })

// CORRECT — let ShardingConfig.layerFromEnv read RUNNER_ADDRESS from the env
const ConfigLive = ShardingConfig.layerFromEnv
```

---

## See also

- **Chapter 28 — Type-safe RPC with @effect/rpc** (`../part-2-tour/28-rpc.md`): `Entity.make` reuses `Rpc` and `RpcGroup` definitions verbatim. Every message type in this chapter is declared the same way as an RPC definition in Chapter 28.
- **Chapter 29 — Durable workflows with @effect/workflow** (`../part-2-tour/29-workflow.md`): `@effect/cluster` provides `ClusterWorkflowEngine.layer`, which maps every Workflow definition onto a sharded entity. If your use case is multi-step business logic rather than plain actors, `@effect/workflow` is the higher-level API.
- **Chapter 09 — Layer** (`../part-1-foundations/09-layer.md`): Every cluster component — `Sharding.layer`, `SingleRunner.layer`, `MessageStorage.layerMemory` — follows the `Layer` composition model from Chapter 09. Understanding `Layer.provide`, `Layer.merge`, and `Layer.scoped` is a prerequisite.
- **Chapter 25 — SQL part 1** (`../part-2-tour/25-sql-core.md`): `SqlMessageStorage.layer` and `SqlRunnerStorage.layer` depend on `@effect/sql`. Chapter 25 covers the SQL abstraction layer that those backends build on.
- **[LayerMap — keyed map of layers](../../research/02-patterns-catalog.md#layermap--keyed-map-of-layers-per-tenant--per-request):** The patterns catalog entry for `LayerMap` covers the per-tenant use-case, the `idleTimeToLive` option, and its relationship to `RcMap`. The cluster application shown in this chapter is the distributed-systems variant of that pattern.
- **[RcRef and RcMap](../../research/02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources):** `LayerMap` is built on `RcMap` internally. The patterns catalog entry explains reference counting and TTL semantics that `LayerMap`'s `idleTimeToLive` option inherits.
- **`research/packages/cluster.md`:** The per-package research note for `@effect/cluster`. It covers `ClusterCron`, `ClusterWorkflowEngine`, `K8sHttpClient`, the shard locking mechanism, and the `DeliverAt` protocol not addressed in this chapter.
