# @effect/platform-browser

> Source: `repos/effect/packages/platform-browser/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: platform
> Effect deps: `@effect/platform` (peer), `effect` (peer)

## What it does

`@effect/platform-browser` is the browser implementation of the runtime-agnostic `@effect/platform` interface layer. App code that depends only on platform abstractions (`HttpClient`, `KeyValueStore`, `Worker`, `Socket`) can swap in this package's layers to run inside a browser tab or a Web Worker — no Node.js APIs required. Without this package, teams would either ship Node-oriented code to the browser and polyfill everything, or hand-roll their own fetch/localStorage/Worker wrappers outside the Effect service graph. The package also ships three browser-only services that have no `@effect/platform` counterpart: `Clipboard`, `Geolocation`, and `Permissions`.

## Public API surface

All ten modules are re-exported from `src/index.ts` (`repos/effect/packages/platform-browser/src/index.ts:1-50`). Grouped by purpose:

**Platform interface implementations** (fulfill contracts defined in `@effect/platform`):

- **`BrowserHttpClient`** — provides `layerXMLHttpRequest` (an `HttpClient` layer backed by `XMLHttpRequest`) and the `XMLHttpRequest` context tag, letting callers inject a custom XHR factory for testing. Also exposes `currentXHRResponseType` (`FiberRef`) and `withXHRArrayBuffer` to switch between text and binary responses on a per-fiber basis. (`repos/effect/packages/platform-browser/src/BrowserHttpClient.ts:16-37`)
- **`BrowserKeyValueStore`** — two layers: `layerLocalStorage` and `layerSessionStorage`, both implementing the `@effect/platform` `KeyValueStore` interface. Implementation is two one-liners delegating to `KeyValueStore.layerStorage`. (`repos/effect/packages/platform-browser/src/BrowserKeyValueStore.ts:14-22`, `repos/effect/packages/platform-browser/src/internal/keyValueStore.ts:1-7`)
- **`BrowserWorker`** — wraps `Worker`, `SharedWorker`, and `MessagePort` as Effect `Worker` services. Exports `layerWorker`, `layerManager`, `layer` (spawner + manager together), and `layerPlatform`. (`repos/effect/packages/platform-browser/src/BrowserWorker.ts:11-34`)
- **`BrowserWorkerRunner`** — runs an Effect program inside a Web Worker or `MessagePort`, acting as the worker-side counterpart to `BrowserWorker`. Handles both dedicated and shared workers, including cached port collection for shared workers that connect before the runner starts. (`repos/effect/packages/platform-browser/src/BrowserWorkerRunner.ts:8-33`)
- **`BrowserSocket`** — `layerWebSocket` and `layerWebSocketConstructor` wrapping `globalThis.WebSocket` as a `Socket`. (`repos/effect/packages/platform-browser/src/BrowserSocket.ts:11-25`)

**Browser-only utilities:**

- **`BrowserRuntime`** — `runMain` wired to interrupt the root fiber on the `beforeunload` window event, providing clean teardown when the user navigates away. (`repos/effect/packages/platform-browser/src/internal/runtime.ts:1-8`)
- **`BrowserStream`** — `fromEventListenerWindow` and `fromEventListenerDocument`: typed `Stream` factories over DOM event listeners, parameterized by `WindowEventMap` / `DocumentEventMap` keys. (`repos/effect/packages/platform-browser/src/BrowserStream.ts:11-34`)
- **`Clipboard`** — full `Clipboard` service interface with `read`, `readString`, `write`, `writeString`, `writeBlob`, and `clear`, backed by `navigator.clipboard`. Errors surface as `ClipboardError` (typed via `TypeIdError`). (`repos/effect/packages/platform-browser/src/Clipboard.ts:25-55`)
- **`Geolocation`** — `getCurrentPosition` (single `Effect`) and `watchPosition` (continuous `Stream`), backed by `navigator.geolocation`. A sliding `Queue` of size 16 bridges the callback-based Watch API into the Effect world. (`repos/effect/packages/platform-browser/src/Geolocation.ts:29-125`)
- **`Permissions`** — wraps `navigator.permissions.query` as a typed `Effect`, distinguishing `InvalidStateError` from `TypeError` at the type level. (`repos/effect/packages/platform-browser/src/Permissions.ts:28-98`)

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — most services in this package are delivered as `Layer.succeed(Tag, impl)` since the browser globals they wrap are synchronous and always available; `Clipboard` and `Permissions` are the canonical examples (`repos/effect/packages/platform-browser/src/Clipboard.ts:85-86`, `repos/effect/packages/platform-browser/src/Permissions.ts:84-85`)
- [Effect.succeed / fail / sync / promise / tryPromise](../02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise) — every `navigator.*` API call is wrapped with `Effect.tryPromise` that maps the rejection to a typed `*Error` class (`repos/effect/packages/platform-browser/src/Clipboard.ts:88-122`, `repos/effect/packages/platform-browser/src/Permissions.ts:89-96`)
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `Geolocation.watchPosition` uses `Effect.acquireRelease` to register `navigator.geolocation.watchPosition` and guarantee `clearWatch` runs on scope close (`repos/effect/packages/platform-browser/src/Geolocation.ts:84-101`)
- [Stream.async* family (asyncPush, fromAsyncIterable)](../02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable) — `BrowserHttpClient`'s internal streaming uses `Stream.async` to emit XHR `readystatechange` events as a `Stream<Uint8Array>` (`repos/effect/packages/platform-browser/src/internal/httpClient.ts:217-241`)
- [FiberRef — fiber-local state](../02-patterns-catalog.md#fiberref--fiber-local-state) — `currentXHRResponseType` is a `FiberRef` so individual requests can switch to `arraybuffer` response mode without affecting sibling fibers (`repos/effect/packages/platform-browser/src/internal/httpClient.ts:25-28`, `repos/effect/packages/platform-browser/src/internal/httpClient.ts:31-36`)
- [The internal/ folder and index.ts re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all implementation details live under `src/internal/`; public modules are thin façades that re-export from `./internal/*` (`repos/effect/packages/platform-browser/src/BrowserHttpClient.ts:10`, `repos/effect/packages/platform-browser/src/BrowserKeyValueStore.ts:6`)
- [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `BrowserWorkerRunner`'s internal implementation uses `FiberSet` to track per-port handler fibers and propagate uncaught failures to the worker's close latch (`repos/effect/packages/platform-browser/src/internal/workerRunner.ts:49-50`)

## What's unique about this package's design

The package teaches the full taxonomy of what the browser can and cannot do inside the `@effect/platform` contract. `FileSystem` and command execution are simply absent — there are no stubs or `Effect.die` placeholders, the interfaces are not provided at all. What is present instead is a set of browser-native extras (`Clipboard`, `Geolocation`, `Permissions`) that have no Node.js equivalent, defined with their own service tags and typed errors following exactly the same conventions as the shared platform interfaces.

The XHR client (`src/internal/httpClient.ts`) is the most instructive piece: it cannot use Node's `http` module or the `fetch` stream API uniformly, so it emulates streaming by tracking `responseText` offsets across `readyState === 3` events (`repos/effect/packages/platform-browser/src/internal/httpClient.ts:218-228`). The same file demonstrates lazy response caching via `Effect.cached` applied inside an `Effect.async` callback (`repos/effect/packages/platform-browser/src/internal/httpClient.ts:197-199`), a pattern that avoids re-registering event listeners for repeated `.text` reads.

The `BrowserWorkerRunner` handles an edge case specific to shared workers: the `onconnect` handler may fire before the Effect runtime starts. The solution is a module-level `cachedPorts` set populated synchronously at import time, then drained when the runner's `run` function takes over (`repos/effect/packages/platform-browser/src/internal/workerRunner.ts:17-22`, `repos/effect/packages/platform-browser/src/internal/workerRunner.ts:124-126`). This is a clean example of bridging the imperative browser lifecycle with Effect's managed startup.

## Conventions observed

The package follows all standard conventions from `research/03-conventions.md` without deviation:

- **Layout**: `src/` for public modules, `src/internal/` for implementations, `test/` colocated, `vitest.config.ts` delegates to the monorepo shared config.
- **Module naming**: every public module uses the `Browser*` prefix to signal it is platform-specific (e.g., `BrowserHttpClient`, `BrowserWorker`). Browser-only services (`Clipboard`, `Geolocation`, `Permissions`) omit the prefix because they have no cross-platform counterpart to disambiguate.
- **Error shape**: all errors use `TypeIdError` from `@effect/platform/Error` with a `TypeId` symbol keyed to the package name (`repos/effect/packages/platform-browser/src/Clipboard.ts:13`, `repos/effect/packages/platform-browser/src/Geolocation.ts:67-73`), matching the platform convention.
- **No runtime `dependencies`**: the only non-Effect dependency listed in `dependencies` is `multipasta` (used for header parsing in the XHR client — `repos/effect/packages/platform-browser/package.json:61-63`). Everything else is a peer.

## "If you were authoring something similar, copy this"

- **`FiberRef` for per-request behavior flags**: `currentXHRResponseType` shows how to expose a tuneable parameter (text vs. arraybuffer) that applies for the duration of a single request without threading it through every call site (`repos/effect/packages/platform-browser/src/internal/httpClient.ts:25-36`).
- **`Layer.succeed` with an inline `make` factory**: `Clipboard.layer` uses `Layer.succeed(Tag, make({...}))` where `make` fills in derived operations (`clear` and `writeBlob`) from the primitives supplied by the caller, reducing the required surface to implement (`repos/effect/packages/platform-browser/src/Clipboard.ts:69-123`).
- **Bridging callback watchers to `Stream` via a sliding `Queue`**: the `Geolocation.watchPosition` pattern (create a bounded queue, register the callback to `unsafeOffer`, `Stream.fromQueue`) is directly reusable for any browser push API (battery status, network state, device orientation) (`repos/effect/packages/platform-browser/src/Geolocation.ts:76-101`).
- **Synchronous bootstrap caching for race conditions**: capturing in-flight `MessagePort` connections in a module-level `Set` before the runtime starts, then draining it once the Effect program is ready, solves a class of race conditions in shared workers without any polling (`repos/effect/packages/platform-browser/src/internal/workerRunner.ts:17-26`).
- **`beforeunload` as an interrupt signal**: wiring `runMain` to call `fiber.unsafeInterruptAsFork` on `beforeunload` gives Effect programs a chance to run finalizers on page unload — a two-line pattern worth copying for any SPA runtime entry point (`repos/effect/packages/platform-browser/src/internal/runtime.ts:4-7`).

## Open questions

- **No `fetch`-based `HttpClient`**: the XHR client is the only HTTP implementation. `fetch` supports streaming request bodies natively in modern browsers, while XHR streams bodies by collecting chunks from `responseText`. Is the XHR choice intentional for wider compatibility, or is a `fetch`-backed layer planned? `BrowserSocket` uses `globalThis.WebSocket` directly, so there is precedent for trusting modern browser globals.
- **`formData` is unimplemented**: `ClientResponseImpl.get formData` returns `Effect.die("Not implemented")` (`repos/effect/packages/platform-browser/src/internal/httpClient.ts:306`). This is a defect (die), not a typed error, which would silently crash callers that depend on multipart response parsing.
- **`Geolocation.watchPosition` error enumeration**: `PositionUnavailable` is not included in the error callback handler — only `PERMISSION_DENIED` and `TIMEOUT` are mapped; any other `PositionError.code` value is silently dropped (`repos/effect/packages/platform-browser/src/Geolocation.ts:90-95`).
- **SharedWorker port lifecycle**: when the last port sends a close message (`[1]`), the worker closes with `Exit.void` (`repos/effect/packages/platform-browser/src/internal/workerRunner.ts:70-75`). It is unclear whether this triggers the `self.close()` finalizer registered only for shared workers or whether the outer scope simply unwinds. Documentation on expected multi-consumer teardown behaviour is missing.
