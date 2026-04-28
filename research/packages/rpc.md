# @effect/rpc

> Source: `repos/effect/packages/rpc/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`

## What it does

`@effect/rpc` lets you define a typed contract — a set of named procedures each with schema-described request payloads and response types — once in shared code, then derive both a server handler layer and a client call surface from that same definition, with zero code generation. Without this package, you would hand-write matching fetch wrappers and server route handlers, drift them apart at each schema change, and lose streaming return types entirely at the boundary. The package targets full-stack TypeScript applications (or any client/server pair in the same monorepo) where end-to-end type safety and streaming responses matter.

## Public API surface

All modules are re-exported from `repos/effect/packages/rpc/src/index.ts:1-54`.

- **`Rpc`** (`src/Rpc.ts`) — the primitive unit of contract definition. `Rpc.make("Tag", { payload, success, error, stream })` produces an immutable descriptor carrying its `payloadSchema`, `successSchema`, `errorSchema`, and `middlewares` set. Also exports the `fork` / `uninterruptible` wrappers that control per-handler execution strategy.

- **`RpcGroup`** (`src/RpcGroup.ts`) — a named collection of `Rpc` descriptors. `RpcGroup.make(...rpcs)` stores them in a `ReadonlyMap<string, Rpc.Any>`. The group exposes `.toLayer(handlers)` and `.toLayerHandler(tag, handler)` to turn implementations into Effect `Layer`s, and `.accessHandler(tag)` to look one up at runtime.

- **`RpcServer`** (`src/RpcServer.ts`) — the server runtime. `RpcServer.layer(group)` wires the group's handler layers to a `Protocol` service, serializes/deserializes messages, manages per-client fiber sets, and propagates distributed traces. Also exposes `toHttpApp`, `toHttpAppWebsocket`, `toWebHandler`, and a family of `layerProtocol*` helpers (HTTP, WebSocket, SocketServer, WorkerRunner, stdio).

- **`RpcClient`** (`src/RpcClient.ts`) — the client runtime. `RpcClient.make(group)` returns a typed proxy object whose methods mirror the group's tags. Effect RPCs return `Effect<Success, Error | RpcClientError>`. Stream RPCs return `Stream<A, E | RpcClientError>` or, with `{ asMailbox: true }`, a scoped `Mailbox`. Also exports `withHeaders` / `withHeadersEffect` and a family of `layerProtocol*` helpers (HTTP, WebSocket socket, Worker pool).

- **`RpcSerialization`** (`src/RpcSerialization.ts`) — pluggable wire format. Ships `layerJson`, `layerNdjson`, `layerMsgPack`, `layerJsonRpc`, `layerNdJsonRpc`. Each implements `unsafeMake() => Parser` where `Parser` provides `decode` / `encode`. `msgpackr` is a hard runtime dependency for the MessagePack variant.

- **`RpcMiddleware`** (`src/RpcMiddleware.ts`) — cross-cutting concerns. `RpcMiddleware.Tag<Self>()("Name", options)` declares a middleware tag carrying typed `provides`, `failure`, `optional`, `wrap`, and `requiredForClient` flags. `layerClient` builds a `ForClient<Id>` layer that mutates outgoing `Request` objects (e.g., injecting auth headers).

- **`RpcMessage`** (`src/RpcMessage.ts`) — wire types only. Defines `FromClient`, `FromServer`, `Request`, `Ack`, `Interrupt`, `Eof`, `Chunk`, `Exit`, `Defect`, and encoded variants. Not typically consumed directly.

- **`RpcSchema`** (`src/RpcSchema.ts`) — the `Stream` schema sentinel. `RpcSchema.Stream({ success, failure })` creates a `Schema.declare`-based marker that the server and client inspect via `isStreamSchema` to decide whether to pipe chunks or resolve a single value.

- **`RpcTest`** (`src/RpcTest.ts`) — in-process test helper. `RpcTest.makeClient(group)` wires `makeNoSerialization` server and client together in memory, so unit tests can exercise handlers without any network protocol.

- **`RpcWorker`** (`src/RpcWorker.ts`) — Worker thread transport scaffolding. Provides `InitialMessage` context tag used when a client opens a worker with bootstrap data.

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `Rpc.make`, `RpcGroup.make`, `RpcClient.make`, `RpcServer.make` all follow the module-level factory convention; `repos/effect/packages/rpc/src/Rpc.ts:645-696`, `repos/effect/packages/rpc/src/RpcGroup.ts:368-374`.

- [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `RpcGroup.toLayer` calls `Layer.scopedContext`; `RpcServer.layer` calls `Layer.scopedDiscard`; serialization layers use `Layer.succeed`; `repos/effect/packages/rpc/src/RpcGroup.ts:285-287`, `repos/effect/packages/rpc/src/RpcServer.ts:736-752`.

- [`Layer.merge` / `provide` / `fresh` — Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `RpcServer.layerHttpRouter` composes the server layer on top of a protocol layer via `Layer.provide`; `repos/effect/packages/rpc/src/RpcServer.ts:763-787`.

- [`Context.GenericTag` / `Tag` class / `Reference` — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `RpcServer.Protocol` and `RpcClient.Protocol` are `Context.Tag` classes; middleware tags extend the same pattern; `repos/effect/packages/rpc/src/RpcServer.ts:793-813`, `repos/effect/packages/rpc/src/RpcClient.ts:820-834`.

- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — all multi-step construction (server loop, client request lifecycle, socket protocol) uses `Effect.gen`; `repos/effect/packages/rpc/src/RpcServer.ts:484-730`.

- [`Effect.fn` (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — `makeNoSerialization`, `make`, `makeProtocol*` are declared with `Effect.fnUntraced` to avoid double-spans on internal helpers; `repos/effect/packages/rpc/src/RpcServer.ts:88`, `repos/effect/packages/rpc/src/RpcClient.ts:228`.

- [`Schema.Struct`](../02-patterns-catalog.md#schemastruct) — payload schemas are passed as plain `Schema.Struct.Fields` objects and promoted to `Schema.Struct` internally; `repos/effect/packages/rpc/src/Rpc.ts:668-681`.

- [`Schema.Class` and `Schema.TaggedClass`](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — `RpcGroup` subclasses use `class Foo extends RpcGroup.make(...){}` to gain a nominal type; the README pattern at `repos/effect/packages/rpc/README.md:28-47`.

- [`Mailbox` — ordered message inbox](../02-patterns-catalog.md#mailbox--ordered-message-inbox) — stream chunks are backpressured through `Mailbox`; client stream requests resolve to `Mailbox.ReadonlyMailbox`; `repos/effect/packages/rpc/src/RpcClient.ts:454-488`, `repos/effect/packages/rpc/src/RpcServer.ts:356-403`.

- [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](../02-patterns-catalog.md#poolmake--poolmaketttl-and-keyedpool) — worker client protocol uses `Pool.make` / `Pool.makeWithTTL` to manage a pool of backing workers; `repos/effect/packages/rpc/src/RpcClient.ts:1162-1176`.

- [`FiberSet` / `FiberMap` / `FiberHandle` — fiber lifecycle tracking](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `makeNoSerialization` in the server uses `FiberSet.make` to track in-flight request fibers and clean them up on scope close; `repos/effect/packages/rpc/src/RpcServer.ts:109-110`.

- [`Effect.withSpan` / `annotateCurrentSpan` — distributed tracing](../02-patterns-catalog.md#effectwithspan--annotatecurrentspan--distributed-tracing) — each request gets a named span; the parent span/trace IDs are propagated from the wire if present; `repos/effect/packages/rpc/src/RpcServer.ts:293-318`.

- [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](../02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) — socket client reconnect uses an exponential-union-spaced schedule; `repos/effect/packages/rpc/src/RpcClient.ts:1047-1049`.

- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — `src/internal/utils.ts` hosts `withRun`, not re-exported; all public modules are namespace-re-exported from `index.ts`; `repos/effect/packages/rpc/src/index.ts:1-54`.

## What's unique about this package's design

The defining technique is using `Schema` as the single source of truth for both the wire representation and the in-process type. When `Rpc.make("UserById", { payload: { id: Schema.String }, success: User, error: Schema.String })` is called, the server path calls `Schema.decodeUnknown(rpc.payloadSchema)` on the raw bytes and `Schema.encodeUnknown(Rpc.exitSchema(rpc))` on the result (`repos/effect/packages/rpc/src/RpcServer.ts:563-580`); the client path calls `Schema.encode(rpc.payloadSchema)` before sending and `Schema.decode(Rpc.exitSchema(entry.rpc))` on the response (`repos/effect/packages/rpc/src/RpcClient.ts:674-745`). There is no interface duplication and no code-generation step.

The second distinctive decision is the `RpcSchema.Stream` sentinel. Rather than a separate API for streaming calls, the same `Rpc.make` factory accepts `stream: true`, which wraps the success schema in a `Schema.declare`-based marker (`repos/effect/packages/rpc/src/RpcSchema.ts:17-93`). The server detects this marker with `RpcSchema.isStreamSchema` and runs `streamEffect` instead of a plain `Effect` handler (`repos/effect/packages/rpc/src/RpcServer.ts:244`). The client detects it and returns a `Stream` instead of a single `Effect` (`repos/effect/packages/rpc/src/RpcClient.ts:289-327`). Streaming and non-streaming RPCs therefore share the entire protocol stack.

The `Protocol` context tag pattern (one tag for server, one for client) decouples transport from logic entirely. Swapping HTTP for WebSockets or for a Worker thread requires only swapping the `Protocol` layer; the `RpcServer.make` / `RpcClient.make` core loop is unchanged (`repos/effect/packages/rpc/src/RpcServer.ts:793-813`, `repos/effect/packages/rpc/src/RpcClient.ts:820-834`).

## Conventions observed

- File layout matches the standard Effect package layout: `src/` with one file per module, no public `internal/` folder re-exports, a single `index.ts` barrel of `export * as X from "./X.js"`.
- All `@since` tags are `1.0.0` — this package versioned independently from the main `effect` package.
- Every constructor module-function (`Rpc.make`, `RpcGroup.make`, `RpcClient.make`) is a function, not a class; the `class Foo extends RpcGroup.make(...){}` idiom is a consumer convention for nominal subtyping, not an internal implementation requirement.
- The two `Protocol` tags (`RpcServer.Protocol`, `RpcClient.Protocol`) follow the `Context.Tag` class pattern with a static `.make` helper powered by an internal `withRun` utility (`repos/effect/packages/rpc/src/RpcServer.ts:813`, `repos/effect/packages/rpc/src/RpcClient.ts:834`); this is a unique bootstrapping pattern not present in core.
- Error handling: `RpcClientError` is a `Data.TaggedError`-derived class with `reason` and `message` fields; defects propagate as `Schema.Defect`-encoded values; the server distinguishes client-originated interruption (`fiberIdClientInterrupt = FiberId.make(-499, 0)`) from transient interruption (`fiberIdTransientInterrupt = FiberId.make(-503, 0)`) via reserved negative fiber IDs (`repos/effect/packages/rpc/src/RpcServer.ts:1420-1428`).
- Serialization is injected via the `RpcSerialization` context tag rather than being hardcoded; the `includesFraming` flag tells the server whether it must handle message boundaries itself (`repos/effect/packages/rpc/src/RpcSerialization.ts:14-18`).

## "If you were authoring something similar, copy this"

- **Schema as the only source of truth for both encode and decode.** Store schemas on your descriptor type, derive both serialization and type inference from them. Never write separate encode/decode pairs. (`repos/effect/packages/rpc/src/RpcServer.ts:563-580`, `repos/effect/packages/rpc/src/RpcClient.ts:674-685`.)

- **Use a `Schema.declare` sentinel to mark variant return shapes.** Instead of a separate streaming API surface, attach a unique symbol annotation to the schema and inspect it at runtime with a guard (`isStreamSchema`). Every layer of the stack — client, server, serialization — reads the same flag. (`repos/effect/packages/rpc/src/RpcSchema.ts:17-24`.)

- **Decouple transport behind a single `Protocol` tag.** Define one context tag whose service describes `send`, `run`, `disconnects`, and capability flags (`supportsAck`, `supportsTransferables`, `supportsSpanPropagation`). Add new transports without touching the business logic. (`repos/effect/packages/rpc/src/RpcServer.ts:793-813`.)

- **Use reserved negative `FiberId` values to classify interruption cause.** Distinguish server-shutdown interruption from client-explicit cancellation by tagging fibers with known negative IDs, making `Cause` inspection at the handler level precise. (`repos/effect/packages/rpc/src/RpcServer.ts:1420-1428`.)

- **`RpcTest.makeClient` pattern for in-memory testing.** Wire server and client `makeNoSerialization` together in a single `Effect.gen` with no protocol layer. Tests run at full type safety with zero network. (`repos/effect/packages/rpc/src/RpcTest.ts:15-41`.)

- **`toHandlersContext` / `toLayer` separation.** Expose both a raw `Context` builder and a `Layer` wrapper for the handler map, so callers with unusual composition needs can use the context variant. (`repos/effect/packages/rpc/src/RpcGroup.ts:69-100`.)

## Open questions

- **Batching across requests.** The HTTP protocol sends one request per RPC call. The `jsonRpc` serialization has batch-accumulation logic (`repos/effect/packages/rpc/src/RpcSerialization.ts:89-118`), but it is not clear whether the server will coalesce multiple concurrent HTTP requests from the same logical client session, or whether that requires the WebSocket/socket transport.
- **Backpressure limits for non-ack transports.** The HTTP protocol sets `supportsAck: false` (`repos/effect/packages/rpc/src/RpcServer.ts:1077`), which disables the latch in `streamEffect`. There is no apparent alternative backpressure mechanism for slow HTTP consumers; it is unclear whether stream chunks can pile up unboundedly in the `Mailbox` in that case.
- **`RpcGroup.merge` annotation semantics.** `.merge` merges `requests` and `annotations` maps from both groups (`repos/effect/packages/rpc/src/RpcGroup.ts:231-247`); it is unclear whether middleware attached to one group's RPCs is preserved when the merged group adds new middleware at the group level.
- **`Rpc.wrap` / `Rpc.fork` interaction with concurrency semaphore.** A handler returning `Rpc.fork(effect)` bypasses the `concurrencySemaphore` (`repos/effect/packages/rpc/src/RpcServer.ts:319`). The interaction with `concurrency: 1` and forked handlers is not documented; it may allow unbounded concurrency even when a limit is set.
