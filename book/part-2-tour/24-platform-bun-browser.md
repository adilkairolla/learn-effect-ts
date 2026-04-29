# Chapter 24 — Platform on Bun and the browser

> **Package(s):** `@effect/platform-bun`, `@effect/platform-browser`
> **Patterns introduced:** [RcRef and RcMap — reference-counted resources](../../research/02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources)
> **Reads from:** Chapter 09 (Layer — building, merging, and providing services), Chapter 10 (Layer.scoped and Scope — resource lifecycles), Chapter 22 (Platform services — the abstract runtime layer), Chapter 23 (Platform on Node.js — HTTP server, file system, and subprocess)
> **Reads into:** nothing (end of the platform tour)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapters 22 and 23 showed how `@effect/platform` declares abstract service tags and `@effect/platform-node` wires them to Node.js. Two additional runtimes are now common: Bun — a Node.js alternative with its own HTTP server (`Bun.serve`) and file API (`Bun.file`) — and the browser, which runs JavaScript but has neither `node:fs`, `node:http`, nor any Node-compatible subprocess model.

The cross-runtime fragmentation reaches its peak here. Consider a cache layer that needs to work in Cloudflare Workers (browser runtime), Bun, and Node.js. Written directly against each platform's API, a single SQLite-backed caching module splits into three completely independent implementations:

```ts
// Node.js — node:fs + undici
import { readFile, writeFile } from "node:fs/promises"
import { fetch } from "undici"

async function getCached(key: string): Promise<string | null> {
  try {
    return await readFile(`./cache/${key}`, "utf8")
  } catch {
    return null
  }
}

// Bun — Bun.file + globalThis.fetch
async function getCachedBun(key: string): Promise<string | null> {
  const file = Bun.file(`./cache/${key}`)
  return (await file.exists()) ? file.text() : null
}

// Browser — localStorage + XMLHttpRequest
function getCachedBrowser(key: string): string | null {
  return localStorage.getItem(key)
}
```

Each implementation is a dead end. Switching runtime means rewriting the cache layer. Sharing it across a monorepo with a Bun API server, a React SPA, and a Cloudflare Worker means three separate packages or a maze of conditional imports.

The `@effect/platform` abstraction layer (Chapter 22) solves this by design. Business logic programs against `KeyValueStore`, `FileSystem`, and `HttpClient` tags. At the entry point, you choose the layer: `BunContext.layer` for Bun, `BrowserKeyValueStore.layerLocalStorage` for the browser, `NodeContext.layer` for Node.js. The abstract program does not change.

The browser also introduces a resource-sharing problem that does not arise in Node.js. A browser tab runs many concurrent fibers — debounced searches, upload progress, clipboard operations — all of which may want access to a single IndexedDB connection or a single `navigator.clipboard` handle. Opening a new connection per fiber is expensive and unnecessary. Closing it prematurely strands other fibers. The standard fix, manual reference counting with a shared `let conn` and `refCount++`/`--`, has races in async code.

This chapter walks both packages and introduces `RcRef` and `RcMap` — the Effect pattern that replaces manual reference counting with atomic, scope-managed shared resources.

---

## The minimal example

The most compact runnable example for `@effect/platform-bun` is a single-file HTTP server. Swap `NodeHttpServer.layer` (Chapter 23) for `BunHttpServer.layer` and swap `NodeRuntime.runMain` for `BunRuntime.runMain`. The `HttpServer.serve` call and the business logic layer do not change.

```ts
import { HttpServer, HttpServerResponse } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"

// BunHttpServer.layer wraps Bun.serve inside a Layer.scoped; the server stops
// on scope close (SIGINT, SIGTERM, or unhandled defect).
// (public facade repos/effect/packages/platform-bun/src/BunHttpServer.ts:47-53;
//  implementation repos/effect/packages/platform-bun/src/internal/httpServer.ts:66-70)
const ServerLive = BunHttpServer.layer({ port: 3000 })

const HttpLive = HttpServer.serve(HttpServerResponse.text("Hello from Bun")).pipe(
  Layer.provide(ServerLive)
)

// BunRuntime.runMain delegates to NodeRuntime.runMain from platform-node-shared,
// giving Bun the same signal-handling and exit-code semantics as Node.js.
// repos/effect/packages/platform-bun/src/BunRuntime.ts:1-11
BunRuntime.runMain(Layer.launch(HttpLive))
```

For `@effect/platform-browser`, the minimal example is an HTTP client layer swap. Replace `NodeHttpClient` with `BrowserHttpClient.layerXMLHttpRequest`:

```ts
import { HttpClient, HttpClientRequest } from "@effect/platform"
import { BrowserHttpClient, BrowserRuntime } from "@effect/platform-browser"
import { Effect, Layer } from "effect"

// repos/effect/packages/platform-browser/src/BrowserHttpClient.ts:12-16
const program = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.execute(HttpClientRequest.get("https://api.example.com/data"))
  return yield* response.text
})

// BrowserRuntime.runMain interrupts the root fiber on the `beforeunload` window
// event, so finalizers (including connection teardown) run on page navigation.
// repos/effect/packages/platform-browser/src/internal/runtime.ts:1-8
BrowserRuntime.runMain(
  program.pipe(
    Effect.provide(BrowserHttpClient.layerXMLHttpRequest)
  )
)
```

---

## Tour

### Bun: BunHttpServer and BunHttpPlatform

`BunHttpServer` is the Bun counterpart to `NodeHttpServer`. It wraps `Bun.serve` using a mutable handler-stack approach: the server starts with a 404-stub `fetch` function, then the real Effect handler is pushed via `server.reload({ fetch: handler })` once the Layer resolves. This means `Bun.serve` is only called once — expensive because it binds the port — and the handler can be swapped on test re-runs without restarting the process.

The exported constructors are:

- `BunHttpServer.make(options)` — returns `Effect<HttpServer, never, Scope>`: creates the server and registers a finalizer that calls `server.stop()`.
- `BunHttpServer.layerServer(options)` — `Layer<HttpServer>`: wraps `make` in `Layer.scoped`.
- `BunHttpServer.layer(options)` — `Layer<HttpServer | HttpPlatform | Etag.Generator | BunContext>`: the full batteries-included layer most applications use.
- `BunHttpServer.layerTest` — `Layer<HttpClient | HttpServer | ...>`: starts on a random port and provides a pre-configured `HttpClient` for test suites.
- `BunHttpServer.layerConfig(config)` — loads port, hostname, and TLS options from `Config`, useful for twelve-factor apps.

(`repos/effect/packages/platform-bun/src/BunHttpServer.ts:31-96`)

`BunHttpPlatform` provides the `HttpPlatform` service. Its key behavior is zero-copy file serving: the `fileResponse` implementation calls `Bun.file(path).slice(start, end)` and returns `ServerResponse.raw(file)`. Bun detects a `BunFile` body and uses a `sendfile`-equivalent syscall, bypassing stream overhead entirely.

(`repos/effect/packages/platform-bun/src/internal/httpPlatform.ts:7-19`)

### Bun: BunFileSystem and the node-shared delegation

`BunFileSystem` exports a single `layer: Layer<FileSystem>`:

```ts
// repos/effect/packages/platform-bun/src/BunFileSystem.ts:1-12
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem"
export const layer = NodeFileSystem.layer
```

This one-liner is intentional. Bun's Node.js compatibility layer means the `node:fs` implementation from `@effect/platform-node-shared` works correctly on Bun. The package delegates eleven of its nineteen modules directly to `@effect/platform-node-shared`: `BunFileSystem`, `BunPath`, `BunRuntime`, `BunCommandExecutor`, `BunTerminal`, `BunStream`, `BunSink`, `BunSocketServer`, `BunKeyValueStore`, `BunSocket` (base), and the `BunSocket` client. Only `internal/httpServer.ts`, `internal/httpPlatform.ts`, `internal/multipart.ts`, `BunSocket.ts` (WebSocket), and the worker/runner pair contain Bun-specific logic. Re-implementing only the genuinely divergent pieces is a convention the authoring chapters (Part III) return to.

### Bun: BunContext — the bootstrap bundle

`BunContext.layer` is the single layer most Bun applications provide in `main`:

```ts
// repos/effect/packages/platform-bun/src/BunContext.ts:28-40
// Bundles FileSystem, Path, CommandExecutor, Terminal, and WorkerManager
// into one Layer<BunContext> via Layer.mergeAll + Layer.provideMerge.
export const layer: Layer.Layer<BunContext> = pipe(
  Layer.mergeAll(
    BunPath.layer,
    BunCommandExecutor.layer,
    BunTerminal.layer,
    BunWorker.layerManager
  ),
  Layer.provideMerge(BunFileSystem.layer)
)
```

Providing `BunContext.layer` in the root layer satisfies every OS-level service tag at once. The `BunHttpServer.layer` factory includes `BunContext` in its output type, so HTTP server applications usually need only one `.pipe(Layer.provide(...))` call.

### Browser: BrowserHttpClient

The browser has no Node.js HTTP stack. `BrowserHttpClient` provides `HttpClient` backed by `XMLHttpRequest`:

```ts
// repos/effect/packages/platform-browser/src/BrowserHttpClient.ts:1-37
export const layerXMLHttpRequest: Layer.Layer<HttpClient.HttpClient>
export class XMLHttpRequest extends Context.Tag(...)<...> {}
export const currentXHRResponseType: FiberRef.FiberRef<"text" | "arraybuffer">
export const withXHRArrayBuffer: <A, E, R>(effect: Effect<A, E, R>) => Effect<A, E, R>
```

`layerXMLHttpRequest` is the layer most browser apps use. `currentXHRResponseType` is a `FiberRef` that switches individual request fibers to binary (`arraybuffer`) mode without affecting sibling fibers. `withXHRArrayBuffer` is the convenience wrapper: `pipe(downloadEffect, BrowserHttpClient.withXHRArrayBuffer)`.

The XHR client emulates streaming by tracking `responseText` offsets across `readyState === 3` events — a workaround for browsers where `fetch` streaming is not uniformly available. The browser package's open questions note that a `fetch`-backed client may be added in a future release.

### Browser: BrowserKeyValueStore, Clipboard, and BrowserStream

`BrowserKeyValueStore` provides two layers over the browser's Web Storage API:

```ts
// repos/effect/packages/platform-browser/src/BrowserKeyValueStore.ts:8-22
export const layerLocalStorage: Layer.Layer<KeyValueStore>   // persists across sessions
export const layerSessionStorage: Layer.Layer<KeyValueStore>  // current session only
```

Both implement the same `@effect/platform` `KeyValueStore` interface used by `BunKeyValueStore` and `NodeKeyValueStore`, so a `KeyValueStore`-dependent service layer requires no changes when the runtime changes.

`Clipboard` is a browser-only service (no `@effect/platform` counterpart) that wraps `navigator.clipboard`:

```ts
// repos/effect/packages/platform-browser/src/Clipboard.ts:21-55
export interface Clipboard {
  readonly read: Effect.Effect<ClipboardItems, ClipboardError>
  readonly readString: Effect.Effect<string, ClipboardError>
  readonly write: (items: ClipboardItems) => Effect.Effect<void, ClipboardError>
  readonly writeString: (text: string) => Effect.Effect<void, ClipboardError>
  readonly writeBlob: (blob: Blob) => Effect.Effect<void, ClipboardError>
  readonly clear: Effect.Effect<void, ClipboardError>
}
```

`Clipboard.layer` is the ready-to-use layer: it calls `Layer.succeed(Clipboard, make({...}))` with the `navigator.clipboard` implementation inline, so most applications simply provide it. `make` is the factory used internally and is also exported for users who need to write a custom implementation (for example, a test double or a non-browser clipboard backend).

`BrowserStream` provides typed `Stream` factories over DOM event listeners:

```ts
// repos/effect/packages/platform-browser/src/BrowserStream.ts:8-34
export const fromEventListenerWindow: <K extends keyof WindowEventMap>(
  type: K, options?: ...
) => Stream.Stream<WindowEventMap[K]>

export const fromEventListenerDocument: <K extends keyof DocumentEventMap>(
  type: K, options?: ...
) => Stream.Stream<DocumentEventMap[K]>
```

The type parameter is constrained to `keyof WindowEventMap`, so passing `"clck"` instead of `"click"` is a compile-time error. The factory bridges a DOM `addEventListener`/`removeEventListener` pair into a Stream that cancels the listener when the stream's scope closes.

### The absent FileSystem

The browser package exports no `FileSystem` layer. There is no stub, no `Effect.die` placeholder. The `FileSystem` interface from `@effect/platform` requires access to a POSIX-like filesystem — paths, file descriptors, directory traversal — none of which the browser exposes. Rather than providing a partial or misleading implementation, the package simply omits it. If your application layer requires `FileSystem` and you try to run it in the browser, TypeScript will surface the missing service at the layer-composition site, not at runtime.

### RcRef and RcMap — reference-counted resources

`RcRef` and `RcMap` live in core `effect`, not in either platform package. They solve the problem of sharing a single expensive resource across multiple concurrent fibers without manual reference counting.

**RcRef.make** creates a reference-counted handle to one resource:

```ts
// repos/effect/packages/effect/src/RcRef.ts:68-109
export const make: <A, E, R>(
  options: {
    readonly acquire: Effect.Effect<A, E, R>
    readonly idleTimeToLive?: Duration.DurationInput | undefined
  }
) => Effect.Effect<RcRef<A, E>, never, R | Scope.Scope>
```

The resource is lazily acquired on the first `RcRef.get` and released when the last holder's scope closes. If `idleTimeToLive` is set, the resource is also released after that duration of zero references — useful for connections that should be cached for short periods but not held indefinitely.

**RcMap.make** is the keyed variant:

```ts
// repos/effect/packages/effect/src/RcMap.ts:48-100
export const make: {
  <K, A, E, R>(options: {
    readonly lookup: (key: K) => Effect.Effect<A, E, R>
    readonly idleTimeToLive?: Duration.DurationInput | ((key: K) => Duration.DurationInput) | undefined
    readonly capacity?: undefined
  }): Effect.Effect<RcMap<K, A, E>, never, Scope.Scope | R>
  <K, A, E, R>(options: {
    readonly lookup: (key: K) => Effect.Effect<A, E, R>
    readonly idleTimeToLive?: ...
    readonly capacity: number
  }): Effect.Effect<RcMap<K, A, E | Cause.ExceededCapacityException>, never, Scope.Scope | R>
}
```

`RcMap.get(map, key)` acquires the resource for that key, incrementing its reference count. The resource is created once per key on first access and released when all holders of that key have dropped their references.

**The browser connection:** a browser tab running many concurrent uploads might each want access to an IndexedDB database. Opening a new connection per upload is expensive; leaking a connection because one upload finished first is a bug. `RcMap` keyed by database name solves this atomically — no `let openConnections = {}` and no race conditions. The same applies to `navigator.clipboard`: a shared `RcRef<Clipboard>` means the first fiber that needs clipboard access opens the handle; subsequent fibers reuse it; when all fibers release, the handle is closed.

Both `RcRef` and `RcMap` require a `Scope` in their output. The standard composition is `Layer.scoped` (Chapter 10):

```ts
import { Effect, Layer, RcMap } from "effect"

// The RcMap lives for the lifetime of the layer's scope.
// Fibers that need a connection call RcMap.get — they get back a
// scoped Effect whose scope holds one reference.
const CacheLayer = Layer.scoped(
  CacheService,
  Effect.gen(function*() {
    const map = yield* RcMap.make({
      lookup: (cacheName: string) =>
        Effect.acquireRelease(
          Effect.promise(() => indexedDB.open(cacheName)),
          (db) => Effect.sync(() => db.close())
        ),
      idleTimeToLive: "30 seconds"
    })
    return { map }
  })
)
```

---

## A production example

The following shows a browser-side image-upload helper that shares a single IndexedDB cache connection across many concurrent uploads using `RcMap`, wired through a `Layer.scoped` as covered in Chapter 10.

```ts
import { HttpClient, HttpClientRequest, KeyValueStore } from "@effect/platform"
import { BrowserHttpClient, BrowserRuntime } from "@effect/platform-browser"
import { Data, Effect, Layer, RcMap } from "effect"

// --- typed errors -----------------------------------------------------------

class UploadError extends Data.TaggedError("UploadError")<{
  readonly file: string
  readonly cause: unknown
}> {}

class CacheError extends Data.TaggedError("CacheError")<{
  readonly cacheName: string
  readonly cause: unknown
}> {}

// --- IDB connection (one per cacheName, shared across fibers) ---------------

const makeIDBMap = RcMap.make({
  lookup: (cacheName: string) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(cacheName, 1)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
          }),
        catch: (cause) => new CacheError({ cacheName, cause })
      }),
      (db) => Effect.sync(() => db.close())
    ),
  idleTimeToLive: "30 seconds"
})

// --- cache layer using Layer.scoped (Chapter 10) ----------------------------

class ImageCacheService extends Effect.Service<ImageCacheService>()(
  "ImageCacheService",
  {
    scoped: Effect.gen(function*() {
      // RcMap lives for the duration of the layer scope; all fibers share it.
      const dbMap = yield* makeIDBMap
      return {
        get: (cacheName: string, key: string) =>
          Effect.gen(function*() {
            const db = yield* RcMap.get(dbMap, cacheName)
            return yield* Effect.tryPromise({
              try: () =>
                new Promise<string | null>((resolve, reject) => {
                  const tx = db.transaction("images", "readonly")
                  const req = tx.objectStore("images").get(key)
                  req.onsuccess = () => resolve(req.result ?? null)
                  req.onerror = () => reject(req.error)
                }),
              catch: (cause) => new CacheError({ cacheName, cause })
            }).pipe(Effect.scoped)
          }),
        set: (cacheName: string, key: string, value: string) =>
          Effect.gen(function*() {
            const db = yield* RcMap.get(dbMap, cacheName)
            return yield* Effect.tryPromise({
              try: () =>
                new Promise<void>((resolve, reject) => {
                  const tx = db.transaction("images", "readwrite")
                  tx.objectStore("images").put(value, key)
                  tx.oncomplete = () => resolve()
                  tx.onerror = () => reject(tx.error)
                }),
              catch: (cause) => new CacheError({ cacheName, cause })
            }).pipe(Effect.scoped)
          })
      }
    })
  }
) {}

// --- upload helper ----------------------------------------------------------

const uploadImage = (cacheName: string, file: File) =>
  Effect.gen(function*() {
    const cache = yield* ImageCacheService
    const client = yield* HttpClient.HttpClient

    const cached = yield* cache.get(cacheName, file.name)
    if (cached !== null) return cached

    const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer())
    const body = new Uint8Array(arrayBuffer)

    const response = yield* client.execute(
      HttpClientRequest.post("/api/images").pipe(
        HttpClientRequest.bodyUint8Array(body, "application/octet-stream")
      )
    )
    const url = yield* response.text
    yield* cache.set(cacheName, file.name, url)
    return url
  }).pipe(
    Effect.mapError((e) => new UploadError({ file: file.name, cause: e }))
  )

// --- main -------------------------------------------------------------------

const AppLive = Layer.mergeAll(
  ImageCacheService.Default,
  BrowserHttpClient.layerXMLHttpRequest
)

BrowserRuntime.runMain(
  uploadImage("thumbnails", new File(["..."], "photo.jpg")).pipe(
    Effect.provide(AppLive),
    Effect.tapError(Effect.logError)
  )
)
```

The `RcMap` keyed by `cacheName` ensures that concurrent calls to `uploadImage` with the same `cacheName` share one `IDBDatabase` connection. The connection is released thirty seconds after the last fiber holding it releases its scope — so short bursts of uploads do not pay the open-cost on every file, but idle tabs do not hold connections indefinitely.

---

## Variations

**1. Bun WebSocket client.** `BunSocket.layerWebSocket` wraps `globalThis.WebSocket` as a `Socket.Socket` layer:

```ts
import { BunSocket } from "@effect/platform-bun"
// repos/effect/packages/platform-bun/src/BunSocket.ts:12-21
const WsLive = BunSocket.layerWebSocket("wss://api.example.com/ws")
```

**2. Bun workers.** `BunWorkerRunner.layer` runs an Effect program inside a Bun Web Worker. The `[0, payload]` / `[1]` framing is identical to `platform-node-shared`'s protocol, so workers are portable between Bun and Node.js runtimes:

```ts
import { BunWorkerRunner } from "@effect/platform-bun"
// repos/effect/packages/platform-bun/src/BunWorkerRunner.ts:1-20
WorkerRunner.launch(MyWorkerEffect, { ... }).pipe(
  Layer.provide(BunWorkerRunner.layer),
  Layer.launch,
  BunRuntime.runMain
)
```

**3. Browser Web Workers.** `BrowserWorker.layer` spawns `Worker`, `SharedWorker`, or `MessagePort`-based workers:

```ts
import { BrowserWorker } from "@effect/platform-browser"
// repos/effect/packages/platform-browser/src/BrowserWorker.ts:19-25
const WorkerLive = BrowserWorker.layer((id) => new Worker("/worker.js"))
```

**4. Browser event streams.** `BrowserStream.fromEventListenerWindow` converts any `WindowEventMap` event into a typed `Stream` that removes its listener when the scope closes:

```ts
import { BrowserStream } from "@effect/platform-browser"
// repos/effect/packages/platform-browser/src/BrowserStream.ts:8-20
const clicks = BrowserStream.fromEventListenerWindow("click")
```

**5. RcRef for a single shared resource.** When all fibers share exactly one resource (not keyed), use `RcRef.make` instead of `RcMap.make`:

```ts
import { Effect, RcRef } from "effect"
// repos/effect/packages/effect/src/RcRef.ts:68-109
const clipboardRef = yield* RcRef.make({
  acquire: Effect.sync(() => navigator.clipboard),
  idleTimeToLive: "5 seconds"
})
const clipboard = yield* RcRef.get(clipboardRef)
```

**6. Session vs persistent storage.** Switch between `layerLocalStorage` (persists across sessions) and `layerSessionStorage` (cleared on tab close) at the layer composition site — the `KeyValueStore` consumer is unchanged:

```ts
import { BrowserKeyValueStore } from "@effect/platform-browser"
// repos/effect/packages/platform-browser/src/BrowserKeyValueStore.ts:8-22
const StoreLive = BrowserKeyValueStore.layerSessionStorage
```

---

## Anti-patterns

**1. Direct `Bun.serve` inside Effect.**

```ts
// Wrong — Bun.serve is called directly; no graceful shutdown, no Layer lifecycle.
const program = Effect.sync(() => {
  Bun.serve({
    port: 3000,
    fetch: (req) => new Response("hello")
  })
})
```

```ts
// Correct — BunHttpServer.layer manages the server lifecycle via Layer.scoped.
// repos/effect/packages/platform-bun/src/BunHttpServer.ts:47-53
const ServerLive = BunHttpServer.layer({ port: 3000 })
const app = HttpServer.serve(handler).pipe(Layer.provide(ServerLive))
BunRuntime.runMain(Layer.launch(app))
```

**2. Direct `fetch` inside Effect in the browser.**

```ts
// Wrong — raw fetch bypasses the HttpClient abstraction layer.
// Errors are untyped (unknown), the request is untraceable, and there is
// no way to inject a test client.
const program = Effect.tryPromise(() => fetch("/api/data"))
```

```ts
// Correct — use BrowserHttpClient.layerXMLHttpRequest and HttpClient.
// repos/effect/packages/platform-browser/src/BrowserHttpClient.ts:12-16
const program = HttpClient.HttpClient.pipe(
  Effect.andThen((client) => client.execute(HttpClientRequest.get("/api/data")))
)
Effect.provide(program, BrowserHttpClient.layerXMLHttpRequest)
```

**3. One connection per fiber instead of RcMap.**

```ts
// Wrong — every fiber opens and closes its own IDBDatabase connection.
// IDB connection open is expensive and the browser limits concurrent opens.
const getItem = (key: string) =>
  Effect.gen(function*() {
    const db = yield* Effect.promise(() => new Promise((res) => {
      const r = indexedDB.open("cache"); r.onsuccess = () => res(r.result)
    }))
    // ... use db
    db.close()
  })
```

```ts
// Correct — RcMap shares one connection across all concurrent fibers.
// The connection is released only when all fibers holding it release their scopes.
const dbMap = yield* RcMap.make({
  lookup: (name: string) => Effect.acquireRelease(openIDB(name), (db) => Effect.sync(() => db.close()))
})
const db = yield* RcMap.get(dbMap, "cache")
```

**4. Releasing an RcRef scope early.**

```ts
// Wrong — calling Effect.scoped on the RcRef.get immediately closes the
// scope and releases the resource, even if other fibers still need it.
const resource = yield* RcRef.get(ref).pipe(Effect.scoped)  // released immediately
yield* doWorkWith(resource)  // resource is already closed
```

```ts
// Correct — keep the scope open for the duration of the work.
yield* Effect.scoped(
  Effect.gen(function*() {
    const resource = yield* RcRef.get(ref)  // acquired; scope holds reference
    return yield* doWorkWith(resource)       // resource released when scope exits here
  })
)
```

---

## See also

- [Chapter 09 — Layer: building, merging, and providing services](../part-1-foundations/09-layer.md) — the Layer composition model used by `BunContext.layer` and `ImageCacheService.Default`.
- [Chapter 10 — Layer.scoped and Scope: resource lifecycles](../part-1-foundations/10-layer-scoped-and-scope.md) — `Layer.scoped` is the composition point for `RcRef`/`RcMap`; Chapter 10 explains `Effect.acquireRelease` and scope finalizer ordering.
- [Chapter 22 — Platform services: the abstract runtime layer](./22-platform.md) — defines the `HttpClient`, `KeyValueStore`, and `FileSystem` tags that both packages implement.
- [Chapter 23 — Platform on Node.js: HTTP server, file system, and subprocess](./23-platform-node.md) — the Node.js sibling; compare `NodeHttpServer.layer` with `BunHttpServer.layer` and `NodeContext.layer` with `BunContext.layer`.
- [Patterns catalog: RcRef and RcMap — reference-counted resources](../../research/02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources) — the canonical pattern entry; covers `Pool.make` as the alternative when concurrency limits matter.
- [Per-package notes: @effect/platform-bun](../../research/packages/platform-bun.md) — covers the hot-reload handler stack, Bun.file zero-copy serving, and open questions around `BunClusterHttp`.
- [Per-package notes: @effect/platform-browser](../../research/packages/platform-browser.md) — covers the XHR streaming approach, shared-worker port lifecycle, and the `beforeunload` interrupt pattern.
