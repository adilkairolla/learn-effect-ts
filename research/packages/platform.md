# @effect/platform

> Source: `repos/effect/packages/platform/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: platform
> Effect deps: `effect` (peer, `workspace:^`) — see `repos/effect/packages/platform/package.json:54-56`

## What it does

`@effect/platform` is the abstract-interface layer that defines every IO-touching service an application might need — file system access, process spawning, HTTP client, HTTP server, web workers, key-value storage, terminal IO — without tying any of it to a concrete runtime. Application code programs against the typed `Tag`-keyed service interfaces declared here; platform implementations (`platform-node`, `platform-bun`, `platform-browser`) then provide those services as `Layer`s. Without this package, every library that touches IO would have to hard-code Node.js APIs or ship three divergent copies of itself; instead, they depend only on the abstract contracts here and let the caller inject the runtime layer.

The package also ships the full `HttpApi*` subsystem: a contract-first way to define HTTP APIs as typed schemas that can simultaneously drive server implementations, client derivation, and OpenAPI/Swagger documentation generation from a single definition — see `repos/effect/packages/platform/README.md:14-43`.

## Public API surface

The `src/index.ts` re-exports ~50 modules by namespace. Grouped by purpose below; all files are under `repos/effect/packages/platform/src/`.

**OS-level IO services (abstract contracts)**

- `FileSystem` (`src/FileSystem.ts`) — the core FS interface: `Tag<FileSystem, FileSystem>` exported at line 460, a rich interface with `readFile`, `writeFile`, `open` (scoped handle), `readDirectory`, `watch` (returns a `Stream`), `makeTempDirectoryScoped`, and Posix helpers (`chmod`, `chown`, `link`, `readLink`). File handles are scope-bound; the `open` method returns `Effect<File, PlatformError, Scope>` (`src/FileSystem.ts:127-130`). Also exposes a `Size` branded bigint type and byte-count constants (`KiB`, `MiB`, `GiB`, `TiB`, `PiB`) (`src/FileSystem.ts:269-313`).
- `Path` (`src/Path.ts`) — platform path operations as a service. The `Path` tag and a concrete `layer` (POSIX-based, usable even in browsers) are exported directly (`src/Path.ts:66-77`). Methods like `fromFileUrl`/`toFileUrl` return `Effect<…, BadArgument>` rather than throwing (`src/Path.ts:34-41`).
- `CommandExecutor` (`src/CommandExecutor.ts`) — the Tag-keyed service for running child processes. Methods: `exitCode`, `start` (scoped `Process` handle), `string`, `lines`, `stream`, `streamLines` — the last two return `Stream<Uint8Array | string, PlatformError>` (`src/CommandExecutor.ts:31-64`).
- `Command` (`src/Command.ts`) — pure value-level description of a process invocation. The `Command` union is `StandardCommand | PipedCommand`; `CommandInput` is `"inherit" | "pipe" | Stream<Uint8Array, PlatformError>` so stdin can be fed from an Effect stream (`src/Command.ts:72`).
- `Terminal` (`src/Terminal.ts`) — interactive terminal service: `columns`, `rows`, `isTTY`, `readInput` (returns `ReadonlyMailbox<UserInput>`), `readLine`, `display` (`src/Terminal.ts:20-45`).
- `KeyValueStore` (`src/KeyValueStore.ts`) — generic string/bytes KV interface (`get`, `set`, `remove`, `clear`, `size`, `modify`). Ships three built-in layers: `layerMemory` (in-process), `layerFileSystem` (file-backed, requires `FileSystem & Path`), plus a `layerStorage` (browser `localStorage`) provided by `platform-browser`. The `forSchema` method wraps raw bytes in a typed `SchemaStore<A, R>` using `effect/Schema` (`src/KeyValueStore.ts:93`). Accepts a minimal `impl` at construction — derived methods (`has`, `modify`, `isEmpty`, `forSchema`) are computed from primitives (`src/KeyValueStore.ts:116-120`).

**HTTP client stack**

- `HttpClient` (`src/HttpClient.ts`) — the abstract HTTP client. `HttpClient.With<E, R>` has `execute`, `get`, `post`, `put`, `patch`, `del`, `head`, `options` — all returning `Effect<HttpClientResponse, E, R>` (`src/HttpClient.ts:48-80`). Pipeable so `client.pipe(HttpClient.filterStatusOk, HttpClient.mapRequest(…))` chains work.
- `FetchHttpClient` (`src/FetchHttpClient.ts`) — the cross-platform `HttpClient` layer backed by the global `fetch`. Provides two Tags (`Fetch`, `RequestInit`) for overriding fetch and default options (`src/FetchHttpClient.ts:13-25`). This is the only built-in HttpClient implementation bundled in the abstract package itself.
- `HttpClientRequest` / `HttpClientResponse` / `HttpClientError` — request/response/error value types for the client stack.
- `Cookies` / `Headers` / `UrlParams` / `HttpBody` — typed wrappers for HTTP primitives that both client and server modules share.

**HTTP server stack**

- `HttpServer` (`src/HttpServer.ts`) — service interface with a single `serve` method that takes an `HttpApp.Default<E, R>` (optionally plus a middleware) and produces an `Effect<void, never, Exclude<R, HttpServerRequest> | Scope>` (`src/HttpServer.ts:36-52`). The `Address` type is a `TcpAddress | UnixAddress` discriminated union (`src/HttpServer.ts:66-76`).
- `HttpRouter` (`src/HttpRouter.ts`) — immutable typed router. `HttpRouter<E, R>` holds `routes: Chunk<Route<E, R>>` and `mounts` (`src/HttpRouter.ts:47-58`). Uses `find-my-way-ts` (a declared `dependency` in `package.json:49-52`) for route matching at runtime. Routes expose `RouteContext` (path params, matched route info) as a service in the handler's `R`.
- `HttpMiddleware` (`src/HttpMiddleware.ts`) — structural `HttpApp → HttpApp` transform. Built-in middlewares include `logger`, `cors`, `xForwardedHeaders`, `searchParamsParser`, and tracer-suppression helpers (`withTracerDisabledWhen`, `withTracerDisabledForUrls`); all are plain functions on `HttpApp` rather than framework plugins (`src/HttpMiddleware.ts:36-43`).
- `HttpServerRequest` / `HttpServerResponse` / `HttpServerRespondable` / `HttpServerError` — typed server-side message and error types.
- `HttpPlatform` (`src/HttpPlatform.ts`) — the one hook implementations must fill for file-serving: `fileResponse` and `fileWebResponse`, exposed as a `Tag<HttpPlatform, HttpPlatform>` (`src/HttpPlatform.ts:31-47`). Platform packages implement this using their native file streaming.
- `HttpApp` / `HttpMultiplex` / `HttpLayerRouter` — app-level composition helpers.

**HttpApi: contract-first API design**

- `HttpApi` (`src/HttpApi.ts`) — the top-level API container. Phantom types track all `Groups`, their accumulated `Error` union, and context requirements `R`. Composed with `.add(group)` or `.addHttpApi(otherApi)` (`src/HttpApi.ts:46-74`).
- `HttpApiGroup` (`src/HttpApiGroup.ts`) — a named collection of endpoints with its own error schema and middleware set (`src/HttpApiGroup.ts:41-55`).
- `HttpApiEndpoint` (`src/HttpApiEndpoint.ts`) — individual endpoint: typed `Name`, `Method`, `Path`, `UrlParams`, `Payload`, success/error `Schema`. A `PathSegment` is `/${string}` branded (`src/HttpApiEndpoint.ts:46`).
- `HttpApiBuilder` (`src/HttpApiBuilder.ts`) — turns an `HttpApi` declaration into a running `Layer`. The `api(myApi)` function produces a `Layer<HttpApi.Api, never, GroupServices | R>` that wires all handler services into the HTTP server (`src/HttpApiBuilder.ts:59-69`).
- `HttpApiClient` — derives a fully-typed `Effect`-returning client from the same `HttpApi` definition.
- `HttpApiMiddleware` / `HttpApiSecurity` / `HttpApiSchema` / `HttpApiError` / `HttpApiSwagger` / `HttpApiScalar` — middleware, security (bearer/API-key/basic auth), schema helpers, standard errors, and Swagger/Scalar UI serving.
- `OpenApi` / `OpenApiJsonSchema` — OpenAPI 3 document generation from `HttpApi` definitions.

**Workers**

- `Worker` (`src/Worker.ts`) — typed worker abstraction. `Worker<I, O, E>` wraps a `BackingWorker` with `execute` (returns `Stream<O, E | WorkerError>`) and `executeEffect` (`src/Worker.ts:91-95`). `WorkerPool<I, O, E>` wraps `Pool.Pool<Worker, WorkerError>` from `effect/Pool` and adds `broadcast` (`src/Worker.ts:163-168`). `PlatformWorker` is the Tag that implementations fill with `spawn` (`src/Worker.ts:57-59`).
- `WorkerRunner` (`src/WorkerRunner.ts`) — the counterpart that runs inside a worker thread. `PlatformRunner` is the abstract Tag; `BackingRunner<I, O>` carries `run`, `send`, and optional `disconnects` mailbox (`src/WorkerRunner.ts:19-29`).
- `WorkerError` / `MsgPack` / `Transferable` — serialisation and error types for the worker boundary.

**Miscellaneous platform utilities**

- `Socket` / `SocketServer` (`src/Socket.ts`, `src/SocketServer.ts`) — abstract TCP/Unix/WebSocket transport using `Channel`.
- `PlatformConfigProvider` (`src/PlatformConfigProvider.ts`) — reads Effect `Config` values from the filesystem via `fromFileTree`, which walks a directory tree to populate a `ConfigProvider` (`src/PlatformConfigProvider.ts:25-40`).
- `PlatformLogger` — writes structured logs to a platform file handle.
- `Multipart` / `Ndjson` / `Etag` / `Template` — multipart form parsing (uses `multipasta` dependency), NDJSON framing, ETag generation, and HTML template helpers.
- `Effectify` (`src/Effectify.ts`) — type-level utility that converts Node-style callback overloads (up to 10 overloads) into overloads returning `Effect`. Used internally by `platform-node` to wrap `node:fs` (`src/Effectify.ts:20-40`).
- `ChannelSchema` — `Schema`-aware `Channel` encoding/decoding helpers.
- `Runtime` (`src/Runtime.ts`) — re-exports `runMain` (process-exit-aware runner) for CLI/server entrypoints.
- `Error` (`src/Error.ts`) — base platform error types: `BadArgument` (with `module` + `method` fields) and `SystemError` (with `reason: SystemErrorReason`, structured as `Schema.TaggedError`) (`src/Error.ts:69-138`). The `Module` literal union enumerates all IO modules: `"Clipboard" | "Command" | "FileSystem" | "KeyValueStore" | "Path" | "Stream" | "Terminal"` (`src/Error.ts:55-63`).

## Patterns used

- [Tag class / `Context.GenericTag`](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — every IO service (`FileSystem`, `Path`, `CommandExecutor`, `KeyValueStore`, `Terminal`, `HttpPlatform`, `PlatformWorker`, etc.) is a `Tag<Service, Service>`. Callers never import a concrete implementation; they `yield*` the tag to get the live service. For example, `FileSystem.FileSystem` at `src/FileSystem.ts:460` and `Path.Path` at `src/Path.ts:66`.
- [Layer constructors (`succeed` / `effect` / `scoped`)](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — platform implementations provide their concrete FS, server, and worker services as `Layer`s. `KeyValueStore.layerMemory`, `KeyValueStore.layerFileSystem`, and `Path.layer` are examples bundled in this package itself (`src/KeyValueStore.ts:145-154`, `src/Path.ts:77`).
- [`Schema.Struct` and `Schema.TaggedError`](../02-patterns-catalog.md#schemastruct) — `BadArgument` and `SystemError` extend `Schema.TaggedError`, making every platform error serialisable, decodable, and matchable with `Effect.catchTag` (`src/Error.ts:69-86`, `src/Error.ts:116-138`).
- [`Effect.acquireRelease` / `acquireUseRelease`](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — scoped resource handles are pervasive. `FileSystem.open` returns `Effect<File, PlatformError, Scope>`; `CommandExecutor.start` returns `Effect<Process, PlatformError, Scope>` (`src/FileSystem.ts:127-130`, `src/CommandExecutor.ts:42`). Callers place these inside a `Scope` or `Effect.scoped` and cleanup is guaranteed.
- [Pool](../02-patterns-catalog.md#poolmake--poolmakewithttl-and-keyedpool) — `WorkerPool<I, O, E>` wraps `Pool.Pool<Worker<I, O, E>, WorkerError>` directly, inheriting all pooling strategies (fixed size, min/max with TTL) from Effect core (`src/Worker.ts:163-193`).
- [`Stream.make` / `fromIterable` / `fromEffect`](../02-patterns-catalog.md#streammake--fromiterable--fromeffect) — streaming IO surfaces return `Stream` throughout: `FileSystem.watch` returns `Stream<WatchEvent, PlatformError>` (`src/FileSystem.ts:244`); `CommandExecutor.stream` / `streamLines` return `Stream<Uint8Array | string, PlatformError>` (`src/CommandExecutor.ts:59-63`); `Worker.execute` returns `Stream<O, E | WorkerError>` (`src/Worker.ts:93`).
- [Dual data-first / data-last](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `HttpClient`, `HttpRouter`, `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `Command`, and `KeyValueStore` all implement the `Pipeable` interface and use `pipeArguments` — enabling fluent `.pipe()` chains on every value. `KeyValueStore.prefix` is explicitly dual (`src/KeyValueStore.ts:136-139`).
- [`FiberRef`](../02-patterns-catalog.md#fiberref--fiber-local-state) — `HttpMiddleware` uses `FiberRef` to propagate per-request state; `loggerDisabled` is a `FiberRef<boolean>` used to silence the built-in HTTP access logger per-request (`src/HttpMiddleware.ts:49`).

## What's unique about this package's design

The defining idea is **contract-first, runtime-last**: every IO surface that differs between Node.js, Bun, and a browser is expressed as a `Tag`-keyed interface with zero concrete imports. Application code `yield*`s `FileSystem.FileSystem`, `CommandExecutor.CommandExecutor`, or `HttpServer.HttpServer` the same way it would yield any other Effect service; the implementation is injected via `Layer` at the program's entry point. This means a library written against `@effect/platform` compiles and tree-shakes with no changes across all three runtimes — a design that would require separate adapter packages in most ecosystems.

The `HttpApi` subsystem pushes this contract-first discipline one level further: a single typed `HttpApi` value is simultaneously the source of truth for the router, the OpenAPI document, and a derived fully-typed client. The phantom-type accumulation pattern in `HttpApi<Id, Groups, E, R>` (see `src/HttpApi.ts:46-74`) tracks every group, error variant, and context requirement at compile time — the `HttpApiBuilder.api` constructor fails to compile if any group's handler service is not provided in the layer graph (`src/HttpApiBuilder.ts:59-69`). This is the most complete example in the Effect monorepo of using TypeScript's type system to enforce compositional completeness at build time rather than at runtime.

The `Effectify` type utility (`src/Effectify.ts:20-40`) is a compact solution to the classic callback-wrapping problem: instead of writing one `Effect.tryPromise` wrapper per `node:fs` method, `Effectify<T, E>` rewrites up to 10 overload signatures into their `Effect`-returning equivalents in a single mapped-type pass. Platform implementation packages can wrap entire Node.js callback APIs without boilerplate.

Error taxonomy across all IO modules is unified under two `Schema.TaggedError` classes in `src/Error.ts`: `BadArgument` (wrong input, programmer error) and `SystemError` (OS-level failure with a `SystemErrorReason` discriminant — `NotFound`, `PermissionDenied`, `TimedOut`, etc.). Every module that can fail at the OS level uses these two types, so callers can use `Effect.catchTag("SystemError", …)` uniformly across FS, Command, and KVS operations.

## Conventions observed

- **No concrete runtime imports at the package boundary.** `package.json` lists only `find-my-way-ts`, `msgpackr`, and `multipasta` as runtime `dependencies` — all are bundling utilities (routing, MessagePack serialisation, multipart parsing) that are portable. There are no `node:*`, `bun:*`, or browser globals imported in any `src/*.ts` file; those live exclusively in the platform-specific packages.
- **`internal/` folder is sealed.** All modules under `src/internal/` are private; the `package.json` explicitly maps `"./internal/*": null` in exports (`repos/effect/packages/platform/package.json:36`). Public modules re-export from `internal/` but never expose its internal symbols directly.
- **`FileSystem.make` accepts a minimal impl.** The constructor omits derived methods — `exists`, `readFileString`, `stream`, `sink`, `writeFileString` — and fills them in from primitives (`src/FileSystem.ts:466-468`). `KeyValueStore.make` does the same for `has`, `modify`, `modifyUint8Array`, `isEmpty`, `forSchema` (`src/KeyValueStore.ts:116-120`). This reduces the surface an implementation author must supply.
- **Scoped resources follow the `…Scoped` naming convention.** Temporary-resource variants are always named `makeTempDirectoryScoped` / `makeTempFileScoped` (`src/FileSystem.ts:102-121`), making the Scope dependency visible in the name, not just in the type.
- **`TypeId` is a `unique symbol` per module.** All service interfaces carry `readonly [TypeId]: TypeId` as a nominal brand (`FileSystem.ts:460`, `CommandExecutor.ts:20-25`, `HttpClient.ts:26-29`, etc.). Guards (`isPlatformError`, `isHttpApi`, `isHttpApiEndpoint`) use `Predicate.hasProperty(u, TypeId)` rather than `instanceof`, matching the Effect-wide convention.
- **Modules are fully namespace-re-exported from `src/index.ts`** using `export * as Foo from "./Foo.js"` — 50+ namespaces, none flat-lifted except through their namespace (`src/index.ts:1-301`). Diverges from `effect` core which flat-lifts a few utility functions.

## "If you were authoring something similar, copy this"

- **Express every IO surface as a `Tag<Service, Service>` interface, ship a default implementation as a `Layer`.** The `Path.Path` tag + `Path.layer` (a POSIX implementation that works in browsers) at `src/Path.ts:66-77` is the minimal template: define the interface, define the `Tag`, export a concrete `layer`. Callers can swap the layer in tests without touching business logic.
- **Use `Schema.TaggedError` for all typed errors and build a shared `Module` discriminant.** The `Module` literal union at `src/Error.ts:55-63` means every error carries its origin module name as a string literal, enabling precise `Effect.catchTag` handlers and structured logging without custom `instanceof` checks.
- **Derive methods from a minimal `impl` at construction time.** `KeyValueStore.make` computes `has`, `isEmpty`, `modify`, `modifyUint8Array`, `forSchema` from four primitive operations (`src/KeyValueStore.ts:116-120`). This lets third-party backends (Redis, SQLite, OPFS) implement only the irreducible surface and get the full API for free.
- **Model stdin/stdout/stderr as `Stream<Uint8Array>` / `Sink<void>`.** `CommandInput` is `"inherit" | "pipe" | Stream<Uint8Array, PlatformError>` (`src/Command.ts:72`). Passing a `Stream` as stdin unifies process orchestration with all other streaming combinators in Effect — no special pipe() APIs needed.
- **Accumulate API shape in phantom type parameters.** `HttpApi<Id, Groups, E, R>` and `HttpApiGroup<Id, Endpoints, Error, R, TopLevel>` grow their type parameters with each `.add()` call (`src/HttpApi.ts:46-74`, `src/HttpApiGroup.ts:41-55`). The builder is total — adding an endpoint without implementing it is a compile error. Copy this pattern for any system where "all declared parts must be implemented."
- **Use `find-my-way-ts` via a direct dependency, not a peer.** The router (`src/HttpRouter.ts:16`) depends on the portable TypeScript port of `find-my-way`, making the same router tree usable on Node.js, Bun, and edge runtimes without any native bindings.

## Open questions

- **`HttpApiSwagger` vs `HttpApiScalar`**: Both modules exist (`src/index.ts:89-104`). It is unclear whether they generate the same OpenAPI UI via different renderers or serve different documentation formats. The difference in bundled JS size and CDN dependencies between the two is not documented.
- **`ChannelSchema` (`src/ChannelSchema.ts`)**: This module is exported but its relationship to `MsgPack` and `Socket` is not immediately obvious from the type signatures. Whether it is the intended codec layer for `WorkerRunner` or purely for custom `Socket` protocols needs a worked example to confirm.
- **`FetchHttpClient` in the abstract package**: `FetchHttpClient` provides a concrete `Layer<HttpClient>` backed by `globalThis.fetch` (`src/FetchHttpClient.ts:25`). It is the only concrete implementation shipped in `@effect/platform` itself rather than a platform-specific child package. The criterion for what counts as "portable enough to live here" versus "must live in platform-node" is not stated; `FileSystem` clearly cannot, but `fetch` apparently can.
- **Worker serialisation protocol**: The `Worker.Request` and `Worker.Response` tuple formats (`src/Worker.ts:136-156`) appear to be a bespoke binary framing. Whether `MsgPack` is always used or only when the caller opts in via `encode` is not immediately clear from the abstract interface.
- **`HttpLayerRouter` vs `HttpRouter`**: Two router modules are exported (`src/index.ts:144`, `src/index.ts:170`). `HttpLayerRouter` appears to be a `Layer`-based alternative routing approach rather than a value-based one. The migration guidance (when to use each) is missing from the README.
