# Chapter 23 — Platform on Node.js — HTTP server, file system, and subprocess

> **Package(s):** `@effect/platform-node`
> **Patterns introduced:** [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](../../research/02-patterns-catalog.md#poolmake--poolmakewithttl-and-keyedpool)
> **Reads from:** Chapter 09 (Layer — building, merging, and providing services), Chapter 10 (Layer.scoped and Scope — resource lifecycles), Chapter 22 (Platform services — the abstract runtime layer)
> **Reads into:** Chapter 24 (Platform on Bun and the browser), Chapter 25 (SQL part 1 — the @effect/sql abstraction layer), Chapter 33 (Observability with @effect/opentelemetry)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 22 showed how `@effect/platform` declares abstract service tags for HTTP, filesystem, subprocess, and terminal IO. The promise is that business logic remains runtime-neutral. But that promise only holds if something wires those tags to real Node.js calls at the program's entry point.

Doing the wiring by hand is painful. Consider what a minimal Node.js HTTP server requires without `@effect/platform-node`:

```ts
// Raw Node.js HTTP server — every concern handled manually
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // No typed routing, no per-request error channel, no fiber isolation
  try {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" })
      res.end("ok")
      return
    }
    const body = await readFile("./data.json", "utf8")
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(body)
  } catch (err) {
    res.writeHead(500)
    res.end("Internal server error")
    // err is unknown — no typed error channel
  }
})

// Manual graceful shutdown — misses SIGKILL, crashes, and other signals
process.on("SIGINT", () => server.close(() => process.exit(0)))
process.on("SIGTERM", () => server.close(() => process.exit(0)))

server.listen(3000, () => console.log("listening on :3000"))
```

Four things break here. First, the handler has no typed error channel — `err` is `unknown` and the only recovery option is `res.writeHead(500)`. Second, each request shares the same closure scope; there is no isolation, so an unhandled exception in one request can crash the entire process. Third, the graceful shutdown listener does not integrate with anything else: if you add a database pool later, you must remember to close it in the same callback and get the ordering right. Fourth, the filesystem call is a raw `node:fs/promises` call — untestable without mocking the entire module.

`@effect/platform-node` replaces all four problems with a single `Layer` composition. You import concrete `NodeHttpServer.layer`, `NodeFileSystem.layer`, and `NodeRuntime.runMain`; the shutdown ordering and per-request fiber isolation come for free.

---

## The minimal example

```ts
import { HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
import { createServer } from "node:http"

// Concrete server layer — wraps Node's createServer inside a Layer.scoped
// repos/effect/packages/platform-node/src/NodeHttpServer.ts:67-75
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: 3000 })

// HttpServer.serve wires the app into the HttpServer tag; ServerLive provides it
const HttpLive = HttpServer.serve(HttpServerResponse.text("Hello World")).pipe(
  Layer.provide(ServerLive)
)

// runMain registers SIGINT/SIGTERM handlers, holds the event loop open with
// setInterval, and derives the exit code from the fiber's Exit value
// repos/effect/packages/platform-node-shared/src/internal/runtime.ts:5-34
NodeRuntime.runMain(Layer.launch(HttpLive))
```

This is exactly the pattern from the official examples at `repos/effect/packages/platform-node/examples/http-server.ts`. `NodeHttpServer.layer` is a `Layer.scoped` factory — when the scope closes (on SIGINT or SIGTERM), it calls `server.close()` automatically. `NodeRuntime.runMain` is the entry point; it starts the main fiber, registers the OS signal handlers, and clears the keep-alive timer when the fiber completes.

---

## Tour

`@effect/platform-node` is a **concrete runtime binding**: every module in its `src/` directory satisfies one or more abstract tags from `@effect/platform`. Most files are thin re-export shims into `@effect/platform-node-shared` (shared with `@effect/platform-bun`); only HTTP server lifecycle, WebSocket upgrades, and the Undici client live here exclusively.

### The "concrete layers for abstract tags" mental model

Chapter 22 introduced the discipline: `@effect/platform` declares `Context.Tag`-keyed service interfaces; callers yield those tags; the concrete implementation is injected as a `Layer` at the program boundary. `@effect/platform-node` is the boundary for Node.js programs. Each module here maps one abstract tag to one Node.js implementation:

| Abstract tag (from `@effect/platform`) | Concrete layer (`@effect/platform-node`) |
|---|---|
| `HttpServer.HttpServer` | `NodeHttpServer.layer` |
| `HttpClient.HttpClient` | `NodeHttpClient.layer` |
| `FileSystem.FileSystem` | `NodeFileSystem.layer` |
| `Path.Path` | `NodePath.layer` |
| `CommandExecutor.CommandExecutor` | `NodeCommandExecutor.layer` |
| `Worker.WorkerManager` | `NodeWorker.layerManager` |

All five of the OS-level services plus `WorkerManager` are bundled together in `NodeContext.layer` — one import satisfies every standard platform requirement.

### HTTP server

`NodeHttpServer` (`repos/effect/packages/platform-node/src/NodeHttpServer.ts:1-134`) provides four layer factories:

- **`layer(evaluate, options)`** — the batteries-included factory. Takes a lazy `() => Http.Server` factory and `Net.ListenOptions`. Produces `Layer<HttpPlatform | Etag.Generator | NodeContext | HttpServer, ServeError>`. All four provided tags are necessary to run an HTTP application. `repos/effect/packages/platform-node/src/NodeHttpServer.ts:67-75`

- **`layerServer(evaluate, options)`** — provides only `HttpServer`. Use this when you want to supply `HttpPlatform` and `NodeContext` yourself. `repos/effect/packages/platform-node/src/NodeHttpServer.ts:62-65`

- **`layerConfig(evaluate, options)`** — same as `layer` but reads listen options from `Config` values, enabling port and hostname to come from environment variables. `repos/effect/packages/platform-node/src/NodeHttpServer.ts:81-87`

- **`layerTest`** — starts a port-0 server and pre-configures an `HttpClient` with the server's base URL. The returned layer includes both `HttpServer` and `HttpClient` so in-process integration tests can make real requests without knowing the port. `repos/effect/packages/platform-node/src/NodeHttpServer.ts:89-118`

Every one of these factories delegates to `Layer.scoped`, which means the server socket is acquired and released inside an Effect `Scope` (Chapter 10). The acquisition calls `server.listen`; the release calls `server.close` (and `wss.close` if WebSocket upgrades were configured). No manual `process.on("SIGTERM")` listener is needed.

### HTTP client

`NodeHttpClient` (`repos/effect/packages/platform-node/src/NodeHttpClient.ts:1-138`) exposes two client backends:

- **`layer`** — the default backend. It manages `Http.Agent` and `Https.Agent` via `Effect.acquireRelease`, creating them on layer-up and destroying them on layer-down. `repos/effect/packages/platform-node/src/NodeHttpClient.ts:68-72`

- **`layerUndici`** — routes all requests through an Undici `Dispatcher`. Undici is Node.js's modern HTTP/1.1 and HTTP/2 client with connection pooling built in. The `Dispatcher` tag is exposed in context so callers can inject a custom pool, a mock, or a proxy. `repos/effect/packages/platform-node/src/NodeHttpClient.ts:131`

- **`layerWithoutAgent`** — expects an `HttpAgent` already in context; useful when you want to configure agent options (keep-alive timeout, TLS settings) and inject them separately. `repos/effect/packages/platform-node/src/NodeHttpClient.ts:78`

### FileSystem and Path

`NodeFileSystem.layer` (`repos/effect/packages/platform-node/src/NodeFileSystem.ts:1-12`) provides `FileSystem.FileSystem` via `node:fs`. The real implementation lives in `@effect/platform-node-shared`; every `node:fs` callback is lifted with an `effectify` helper into a typed `Effect`, and every `errno` code maps to a `PlatformError` with a `SystemErrorReason` discriminant (`NotFound`, `PermissionDenied`, etc.). Business logic can `Effect.catchTag("SystemError", ...)` uniformly.

`NodePath.layer`, `NodePath.layerPosix`, and `NodePath.layerWin32` provide `Path.Path`. The POSIX and Win32 variants force the `path` implementation regardless of the current OS — useful for cross-platform path normalisation in tests.

`NodeKeyValueStore.layerFileSystem(directory)` provides `KeyValueStore.KeyValueStore` backed by the filesystem. Each key becomes a file in the given directory. `repos/effect/packages/platform-node/src/NodeKeyValueStore.ts:9-15`

### Subprocess

`NodeCommandExecutor.layer` (`repos/effect/packages/platform-node/src/NodeCommandExecutor.ts:1-13`) provides `CommandExecutor.CommandExecutor` via `node:child_process`. It requires `FileSystem` in its environment (the shared layer reads from `@effect/platform-node-shared`). Once provided, you can call `CommandExecutor.stream`, `CommandExecutor.streamLines`, or `CommandExecutor.string` with a `Command` value from `@effect/platform`.

**Name collision note:** `Command` in `@effect/platform` describes a subprocess invocation. It is completely separate from `Command` in `@effect/cli` (Chapter 19), which describes a CLI argument tree. When using both, import them with their package namespace and keep usages in separate modules.

### Worker threads

`NodeWorker` (`repos/effect/packages/platform-node/src/NodeWorker.ts:1-36`) provides four layer variants:

- **`layerManager`** — provides `Worker.WorkerManager` only, without a spawner. Used when you provide the spawner separately.
- **`layerWorker`** — provides `Worker.PlatformWorker`, the low-level platform hook.
- **`layer(spawn)`** — the batteries-included variant. Pass a `(id: number) => WorkerThreads.Worker | ChildProcess.ChildProcess` factory and get both `WorkerManager` and `Worker.Spawner`. `repos/effect/packages/platform-node/src/NodeWorker.ts:26-29`
- **`layerPlatform(spawn)`** — low-level escape hatch that provides `PlatformWorker` and `Spawner` without `WorkerManager`; for advanced custom scheduling.

Worker shutdown is graceful: send a terminate signal, await `exit` via `Deferred`, apply a 5-second timeout, then `SIGKILL`.

### NodeContext.layer — the bundle

`NodeContext.layer` (`repos/effect/packages/platform-node/src/NodeContext.ts:28-40`) composes five independent service layers into one named layer with `Layer.mergeAll` and `Layer.provideMerge`:

```ts
// repos/effect/packages/platform-node/src/NodeContext.ts:28-40
export const layer: Layer.Layer<NodeContext> = pipe(
  Layer.mergeAll(
    NodePath.layer,
    NodeCommandExecutor.layer,
    NodeTerminal.layer,
    NodeWorker.layerManager
  ),
  Layer.provideMerge(NodeFileSystem.layer)
)
```

The type alias `NodeContext` at line 21 is `CommandExecutor | FileSystem | Path | Terminal | Worker.WorkerManager`. Providing `NodeContext.layer` satisfies all five abstract tags in one call. For most applications, `NodeHttpServer.layer` already bundles `NodeContext` internally, so you only need to reach for `NodeContext.layer` explicitly when building non-HTTP programs (CLI tools, batch jobs, worker threads).

### NodeRuntime.runMain — graceful shutdown

`NodeRuntime.runMain` (`repos/effect/packages/platform-node/src/NodeRuntime.ts:1-11`) is the program entry point for every Node.js Effect application. Internally it calls `makeRunMain` from `@effect/platform/Runtime`, which:

1. Forks the main fiber via `Effect.runFork`.
2. Installs `SIGINT` and `SIGTERM` listeners that call `fiber.unsafeInterruptAsFork`.
3. Sets `setInterval(constVoid, 2**31 - 1)` to keep the event loop alive until the fiber completes (`repos/effect/packages/platform-node-shared/src/internal/runtime.ts:9`).
4. Clears the interval and removes signal listeners in the fiber observer.
5. Derives the process exit code from the fiber's `Exit` — `0` for success, `1` for failure.

The result: interruption propagates down the fiber tree, every `Layer.scoped` finalizer runs in reverse acquisition order, and the process exits cleanly.

### Pool — the introduced pattern

`Pool` and `KeyedPool` live in the core `effect` package, not in `@effect/platform-node`. They are introduced here because platform-node services make the use case concrete: HTTP keep-alive connections, database connections, and worker threads are all pooled resources — expensive to create, safe to reuse, and needed concurrently.

**`Pool.make`** (`repos/effect/packages/effect/src/Pool.ts:96-122`) creates a fixed-size pool:

```ts
import { Effect, Pool } from "effect"

// A pool of 10 items, each acquired with the given effect
const pool = Pool.make({
  acquire: acquireExpensiveResource,  // Effect<Resource, Error, R>
  size: 10
})
// returns Effect<Pool<Resource, Error>, never, Scope | R>
```

`Pool.get` returns a scoped `Effect<A, E, Scope>`. The resource is returned to the pool when the scope closes — no manual `.release()` call. If acquisition fails, the pool retries on the next `get`. `Pool.invalidate(item)` marks an item as bad, causing the pool to re-acquire lazily.

**`Pool.makeWithTTL`** (`repos/effect/packages/effect/src/Pool.ts:124-181`) creates a pool that scales between `min` and `max` items and evicts idle items after a `timeToLive` duration:

```ts
import { Duration, Effect, Pool } from "effect"

const connectionPool = Pool.makeWithTTL({
  acquire: acquireDbConnection,
  min: 2,
  max: 20,
  timeToLive: Duration.seconds(30)
})
// repos/effect/packages/effect/src/Pool.ts:124-181
```

The default `timeToLiveStrategy` is `"usage"` — idle items are evicted after `timeToLive` since last use. Set `timeToLiveStrategy: "creation"` to evict based on creation time instead.

**`KeyedPool.make`** (`repos/effect/packages/effect/src/KeyedPool.ts:64-78`) creates a map of pools keyed by an arbitrary `K`. Each key gets its own independent sub-pool:

```ts
import { Duration, Effect, KeyedPool } from "effect"

// One pool per upstream host — useful in a service mesh or proxy
const perHostPool = KeyedPool.make({
  acquire: (host: string) => acquireConnectionTo(host),
  size: 5
})
// repos/effect/packages/effect/src/KeyedPool.ts:64-78
```

`KeyedPool.makeWithTTL` adds min/max sizing and TTL eviction per key; the `min`, `max`, and `timeToLive` options can all be functions of `K`, so different keys can have different pool sizes.


---

## A production example

The following example is adapted from `repos/effect/packages/platform-node/examples/http-router.ts`. It demonstrates an HTTP server with routing, middleware, file upload handling, and proper Layer composition:

```ts
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Multipart
} from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer, Schedule, Stream } from "effect"
import * as Schema from "effect/Schema"
import { createServer } from "node:http"

// ---- Route handlers — pure Effects, no Node.js imports ----

const healthzHandler = HttpServerResponse.text("ok").pipe(
  // Disable request logging for health check endpoints
  HttpMiddleware.withLoggerDisabled
)

const uploadHandler = Effect.gen(function* () {
  // HttpServerRequest.schemaBodyForm parses multipart bodies with typed Schema
  const data = yield* HttpServerRequest.schemaBodyForm(Schema.Struct({
    files: Multipart.FilesSchema
  }))
  yield* Console.log("received files:", data.files.map((f) => f.name))
  return HttpServerResponse.empty()
})

// WebSocket upgrade: pipe the upgrade channel through a Schedule-driven stream
const wsHandler = Stream.fromSchedule(Schedule.spaced(1000)).pipe(
  Stream.map(JSON.stringify),
  Stream.encodeText,
  Stream.pipeThroughChannel(HttpServerRequest.upgradeChannel()),
  Stream.decodeText(),
  Stream.runForEach((msg) => Effect.log(msg)),
  Effect.annotateLogs({ context: "ws-recv" }),
  Effect.as(HttpServerResponse.empty())
)

// ---- Router — Layer.scoped composition from Chapter 09 / Chapter 10 ----

// NodeHttpServer.layer is a Layer.scoped; server.close() runs on scope teardown
// repos/effect/packages/platform-node/src/NodeHttpServer.ts:67-75
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: 3000 })

const HttpLive = HttpRouter.empty.pipe(
  HttpRouter.get("/healthz", healthzHandler),
  HttpRouter.post("/upload", uploadHandler),
  HttpRouter.get("/ws", wsHandler),
  // HttpServer.serve wraps the router in the HttpServer tag's serve method
  // HttpMiddleware.logger adds structured request/response logging
  HttpServer.serve(HttpMiddleware.logger),
  // withLogAddress logs the bound address on startup
  HttpServer.withLogAddress,
  // Provide the concrete Node.js server layer
  Layer.provide(ServerLive)
)

// NodeRuntime.runMain: forks the fiber, installs SIGINT/SIGTERM, holds the event
// loop open with setInterval until the fiber completes
// repos/effect/packages/platform-node-shared/src/internal/runtime.ts:5-34
NodeRuntime.runMain(Layer.launch(HttpLive))
```

This program composes cleanly with Part I patterns. `HttpLive` is a `Layer` (Chapter 09) assembled by merging router, middleware, and server concerns. `NodeHttpServer.layer` is a `Layer.scoped` (Chapter 10) — the `createServer()` factory is called inside `Effect.acquireRelease`; the `release` half calls `server.close()`. `NodeRuntime.runMain` drives the whole graph and ensures clean shutdown on OS signals.

The handlers themselves (`healthzHandler`, `uploadHandler`, `wsHandler`) import nothing from `@effect/platform-node`. They depend only on abstract tags from `@effect/platform`. Swapping to `BunHttpServer.layer` (Chapter 24) leaves all handlers unchanged — the handlers are fully portable. The layer call site does need adjustment because `BunHttpServer.layer` takes a `ServeOptions` object rather than the `(factory, listenOpts)` pair that `NodeHttpServer.layer` accepts.

---

## Variations

**HTTPS server:** Pass a `createServer` factory from `node:https` with your TLS options. The layer signature is identical:

```ts
import { createServer } from "node:https"
import { readFileSync } from "node:fs"
import { NodeHttpServer } from "@effect/platform-node"
const ServerLive = NodeHttpServer.layer(
  () => createServer({ key: readFileSync("key.pem"), cert: readFileSync("cert.pem") }),
  { port: 443 }
)
```

**Config-driven port:** Use `layerConfig` to read port from an environment variable, avoiding hard-coded values:

```ts
import { NodeHttpServer } from "@effect/platform-node"
import { Config } from "effect"
const ServerLive = NodeHttpServer.layerConfig(
  () => createServer(),
  { port: Config.integer("PORT").pipe(Config.withDefault(3000)) }
)
```

**In-process integration tests with `layerTest`:** `NodeHttpServer.layerTest` starts a port-0 server and injects a pre-configured `HttpClient`. No hard-coded port, real server, no network mocking:

```ts
import { HttpClient, HttpRouter, HttpServer } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect } from "effect"
Effect.gen(function* () {
  yield* HttpServer.serveEffect(HttpRouter.empty)
  const response = yield* HttpClient.get("/")
  // response.status === 404 — the empty router returns 404
}).pipe(Effect.provide(NodeHttpServer.layerTest))
```

**Filesystem-backed KeyValueStore:** `NodeKeyValueStore.layerFileSystem` stores each key as a file in a directory. Useful for simple persistence without a database:

```ts
import { KeyValueStore } from "@effect/platform"
import { NodeKeyValueStore } from "@effect/platform-node"
import { Effect } from "effect"
const kv = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore
  yield* store.set("session:abc", "user:1")
  return yield* store.get("session:abc")
}).pipe(Effect.provide(NodeKeyValueStore.layerFileSystem("./data/sessions")))
```

**Undici client with custom dispatcher:** Inject a custom Undici `Dispatcher` for proxy routing, mocking, or HTTP/2 configuration:

```ts
import { NodeHttpClient } from "@effect/platform-node"
import { Layer } from "effect"
import { MockAgent } from "undici"
const mock = new MockAgent()
const testLayer = NodeHttpClient.layerUndici.pipe(
  Layer.provide(Layer.succeed(NodeHttpClient.Dispatcher, mock))
)
```

**Worker pool for CPU-bound work:** Use `Worker.makePoolLayer` with `NodeWorker.layer` to create a size-3 worker pool:

```ts
import { Worker } from "@effect/platform"
import { NodeRuntime, NodeWorker } from "@effect/platform-node"
import { Context, Effect, Layer, Stream } from "effect"
import * as WT from "node:worker_threads"
interface MyWorkerPool { readonly _: unique symbol }
const Pool = Context.GenericTag<MyWorkerPool, Worker.WorkerPool<number, never, number>>("@app/Pool")
const PoolLive = Worker.makePoolLayer(Pool, { size: 3 }).pipe(
  Layer.provide(NodeWorker.layer(() => new WT.Worker("./worker.js")))
)
// repos/effect/packages/platform-node/examples/worker.ts
```

---

## Anti-patterns

**Using `node:http` directly inside an Effect:**

```ts
// Wrong — bypasses the Layer graph entirely; untestable and not portable
import { createServer } from "node:http"
import { Effect } from "effect"
const startServer = Effect.sync(() => {
  const server = createServer((req, res) => { res.end("ok") })
  server.listen(3000)
})
```

```ts
// Correct — use NodeHttpServer.layer; resource lifecycle managed by Layer.scoped
import { HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
import { createServer } from "node:http"
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: 3000 })
const HttpLive = HttpServer.serve(HttpServerResponse.text("ok")).pipe(Layer.provide(ServerLive))
NodeRuntime.runMain(Layer.launch(HttpLive))
```

The correct version participates in Effect's scope-based shutdown. When `NodeRuntime.runMain` receives SIGINT, it interrupts the main fiber, which closes the scope, which calls `server.close()`.

**Providing platform-node layers inside library code:**

```ts
// Wrong — a shared library that imports a concrete platform
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"
export function readConfig(path: string) {
  return doRead(path).pipe(Effect.provide(NodeFileSystem.layer))
}
```

```ts
// Correct — declare FileSystem as a requirement; let the application provide it
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
export function readConfig(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path)
  })
  // FileSystem appears in the R type parameter — caller must provide it
}
```

A library that hard-codes `NodeFileSystem.layer` cannot be used in Bun or browser environments. Only the application entry point (`main.ts`) should reference `@effect/platform-node`.

**Forgetting `NodeRuntime.runMain` (or using `Effect.runPromise` directly):**

```ts
// Wrong — the process exits immediately on async work; no SIGINT handling
import { Layer } from "effect"
import { Effect } from "effect"
Effect.runPromise(Layer.launch(HttpLive))
// ^ HttpLive is a Layer, not an Effect; this may type-error or resolve early
```

```ts
// Correct — runMain holds the event loop open and registers signal handlers
import { NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
NodeRuntime.runMain(Layer.launch(HttpLive))
```

`Layer.launch` returns an `Effect<never, ...>` that runs until interrupted. `Effect.runPromise` would start it but the process might exit before receiving any requests. `NodeRuntime.runMain` uses `setInterval` to keep the event loop alive until the fiber completes.

**Manually acquiring and releasing Pool items:**

```ts
// Wrong — Pool.get is a scoped effect; manually calling close() bypasses cleanup
const pool = yield* Pool.make({ acquire: acquireConn, size: 10 })
const conn = yield* pool.get  // Effect<Conn, E, Scope>
await useConnection(conn)
conn.close()  // not run on interruption
```

```ts
// Correct — use Effect.scoped to bound the resource's lifetime
const pool = yield* Pool.make({ acquire: acquireConn, size: 10 })
const result = yield* Effect.scoped(
  pool.get.pipe(Effect.flatMap((conn) => useConnection(conn)))
)
// conn is returned to the pool when the inner scope closes, even on interruption
```

---

## See also

- [Chapter 09 — Layer: building, merging, and providing services](../part-1-foundations/09-layer.md) — `Layer.mergeAll`, `Layer.provide`, and `Layer.provideMerge` are the combinators that assemble `NodeContext.layer` and `HttpLive`; the injection mechanism that makes concrete platform layers composable.
- [Chapter 10 — Layer.scoped and Scope: resource lifecycles](../part-1-foundations/10-layer-scoped-and-scope.md) — `NodeHttpServer.layer`, `NodeHttpClient.layer`, and the worker layers are all `Layer.scoped` resources; this chapter covers `Effect.acquireRelease` and how scope finalizers run on shutdown.
- [Chapter 22 — Platform services: the abstract runtime layer](22-platform.md) — introduces the abstract tags (`FileSystem`, `HttpClient`, `HttpServer`, `CommandExecutor`, `Worker`) that this chapter's concrete layers satisfy. Read Chapter 22 before this one.
- [Chapter 24 — Platform on Bun and the browser](24-platform-bun-browser.md) — `@effect/platform-bun` and `@effect/platform-browser` follow the same concrete-layer pattern; `@effect/platform-node-shared` is the shared internals package that both Node.js and Bun consume. Introduces `RcRef` and `RcMap`.
- [Chapter 25 — SQL part 1: the @effect/sql abstraction layer](25-sql-core.md) — SQL connection pools built with `Pool.make` and `Pool.makeWithTTL` (introduced here) are the primary consumer of the pattern in production services.
- [Chapter 33 — Observability with @effect/opentelemetry](33-opentelemetry.md) — `NodeHttpServer` integrates with OpenTelemetry spans automatically when the OTel layer is provided; per-request tracing uses the same fiber-per-request architecture described in the Tour above.
- [Patterns catalog — `Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](../../research/02-patterns-catalog.md#poolmake--poolmakewithttl-and-keyedpool) — the full catalog entry for the pattern introduced in this chapter, including when to use `Pool` vs `Semaphore` vs `RcRef`.
- [Per-package research note — @effect/platform-node](../../research/packages/platform-node.md) — extended API surface notes, open questions on `NodeClusterHttp`, and the design rationale for the two-tier `platform-node` / `platform-node-shared` delegation.
- [Per-package research note — @effect/platform-node-shared](../../research/packages/platform-node-shared.md) — `handleErrnoException`, `NodeSocket.fromDuplex`, `NodeSocketServer` pending-connection buffering, and the `NodeStream` / `NodeSink` stdout asymmetry.
