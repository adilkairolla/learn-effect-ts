# @effect/platform-node

> Source: `repos/effect/packages/platform-node/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: platform
> Effect deps (peers): `effect`, `@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`; runtime dep: `@effect/platform-node-shared`

## What it does

`@effect/platform-node` is the Node.js implementation of every abstract service defined in `@effect/platform`. Application authors import it as the concrete runtime binding that wires `node:http`, `node:fs`, `node:worker_threads`, and `node:child_process` into Effect's portable service interfaces. Without it, you hand-roll the bridging of callback-based Node APIs into the fiber model, manage SIGINT/SIGTERM, and handle connection lifecycles manually. It is a depth-6 leaf — every abstraction layer is resolved before this package runs.

Most `src/` files are thin re-export shims into `@effect/platform-node-shared` (shared with `@effect/platform-bun`); only Node-specific concerns — HTTP server lifecycle, WebSocket upgrades, Undici client, cluster layers — live here. See `repos/effect/packages/platform-node/package.json:53-55`.

## Public API surface

All 21 public modules are re-exported as named namespaces from `repos/effect/packages/platform-node/src/index.ts:1-104`.

**Runtime entry point**

- `NodeRuntime` (`src/NodeRuntime.ts:1-11`) — re-exports `runMain`. Every Node.js Effect app calls this at its top level; it registers SIGINT/SIGTERM handlers, installs a keep-alive timer, and derives an exit code from the fiber's `Exit`. Full implementation at `repos/effect/packages/platform-node-shared/src/internal/runtime.ts:5-34`.

**Omnibus context layer**

- `NodeContext` (`src/NodeContext.ts:1-40`) — merges `FileSystem`, `Path`, `CommandExecutor`, `Terminal`, and `Worker.WorkerManager` into one `Layer<NodeContext>`. One import satisfies all standard platform requirements; the five services are named explicitly in the type alias at `src/NodeContext.ts:21-27`.

**HTTP server**

- `NodeHttpServer` (`src/NodeHttpServer.ts:1-134`) — `layer` wraps a lazy `Http.Server` factory into a `Layer.scoped` that also bundles `HttpPlatform`, `Etag.Generator`, and `NodeContext`; cleanup calls `server.close` and `wss.close` — `repos/effect/packages/platform-node/src/internal/httpServer.ts:47-87`. `layerTest` starts a port-0 server and injects a pre-configured `HttpClient` for in-process integration tests.

**HTTP client (two backends)**

- `NodeHttpClient` (`src/NodeHttpClient.ts:1-139`) — default backend manages `Http.Agent`/`Https.Agent` via `Effect.acquireRelease` (`repos/effect/packages/platform-node/src/internal/httpClient.ts:31-48`). The `layerUndici` backend routes through an `undici` `Dispatcher` exposed as a context tag, so callers can inject a custom pool, mock, or proxy (`repos/effect/packages/platform-node/src/internal/httpClientUndici.ts:23-37`).

**File system, path, and key-value**

- `NodeFileSystem` (`src/NodeFileSystem.ts:1-12`) — thin re-export of `@effect/platform-node-shared/NodeFileSystem`. The real implementation lives in `repos/effect/packages/platform-node-shared/src/internal/fileSystem.ts` where every `node:fs` callback is lifted with the `effectify` helper into a typed `Effect` and every `errno` maps to a `PlatformError`.
- `NodePath` / `NodeKeyValueStore` — re-exports of shared layers; `NodeKeyValueStore.layerFileSystem` provides a filesystem-backed `KeyValueStore`.

**Workers**

- `NodeWorker` (`src/NodeWorker.ts:1-36`) — `platformWorkerImpl` at `repos/effect/packages/platform-node/src/internal/worker.ts:11-69` normalises both `WorkerThreads.Worker` and `ChildProcess.ChildProcess` to a common `postMessage`/`kill` interface. Shutdown awaits `exit` via `Deferred` with a 5-second timeout before `SIGKILL`.
- `NodeWorkerRunner` (`src/NodeWorkerRunner.ts:1-20`) — runner-side counterpart; provides `PlatformRunner` and re-exports `launch`.

**Sockets, streams, terminal, commands**

- `NodeSocket` (`src/NodeSocket.ts:28-36`) — adds `layerWebSocketConstructor` which probes `globalThis.WebSocket` first, falls back to `ws`. Works transparently across Node 18–22+.
- `NodeStream` / `NodeSink` / `NodeSocketServer` / `NodeMultipart` / `NodeTerminal` / `NodeCommandExecutor` — re-exports of shared implementations.

**Cluster integration**

- `NodeClusterHttp` (`src/NodeClusterHttp.ts:1-138`) — one `layer()` call wires HTTP or WebSocket transport, SQL storage, `msgpack`/`ndjson` serialization, and K8s health checks by composing `NodeHttpServer`, `NodeHttpClient`, `NodeSocket`, and `@effect/cluster`.

**Undici re-exports**

- `Undici` (`src/Undici.ts`) — re-exports `undici` types so consumers need not depend on `undici` directly.

## Patterns used

- [Layer.succeed / effect / scoped](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `Layer.scoped(Server.HttpServer, make(...))` at `repos/effect/packages/platform-node/src/internal/httpServer.ts:322-325` is the canonical scoped resource layer: server socket is `acquireRelease`-d inside `make`, then lifted into the DI graph.
- [Layer.merge / provide / fresh](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `NodeContext.layer` at `repos/effect/packages/platform-node/src/NodeContext.ts:32-39` composes five independent service layers with `Layer.mergeAll` + `Layer.provideMerge` into one named layer.
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — the HTTP agent (`repos/effect/packages/platform-node/src/internal/httpClient.ts:33-46`) and the HTTP server (`repos/effect/packages/platform-node/src/internal/httpServer.ts:47-61`) both pair construction with cleanup inside a `Scope`.
- [Effect.succeed / fail / sync / promise / tryPromise](../02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise) — `effectify` in `platform-node-shared/src/internal/fileSystem.ts:1` wraps every `node:fs` callback into a typed `Effect`, mapping `ErrnoException` to `PlatformError`.
- [Effect.runPromise / runSync / runFork](../02-patterns-catalog.md#effectrunpromise--runsync--runfork) — `NodeRuntime.runMain` calls `Runtime.runFork` internally at `repos/effect/packages/platform-node-shared/src/internal/runtime.ts:5-34` to start the main fiber with SIGINT/SIGTERM handling.

## What's unique about this package's design

The central design lesson is **two-tier delegation**: `platform-node` is the public face, but `platform-node-shared` holds the actual implementation. Every module in `src/` is either a one-line re-export or a thin shim adding Node-only extras (WebSocket constructor fallback, Undici dispatcher, cluster layers). This split lets `@effect/platform-bun` consume the same shared internals; creating a new runtime target means authoring only a thin public façade. See `repos/effect/packages/platform-node/src/NodeFileSystem.ts:1-12` for the minimal re-export form.

The **WebSocket constructor normalisation** in `repos/effect/packages/platform-node/src/NodeSocket.ts:28-36` probes `globalThis.WebSocket` at layer-construction time and falls back to the `ws` package if absent. The caller is unaffected by the Node version — a pattern worth copying whenever a Node built-in is only available above a certain version.

The HTTP server's **per-request fiber isolation** is a third distinctive choice. `makeHandler` at `repos/effect/packages/platform-node/src/internal/httpServer.ts:136-158` captures a runtime snapshot once, then forks a new fiber per request. Each fiber is interrupted via `fiber.unsafeInterruptAsFork(Error.clientAbortFiberId)` when the response closes, giving free connection-abort propagation with no `AbortController` wiring.

## Conventions observed

- **All public modules are namespace re-exports.** `repos/effect/packages/platform-node/src/index.ts:1-104` exports every module as `export * as NodeXxx`. Callers import `NodeRuntime.runMain`, never a bare `runMain`.
- **`internal/` is hard-blocked from consumers.** `repos/effect/packages/platform-node/package.json:42` sets `"./internal/*": null` in the `exports` map, preventing any deep import of implementation details.
- **Layer naming: `layer` = batteries-included; `layerServer`/`layerWorker` = single-service.** `NodeHttpServer.layerServer` provides only `HttpServer`; `NodeHttpServer.layer` bundles four services — `repos/effect/packages/platform-node/src/NodeHttpServer.ts:62-75`.
- **Peers for Effect siblings, one runtime dep for the shared internal.** `repos/effect/packages/platform-node/package.json:53-65` — `@effect/platform-node-shared` is a true `dependency` because it is an opaque implementation detail; all other Effect siblings are `peerDependencies`.

## "If you were authoring something similar, copy this"

- **Extract a `*-shared` package first.** `NodeFileSystem`, `NodeStream`, `NodeSink`, `NodeCommandExecutor`, and `NodeTerminal` all live in `platform-node-shared` and are re-exported unchanged here. Avoids divergence when adding a second runtime target. `repos/effect/packages/platform-node/src/NodeFileSystem.ts:1-12`.
- **`Layer.scoped` for everything with a destructor.** HTTP server, both HTTP client backends, and the WebSocket server all use `Effect.acquireRelease` paired with `Layer.scoped` — no naked `.close()` outside a scope. `repos/effect/packages/platform-node/src/internal/httpServer.ts:41-119`.
- **Per-request fiber isolation.** Capture `Effect.runtime<R>()` once, then `Runtime.runFork(runtime)` per request. A `"close"` listener on `nodeResponse` calls `fiber.unsafeInterruptAsFork` on client disconnect. `repos/effect/packages/platform-node/src/internal/httpServer.ts:138-157`.
- **`layerTest` for in-process integration tests.** Port 0, real server, pre-configured `HttpClient`. `repos/effect/packages/platform-node/src/internal/httpServer.ts:344-349`.
- **Graceful worker shutdown.** Send terminate signal, await `exit` via `Deferred`, `Effect.timeout(5000)`, then `SIGKILL`. `repos/effect/packages/platform-node/src/internal/worker.ts:33-45`.
- **Keep-alive via `setInterval(constVoid, 2**31 - 1)`.** Prevents Node.js from exiting before the main fiber completes; cleared in the observer. `repos/effect/packages/platform-node-shared/src/internal/runtime.ts:9`.

## Open questions

1. **Cluster layer Node-only?** `NodeClusterHttp` has no counterpart in `@effect/platform-bun`. Is this intentional or simply unimplemented?
2. **`layerUndici` vs `layer`.** `NodeHttpClient.layer` uses `node:http`/`node:https` agents; `layerTest` uses Undici. The performance/compatibility trade-offs are undocumented.
3. **`FiberSet.makeRuntime` in the upgrade handler.** `repos/effect/packages/platform-node/src/internal/httpServer.ts:161-208` uses `FiberSet.makeRuntime` rather than `Effect.runtime` + `Runtime.runFork`. The lifecycle difference between these two paths is not yet clear.
4. **Hardcoded 10 MB body limit.** `IncomingMessage.MaxBodySize` is set unconditionally at `repos/effect/packages/platform-node/src/internal/httpServer.ts:115-118`. There is no public API to override it per-server.
5. **`NodeClusterSocket.layerK8sHttpClient` internals.** Its implementation was not fully traced — likely configures an `HttpClient` targeting the Kubernetes API; worth revisiting when documenting `@effect/cluster`.
