# @effect/platform-bun

> Source: `repos/effect/packages/platform-bun/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: platform
> Effect deps: `@effect/platform-node-shared` (runtime dependency); peers: `@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`, `effect`

## What it does

`@effect/platform-bun` provides Bun-runtime implementations of every abstract service interface defined by `@effect/platform`. Application authors swap `BunContext.layer` for `NodeContext.layer` and `BunHttpServer.layer` for `NodeHttpServer.layer` without touching business logic. The package uses Bun-native APIs where they matter — `Bun.serve` for the HTTP server, `Bun.file` for zero-copy file serving, the global `WebSocket` for client sockets — and delegates eleven of nineteen modules directly to `@effect/platform-node-shared` to avoid duplication.

## Public API surface

All modules are re-exported as namespaces from `repos/effect/packages/platform-bun/src/index.ts:1-94`.

**HTTP server (Bun-native)**

- `BunHttpServer` (`src/BunHttpServer.ts:1-96`) — wraps `Bun.serve` via `make` / `layer` / `layerServer` / `layerConfig` / `layerTest` / `layerContext`. `ServeOptions` (`src/BunHttpServer.ts:22-29`) composites Bun's four serve-option variants plus an optional typed route map.
- `BunHttpPlatform` (`src/BunHttpPlatform.ts:1-22`) — the `HttpPlatform` service. Uses `Bun.file(path).slice(start, end)` for ranged file serving (`src/internal/httpPlatform.ts:10-16`).
- `BunMultipart` (`src/BunMultipart.ts:1-26`) — `stream` and `persisted`. Uses `multipasta/web` (Web Streams) and `Bun.file(path).writer()` for efficient disk writes (`src/internal/multipart.ts:32-52`).
- `BunHttpServerRequest` (`src/BunHttpServerRequest.ts:1-12`) — `toRequest` casts an Effect `HttpServerRequest` back to Bun's raw `Request` for interop.

**Delegated to `@effect/platform-node-shared`**

Eleven modules are direct re-exports because Bun's Node compatibility makes them identical: `BunFileSystem` (`src/BunFileSystem.ts:4`), `BunFileSystem/ParcelWatcher` (`src/BunFileSystem/ParcelWatcher.ts:4`), `BunCommandExecutor` (`src/BunCommandExecutor.ts:4`), `BunPath` (`src/BunPath.ts:5-6`), `BunTerminal` (`src/BunTerminal.ts:4`), `BunRuntime` (`src/BunRuntime.ts:4`), `BunStream` (`src/BunStream.ts:7`), `BunSink` (`src/BunSink.ts:7`), `BunSocketServer` (`src/BunSocketServer.ts:7`), `BunKeyValueStore` (`src/BunKeyValueStore.ts:4`), and the socket client base in `BunSocket` (`src/BunSocket.ts:10`).

**Context, sockets, workers, cluster**

- `BunContext` (`src/BunContext.ts:1-40`) — a single `Layer<BunContext>` bundling `FileSystem`, `Path`, `CommandExecutor`, `Terminal`, and `WorkerManager`.
- `BunSocket` (`src/BunSocket.ts:17-30`) — adds `layerWebSocket` / `layerWebSocketConstructor` using Bun's global `WebSocket`.
- `BunWorker` / `BunWorkerRunner` (`src/BunWorker.ts`, `src/BunWorkerRunner.ts`) — Web Worker `MessageEvent` protocol; the runner listens on `self` (a `MessagePort`) using `postMessage` with the same `[0, payload]` / `[1]` framing as `platform-node` (`src/internal/workerRunner.ts:74-76`).
- `BunClusterHttp` / `BunClusterSocket` (`src/BunClusterHttp.ts`, `src/BunClusterSocket.ts`) — compose `BunHttpServer` and the shared socket server into full `@effect/cluster` node layers.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `BunHttpServer.layerServer` uses `Layer.scoped` because `Bun.serve` returns a handle that must be stopped on finalization (`src/internal/httpServer.ts:168-170`).
- [Layer.merge / provide / fresh — Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `BunContext.layer` composes five sub-layers with `Layer.mergeAll` + `Layer.provideMerge` (`src/BunContext.ts:32-39`).
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `Effect.addFinalizer` registers `server.stop()` inside the scoped effect (`src/internal/httpServer.ts:66-70`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` sequences server creation, handler registration, and finalization in one generator (`src/internal/httpServer.ts:36-110`).
- [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `FiberSet.makeRuntime` manages per-request fibers (`src/internal/httpServer.ts:76`); `FiberSet.make` again in the WebSocket upgrade path (`src/internal/httpServer.ts:429`).
- [Deferred — one-shot async value](../02-patterns-catalog.md#deferred--one-shot-async-value) — two `Deferred` values gate the WebSocket upgrade: one awaits the `ServerWebSocket`, one detects close (`src/internal/httpServer.ts:385-409`).
- [The internal/ folder and index.ts re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — public modules expose only types and delegate to `src/internal/` (`src/BunHttpServer.ts:17`, `src/BunHttpPlatform.ts:9`).

## What's unique about this package's design

The central design decision is the **hot-reload handler stack**. `Bun.serve` needs a `fetch` function at construction, but Effect's server can only produce the real handler after the `Layer` resolves. The solution (`src/internal/httpServer.ts:40-105`): start with a 404-stub `handlerStack`, then push the real handler and call `server.reload({ fetch: handler })`; pop it on scope finalization. This makes `layerTest` work at port 0 without restarting the process.

The second choice is **maximising delegation to `@effect/platform-node-shared`**: eleven of nineteen modules are one-line re-exports, making divergence points explicit. Only `internal/httpServer.ts`, `internal/httpPlatform.ts`, `internal/multipart.ts`, `BunSocket.ts`, and the worker/runner pair contain Bun-specific logic.

Third, the **`Bun.file` zero-copy response** (`src/internal/httpPlatform.ts:10-16`) returns `ServerResponse.raw(Bun.file(path))` — Bun detects `BunFile` as a body and uses sendfile-equivalent syscalls, bypassing stream overhead entirely.

## Conventions observed

The package follows all conventions in `research/03-conventions.md`. Specific observations:

- **Thin public modules**: All five non-trivial implementations live in `src/internal/` (`httpServer.ts`, `httpPlatform.ts`, `multipart.ts`, `worker.ts`, `workerRunner.ts`). Every public `.ts` is under 100 lines. `package.json:39` blocks `"./internal/*"` from external import.
- **`Bun` global, not imported**: Internal files reference `Bun.serve` / `Bun.file` as ambient globals. The only Bun type import is `import type * as Bun from "bun"` at `src/BunHttpServer.ts:9`.
- **Re-export vs. re-implement**: Only `internal/httpServer.ts`, `internal/httpPlatform.ts`, and `internal/multipart.ts` contain Bun-specific logic. Everything else re-exports `@effect/platform-node-shared` directly.
- **`multipasta/web`** (`src/internal/multipart.ts:9`): Uses the Web Streams variant (not Node streams), consistent with Bun's Web API surface.
- **Worker protocol** (`src/internal/workerRunner.ts:74-76`): The `[0, payload]` / `[1]` framing matches `platform-node-shared`, so workers authored for one runtime run on both.

## "If you were authoring something similar, copy this"

- **Mutable handler stack for hot-reload.** `src/internal/httpServer.ts:40-105`: start with a 404 stub, push the real handler via `server.reload({ fetch: handler })`, pop on scope close. Portable to any runtime whose server object is expensive to restart.
- **`<Runtime>Context` single-layer bootstrap.** `src/BunContext.ts:32-39` merges five OS-level services into one importable layer — one `provide` in `main` instead of five.
- **Delegate, don't copy.** `src/BunFileSystem.ts:4-5` and ten peers are single-line re-exports from `@effect/platform-node-shared`. Re-implement only the genuinely divergent APIs.
- **`Bun.file().writer()` for multipart writes.** `src/internal/multipart.ts:36-51` uses `FileSink` with `readMany()` batching — faster than piping through a Node `WriteStream`.

## Open questions

1. **No `BunHttpClient`.** `@effect/platform-node` ships `NodeHttpClient` backed by `node:http`/`undici`. Bun falls back to `FetchHttpClient`. Is this intentional (Bun's `fetch` is fast) or a gap?
2. **K8s runner health blocked.** `BunClusterHttp.ts:88-93` has a `TODO`: Bun does not yet support custom CA certificates, which blocks `RunnerHealth.layerK8s`. Worth tracking for production cluster deployments.
3. **Worker shutdown semantics.** `src/internal/worker.ts:24-27` uses `timeout(5000)` then `worker.terminate()`. Bun's `Worker` spec compliance around `terminate()` vs `close()` should be validated under load.
4. **`server.reload` is Bun-exclusive.** The hot-reload handler stack depends on `Bun.Server.reload()`, which has no Node.js equivalent — explaining why `internal/httpServer.ts` cannot move to `platform-node-shared` despite structural similarity to Node's HTTP server setup.
