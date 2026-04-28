# @effect/platform-node-shared

> Source: `repos/effect/packages/platform-node-shared/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: platform (internal infrastructure shared between platform-node and platform-bun)
> Effect deps: `effect`, `@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`

## What it does

`@effect/platform-node-shared` holds every platform-service implementation that runs identically on Node.js and Bun. Both `@effect/platform-node` and `@effect/platform-bun` declare it as a direct dependency (`repos/effect/packages/platform-node/package.json:51`, `repos/effect/packages/platform-bun/package.json:56`). End-users should import from one of those packages, not this one. Without this factoring, filesystem, socket, child-process, multipart, and terminal implementations would be duplicated. The factoring criterion is "uses only Node.js APIs that Bun also implements" (`node:net`, `node:fs`, `node:path`, `node:child_process`, `node:readline`). Two native dependencies are also shared: `@parcel/watcher` and `multipasta` (`repos/effect/packages/platform-node-shared/package.json:51-54`).

## Public API surface

Sub-paths declared in `repos/effect/packages/platform-node-shared/package.json:35-40`; internal modules blocked via `"./internal/*": null`.

**Filesystem and Path**
- `NodeFileSystem` (`src/NodeFileSystem.ts:13`) — `layer: Layer<FileSystem>` via `node:fs` + `effectify`.
- `NodeFileSystem/ParcelWatcher` (`src/NodeFileSystem/ParcelWatcher.ts:14`) — `layer: Layer<WatchBackend>` backed by `@parcel/watcher`.
- `NodePath` (`src/NodePath.ts:13-25`) — `layer`, `layerPosix`, `layerWin32` over `node:path`.
- `NodeKeyValueStore` (`src/NodeKeyValueStore.ts:14-20`) — `layerFileSystem(dir)` pre-wired with the Node fs and path layers.

**Streams and Sinks**
- `NodeStream` (`src/NodeStream.ts:38-154`) — `fromReadable`, `fromReadableChannel`, `fromDuplex`, `pipeThroughDuplex`, `toReadable`, `toString`, `toUint8Array`; prebuilt `stdin`/`stdout`/`stderr`.
- `NodeSink` (`src/NodeSink.ts:19-77`) — `fromWritable`, `fromWritableChannel`; prebuilt `stdin`/`stdout`/`stderr` sinks.

**Sockets and Servers**
- `NodeSocket` (`src/NodeSocket.ts:38-222`) — `makeNet`, `fromDuplex`, `makeNetChannel`, `layerNet`; `NetSocket` context tag (`src/NodeSocket.ts:30`) exposes the raw `Net.Socket` to handlers.
- `NodeSocketServer` (`src/NodeSocketServer.ts:34-256`) — TCP (`make`, `layer`) and WebSocket (`makeWebSocket`, `layerWebSocket`) servers; `IncomingMessage` tag (`src/NodeSocketServer.ts:26-28`) exposes the HTTP-upgrade request.

**Process, Runtime, and Cluster**
- `NodeCommandExecutor` (`src/NodeCommandExecutor.ts:13`) — `layer: Layer<CommandExecutor, never, FileSystem>` via `node:child_process`.
- `NodeRuntime` (`src/NodeRuntime.ts:11`) — `runMain` with `SIGINT`/`SIGTERM` and keep-alive (`src/internal/runtime.ts:9`).
- `NodeTerminal` (`src/NodeTerminal.ts:13-20`) — `make` and `layer` for `Terminal` via `node:readline`.
- `NodeMultipart` (`src/NodeMultipart.ts:19-40`) — `stream` → `Stream<Multipart.Part, MultipartError>`; `persisted` writes parts to disk.
- `NodeClusterSocket` (`src/NodeClusterSocket.ts:20-57`) — wires `@effect/cluster` `RpcClientProtocol` and `ShardingConfig` to Node TCP sockets.

## Patterns used

- [Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — every module exports a named `layer` built with `Layer.scoped` or `Layer.effect`; e.g., `NodeFileSystem.layer` at `src/NodeFileSystem.ts:13`.
- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all implementations live in `src/internal/`; `"./internal/*": null` in `package.json:39` blocks consumer access at publish time.
- [Channel — bidirectional stream primitive](../02-patterns-catalog.md#channel--bidirectional-stream-primitive-streams-underlying-type) — `fromReadableChannel` and `fromDuplex` at `src/internal/stream.ts:20-27` build `Channel` values directly; `Stream` is then derived via `Stream.fromChannel`.
- [`Effect.acquireRelease` / `acquireUseRelease`](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — socket and server construction pairs open with close: `src/NodeSocket.ts:47-57` and `src/NodeSocketServer.ts:44-46`.
- [`FiberSet` / `FiberMap` / `FiberHandle`](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `NodeSocketServer` uses `FiberSet.make` + `FiberSet.runtime` to track per-connection fibers and interrupt them at shutdown (`src/NodeSocketServer.ts:65-70`).

## What's unique about this package's design

The defining move is the re-export proxy: `@effect/platform-bun`'s `BunStream.ts` is a one-liner `export * from "@effect/platform-node-shared/NodeStream"`, and `BunRuntime.ts` re-imports `NodeRuntime.runMain` unchanged — Bun and Node diverge only on HTTP/WebSocket; all I/O plumbing lives here.

`handleErrnoException` at `src/internal/error.ts:6-52` translates POSIX `errno` codes (`ENOENT`, `EACCES`, `EEXIST`, `EISDIR`, `EBUSY`, `ELOOP`) to `@effect/platform`'s `SystemErrorReason` union. Every filesystem operation in `src/internal/fileSystem.ts` funnels through it, giving both consumers a uniform error shape.

`NodeSocket.fromDuplex` at `src/NodeSocket.ts:87` uses `Effect.unsafeMakeLatch` to gate writes until the connection is open — a race guard without a full `Queue` or `Deferred`.

## Conventions observed

- `exports` point to `.ts` source, not compiled output (`repos/effect/packages/platform-node-shared/package.json:36-38`) — monorepo workspace-dev convention.
- Two error helpers: `handleErrnoException` for POSIX errors (`src/internal/error.ts:6-52`); `handleBadArgument` for argument validation (`src/internal/fileSystem.ts:16-21`). No shared `errors.ts` barrel.
- `NodeClusterSocket` is the sole importer of `@effect/cluster` and `@effect/rpc`, explaining those otherwise unrelated peers.

## "If you were authoring something similar, copy this"

- `"./internal/*": null` in the export map (`repos/effect/packages/platform-node-shared/package.json:39`) blocks internal imports without a runtime error or bundler plugin.
- `handleErrnoException` at `src/internal/error.ts:6-52` maps `NodeJS.ErrnoException` to a `PlatformError` with `reason`, `module`, `method`, `pathOrDescriptor`, and `syscall` — every fs error becomes serialisable and `catchTag`-able.
- The pending-connection queue at `src/NodeSocketServer.ts:39-42` buffers early connections before `run` is registered and drains on first call, preventing the lost-connection race in naive event-listener setups.
- `setInterval(constVoid, 2 ** 31 - 1)` at `src/internal/runtime.ts:9` holds the event loop open until the main fiber completes without owning any real resource.

## Open questions

- Should `NodeClusterSocket` move to a dedicated `platform-node-cluster` package? Its `@effect/cluster` + `@effect/rpc` imports are heavier than everything else here.
- `NodeStream.stdout` is `Stream<Uint8Array>` (`src/NodeStream.ts:144`) while `NodeSink.stdout` is `Sink<void, string | Uint8Array>` (`src/NodeSink.ts:38`) — the asymmetry on the same fd is undocumented.
- `NodeTerminal` uses `RcRef` for the readline interface (`src/internal/terminal.ts:22-41`), implying shared TTY ownership across callers — refcount semantics on concurrent `make` calls are not exposed in the public API.
