# Chapter 22 — Platform services — the abstract runtime layer

> **Package(s):** `@effect/platform`
> **Patterns introduced:** [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape)
> **Reads from:** Chapter 09 (Layer — building, merging, and providing services), Chapter 14 (Schema part 1 — declaring shapes), Chapter 16 (Stream — pull-based async iteration)
> **Reads into:** Chapter 23 (platform-node — HTTP server, file system, and subprocess), Chapter 24 (platform-bun-browser — platform implementations), Chapter 25 (sql-core — the @effect/sql abstraction layer)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Every real application touches IO: it reads files, opens sockets, spawns child processes, or makes HTTP requests. The problem is that these operations are not portable. Node.js, Bun, and the browser all provide different APIs for the same conceptual operations, and those differences proliferate through every layer of your code.

Consider a simple function that downloads a URL and saves it to disk:

```ts
// Node.js-only implementation — hard-wired to node:fs and node:https
import { createWriteStream } from "node:fs"
import { get } from "node:https"
import { pipeline } from "node:stream/promises"

async function fetchAndSave(url: string, dest: string): Promise<void> {
  const response = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`))
      else resolve(res)
    }).on("error", reject)
  })
  await pipeline(response, createWriteStream(dest))
}
```

This function cannot run in a browser — `node:fs` and `node:https` do not exist there. It cannot run in Bun without checking whether Bun's Node.js compatibility layer covers `pipeline`. Unit-testing it requires the real filesystem or a fragile `jest.mock("node:fs")` patch. If you are writing a library that other developers will use, you must either ship three divergent implementations or pick one runtime and exclude everyone else.

The pattern compounds. HTTP client, file system access, subprocess spawning, terminal interaction — each surface has the same N-way fork. Without a shared abstraction layer, every IO-touching library in the ecosystem faces this choice.

`@effect/platform` is that abstraction layer. It declares every IO-touching service as a typed `Tag`-keyed interface with no concrete runtime dependency. Application code programs against `FileSystem.FileSystem`, `HttpClient.HttpClient`, `CommandExecutor.CommandExecutor` — the same way it yields any other Effect service from Chapter 08. The concrete implementation (`platform-node`, `platform-bun`, `platform-browser`) is injected as a `Layer` at the program's entry point, exactly as described in Chapter 09. The business logic never changes when the runtime changes.

---

## The minimal example

The simplest entry point is `HttpClient`. The abstract tag defines the interface; an implementation layer supplies it. Here the `FetchHttpClient.layer` — a portable layer bundled in `@effect/platform` itself and backed by `globalThis.fetch` — provides the implementation:

```ts
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform"
import { Console, Effect } from "effect"

// fetchAndLog requires HttpClient from the environment — no concrete import
const fetchAndLog = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://api.github.com/zen")
  const text = yield* response.text
  yield* Console.log("GitHub says:", text)
})

// Provide the fetch-backed implementation and run
Effect.runPromise(
  fetchAndLog.pipe(
    Effect.provide(FetchHttpClient.layer)
  )
)
```

`HttpClient.HttpClient` is a `Context.Tag` — yielding it retrieves the live service from the current Layer graph. The handler (`client.get(...)`) returns an `Effect<HttpClientResponse, HttpClientError, never>`, so the error channel is typed and catchable. Nothing here imports `node:http` or references `Bun.fetch`; swapping `FetchHttpClient.layer` for `NodeHttpClient.layer` (from `@effect/platform-node`, covered in Chapter 23) requires changing one line at the program boundary, not touching the business logic.

---

## Tour

`@effect/platform` groups its exports across roughly four responsibility areas: HTTP client and server, OS-level IO, typed API contracts, and the worker subsystem. All of them follow the same discipline: declare an interface, export a `Tag`, let callers inject implementations as `Layer`s.

### HTTP client

`HttpClient` (`repos/effect/packages/platform/src/HttpClient.ts:1-106`) is the abstract HTTP client interface. The `HttpClient.With<E, R>` interface at line 48 defines `execute`, `get`, `post`, `put`, `patch`, `del`, `head`, and `options` — all returning `Effect<HttpClientResponse, E, R>`. The `HttpClient` tag at line 105 is the `Context.Tag<HttpClient, HttpClient>` that callers yield:

```ts
/**
 * @since 1.0.0
 * @category tags
 */
export const HttpClient: Context.Tag<HttpClient, HttpClient> = internal.tag
// repos/effect/packages/platform/src/HttpClient.ts:105
```

`HttpClientRequest` and `HttpClientResponse` are the typed value types for requests and responses. `HttpClientError` holds the typed failure (`ResponseError` with status code, `RequestError` for network failures). The client is `Pipeable` — you can attach middleware with `.pipe(HttpClient.filterStatusOk)` to promote non-2xx responses into the error channel.

`FetchHttpClient` (`repos/effect/packages/platform/src/FetchHttpClient.ts:1-26`) is the one concrete implementation bundled in the abstract package itself — because `globalThis.fetch` is available on all three runtimes. Its `layer` provides `HttpClient`; its `Fetch` and `RequestInit` tags allow overriding the underlying fetch function and default options.

### HTTP server

`HttpServer` (`repos/effect/packages/platform/src/HttpServer.ts:1-91`) is the abstract server tag. The interface has a single `serve` method that takes an `HttpApp.Default<E, R>` (an `Effect` from `HttpServerRequest` to `HttpServerResponse`) and returns `Effect<void, never, Exclude<R, HttpServerRequest> | Scope>`. The `Address` type is a discriminated union of `TcpAddress` and `UnixAddress` — the server implementation reports which address it is listening on.

`HttpRouter` (`repos/effect/packages/platform/src/HttpRouter.ts:1-59`) is the immutable typed router. `HttpRouter<E, R>` holds a `Chunk<Route<E, R>>` and a list of mounts. Routes add `RouteContext` — containing path parameters and matched route info — to the handler's environment. The underlying route matching uses `find-my-way-ts`, a portable TypeScript port of the Fastify router, declared as a direct `dependency` in `package.json` so it works without native bindings.

`HttpMiddleware` provides structural `HttpApp -> HttpApp` transforms for logging, CORS, `x-forwarded-for` header propagation, basic auth, and static file serving.

### HttpApi — contract-first API design

`HttpApi` (`repos/effect/packages/platform/src/HttpApi.ts:46-74`) is the highest-level abstraction for HTTP in the package. A single `HttpApi` value becomes simultaneously the source of truth for routing, OpenAPI documentation, and a derived typed client. Phantom type parameters `HttpApi<Id, Groups, E, R>` accumulate every group, error variant, and context requirement at compile time:

```ts
/**
 * An `HttpApi` is a collection of `HttpApiEndpoint`s.
 *
 * @since 1.0.0
 * @category models
 */
export interface HttpApi<
  out Id extends string,
  out Groups extends HttpApiGroup.HttpApiGroup.Any = never,
  in out E = never,
  out R = never
> extends Pipeable {
  // ...
  add<A extends HttpApiGroup.HttpApiGroup.Any>(group: A): HttpApi<Id, Groups | A, E, R>
}
// repos/effect/packages/platform/src/HttpApi.ts:46-74
```

`HttpApiGroup` collects a named set of endpoints; `HttpApiEndpoint` declares method, path, payload schema, and response schema. `HttpApiBuilder.api` turns the whole declaration into a `Layer` — if any handler service is missing, the program fails to compile. `HttpApiClient` derives a fully-typed, Effect-returning client from the same definition. `HttpApiSwagger` and `HttpApiScalar` serve OpenAPI UI from the same definition.

### Filesystem and paths

`FileSystem` (`repos/effect/packages/platform/src/FileSystem.ts:456-460`) is the abstract filesystem tag. The interface covers `readFile`, `writeFile`, `open` (returning a scoped `File` handle), `makeDirectory`, `makeTempDirectoryScoped`, `readDirectory`, `watch` (returning `Stream<WatchEvent, PlatformError>`), and POSIX helpers. The `FileSystem.make` constructor at line 466 accepts an `Omit<FileSystem, "exists" | "readFileString" | "stream" | "sink" | "writeFileString">` — derived methods are computed from the primitives, so implementation authors supply only the irreducible surface.

Errors across all IO modules flow through two `Schema.TaggedError` classes from `repos/effect/packages/platform/src/Error.ts:65-138` (see Chapter 14 for `Schema.TaggedError`): `BadArgument` (programmer error, wrong input) and `SystemError` (OS failure with a `SystemErrorReason` discriminant — `NotFound`, `PermissionDenied`, `TimedOut`, etc.). Both carry a `module` field from the `Module` literal union at line 55 — `"FileSystem"`, `"Command"`, `"Terminal"`, and so on — enabling `Effect.catchTag("SystemError", ...)` uniformly across all IO operations.

`Path` (`repos/effect/packages/platform/src/Path.ts:66-77`) is the path-manipulation service. The `Path` tag and a default POSIX `layer` are bundled in the abstract package — unlike `FileSystem`, path manipulation is portable enough to run in browsers. Methods that can fail (`fromFileUrl`, `toFileUrl`) return `Effect<..., BadArgument>` rather than throwing.

### Subprocess

`Command` (`repos/effect/packages/platform/src/Command.ts:1-72`) is a pure value-level description of a process invocation — a `StandardCommand | PipedCommand` union carrying the executable name, arguments, environment, working directory, and IO configuration. `CommandInput` is `"inherit" | "pipe" | Stream<Uint8Array, PlatformError>` — stdin can be fed from an Effect `Stream`, unifying subprocess orchestration with all other streaming combinators (see Chapter 16).

**Name collision note:** This `Command` type lives in `@effect/platform` and describes a subprocess invocation. It is entirely distinct from the `Command` type in `@effect/cli` (covered in Chapter 19), which describes a command-line argument tree. If you use both packages, always import them with their package namespace — `import { Command } from "@effect/platform"` for subprocess work and `import { Command } from "@effect/cli"` for CLI argument parsing — and keep the usages in separate modules.

`CommandExecutor` (`repos/effect/packages/platform/src/CommandExecutor.ts:31-70`) is the `Tag`-keyed service that runs `Command` values. Its interface provides `exitCode`, `start` (scoped `Process` handle), `string`, `lines`, `stream`, and `streamLines` — the latter two return `Stream<Uint8Array | string, PlatformError>`. The `CommandExecutor` tag at line 70 is what callers yield; the concrete implementation is provided by `platform-node` or `platform-bun` (see Chapter 23).

### Terminal and key-value store

`Terminal` (`repos/effect/packages/platform/src/Terminal.ts:14-105`) is the interactive terminal service interface. It exposes `columns`, `rows`, `isTTY`, `readInput` (returns `ReadonlyMailbox<UserInput>` scoped to a `Scope`), `readLine`, and `display`. `QuitException` is the typed error emitted when the user presses `Ctrl+C` during `readLine`. The `Terminal` tag at line 105 is what callers yield.

`KeyValueStore` (`repos/effect/packages/platform/src/KeyValueStore.ts:1-160`) is a generic string/bytes KV interface. The `KeyValueStore` tag at line 110 provides `get`, `getUint8Array`, `set`, `remove`, `clear`, `size`, `modify`, `has`, `isEmpty`, and `forSchema` — the last derives a typed `SchemaStore<A, R>` from a `Schema` value. Three built-in layers are provided: `layerMemory` (in-process map), `layerFileSystem` (file-backed, requires `FileSystem & Path`), and `layerStorage` (browser `localStorage`, from `platform-browser`). The `prefix` combinator at line 136 is dual — both `prefix(store, "ns:")` and `store.pipe(prefix("ns:"))` work.

### The internal/ folder pattern

Every file examined above follows the same structural split: the public module declares the interface, exports the tag, and delegates every implementation value to `./internal/<module>.js`. For example, in `HttpClient.ts`:

```ts
import * as internal from "./internal/httpClient.js"

export const TypeId: unique symbol = internal.TypeId
export const HttpClient: Context.Tag<HttpClient, HttpClient> = internal.tag
// repos/effect/packages/platform/src/HttpClient.ts:20-26 and :105
```

And in `FileSystem.ts`:

```ts
import * as internal from "./internal/fileSystem.js"

export const FileSystem: Tag<FileSystem, FileSystem> = internal.tag
export const make: (...) => FileSystem = internal.make
// repos/effect/packages/platform/src/FileSystem.ts:15-16 and :460-468
```

Inside `internal/httpClient.ts` the declarations carry `/** @internal */` JSDoc tags. The TypeScript build option `"stripInternal": true` in `tsconfig.build.json` strips those declarations from the emitted `.d.ts` files — they never appear in the public type surface of the published package.

The enforcing mechanism is the exports map in `repos/effect/packages/platform/package.json:32-37`:

```ts
// repos/effect/packages/platform/package.json:32-37
{
  "exports": {
    "./package.json": "./package.json",
    ".": "./src/index.ts",
    "./*": "./src/*.ts",
    "./internal/*": null
  }
}
```

The `"./internal/*": null` line causes Node.js's ESM resolver and bundlers to throw when a consumer tries to import from that path — even in development. The `docgen.json` excludes `src/internal/**/*.ts` from documentation generation, and `tsconfig.build.json` strips `@internal` from emitted `.d.ts` output, so the seal operates at three independent levels.

The `src/index.ts` barrel at `repos/effect/packages/platform/src/index.ts:1-14` re-exports every public module using the namespace form:

```ts
/**
 * @since 1.0.0
 */
export * as ChannelSchema from "./ChannelSchema.js"

/**
 * @since 1.0.0
 */
export * as Command from "./Command.js"

/**
 * @since 1.0.0
 */
export * as CommandExecutor from "./CommandExecutor.js"
// ...
```

This is the pattern introduced in this chapter and cataloged at [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape). The split gives the package two independent guarantees: consumers get a stable public contract (the public modules) and implementation authors get the freedom to refactor internals without breaking that contract.

---

## A production example

The following function is platform-portable: it fetches a remote URL, writes the body to disk, and logs progress. It depends on three abstract tags — `HttpClient`, `FileSystem`, and `Path` — and never imports a runtime-specific module. The same function body runs on Node.js, Bun, or in a browser (where `FileSystem` would be backed by OPFS), because the caller injects the right `Layer` at the entry point.

```ts
import {
  FileSystem,
  HttpClient,
  HttpClientRequest,
  Path
} from "@effect/platform"
import { Console, Effect, Layer } from "effect"

// ---- platform-portable business logic ----

const downloadToFile = (url: string, filename: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    // Resolve an absolute path using the abstract Path service
    const outDir = yield* path.fromFileUrl(new URL("./downloads/", import.meta.url))
      .pipe(Effect.orElse(() => Effect.succeed("./downloads")))
    const outPath = path.join(outDir, filename)

    yield* Console.log(`Fetching ${url}`)

    // Fetch the remote URL — HttpClient returns a typed response
    const response = yield* client.get(url).pipe(
      Effect.mapError((e) => new Error(`HTTP error: ${e.message}`))
    )

    // Read the response body as bytes
    const body = yield* response.arrayBuffer.pipe(
      Effect.map((buf) => new Uint8Array(buf)),
      Effect.mapError((e) => new Error(`Body error: ${e.message}`))
    )

    // Write to disk — FileSystem returns typed PlatformError on failure
    yield* fs.makeDirectory(outDir, { recursive: true }).pipe(
      Effect.ignore
    )
    yield* fs.writeFile(outPath, body)

    yield* Console.log(`Saved ${body.byteLength} bytes to ${outPath}`)
    return outPath
  })

// ---- entry point: swap this Layer for @effect/platform-node, -bun, or -browser ----
// On Node.js this would be:
//   import { NodeFileSystem, NodePath } from "@effect/platform-node"
//   import { FetchHttpClient } from "@effect/platform"
//   const platformLayer = Layer.mergeAll(
//     NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer
//   )
//
// On Bun:
//   import { BunFileSystem, BunPath } from "@effect/platform-bun"
//   const platformLayer = Layer.mergeAll(
//     BunFileSystem.layer, BunPath.layer, FetchHttpClient.layer
//   )

// For this example, use the portable FetchHttpClient and a mock FileSystem
import { FetchHttpClient } from "@effect/platform"

const program = downloadToFile(
  "https://api.github.com/zen",
  "zen.txt"
)

// Run once you have a full platformLayer injected:
// Effect.runPromise(program.pipe(Effect.provide(platformLayer)))
```

Notice that `downloadToFile` has no `import` from `@effect/platform-node`. Its only runtime dependency is the three tags it yields. Testing it is straightforward: provide `FileSystem.layerNoop(...)` and a mock `HttpClient` layer instead of the real implementations, and the test runs in-process with no disk access or network calls. This is the central promise of the abstract platform layer — the dependency injection point is the `Layer` graph, not the function's import list.

---

## Variations

**`KeyValueStore` with a schema:** The `forSchema` method wraps raw bytes in a typed store. Useful for persisting structured data with decode/encode handled automatically:

```ts
import { KeyValueStore } from "@effect/platform"
import { Schema } from "effect"

const UserSchema = Schema.Struct({ id: Schema.Number, name: Schema.String })

const typedStore = Effect.gen(function* () {
  const kv = yield* KeyValueStore.KeyValueStore
  const users = kv.forSchema(UserSchema)
  yield* users.set("user:1", { id: 1, name: "Alice" })
  const alice = yield* users.get("user:1") // Effect<Option<{id:number,name:string}>, ...>
  return alice
})
```

**`Terminal` for interactive prompts:** Yield `Terminal` to read user input without polling `process.stdin` directly. Works on any runtime that provides the `Terminal` layer:

```ts
import { Terminal } from "@effect/platform"
import { Console, Effect } from "effect"

const prompt = Effect.gen(function* () {
  const term = yield* Terminal.Terminal
  yield* term.display("Enter your name: ")
  const name = yield* term.readLine
  yield* Console.log(`Hello, ${name}!`)
})
```

**`Command` for subprocess output as a Stream:** Feed the stdout of a subprocess into any Effect `Stream` combinator. Note this uses `@effect/platform`'s `Command`, not `@effect/cli`'s:

```ts
import { Command, CommandExecutor } from "@effect/platform"
import { Effect, Stream } from "effect"

const grepLines = (pattern: string) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor
    const cmd = Command.make("grep", "-r", pattern, "src/")
    return executor.streamLines(cmd) // Stream<string, PlatformError>
  })
```

**`HttpApi` for contract-first APIs:** Define the API shape once; derive the router, OpenAPI docs, and a typed client from it. See the subsection in the Tour above for the phantom-type accumulation pattern at `repos/effect/packages/platform/src/HttpApi.ts:46-74`.

**`PlatformConfigProvider.fromFileTree`:** Reads Effect `Config` values from a directory tree — useful for Kubernetes ConfigMap mounts where each key is a file. `repos/effect/packages/platform/src/PlatformConfigProvider.ts:25-40`.

**`Worker` and `WorkerPool` for CPU-bound offloading:** `Worker<I, O, E>` wraps a background thread; `WorkerPool` wraps `Pool.Pool<Worker, WorkerError>` (see the Pool pattern introduced in Chapter 23). `Worker.execute` returns `Stream<O, E | WorkerError>`, so results stream back through the same combinators as any other Effect stream.

---

## Anti-patterns

**Importing `node:fs` directly in business logic:**

```ts
// Wrong — couples business logic to Node.js
import { readFileSync } from "node:fs"

function loadConfig(path: string) {
  return JSON.parse(readFileSync(path, "utf8"))
}
```

```ts
// Correct — use the abstract FileSystem tag
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

const loadConfig = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(path)
    return JSON.parse(text) as unknown
  })
```

The correct version is testable with `FileSystem.layerNoop(...)`, portable across runtimes, and typed — `fs.readFileString` returns `Effect<string, PlatformError>` so errors appear in the type.

**Importing `@effect/platform-node` deep paths in shared library code:**

```ts
// Wrong — a shared library that imports a concrete platform
import { NodeFileSystem } from "@effect/platform-node"

export function myLibraryFn() {
  return Effect.provide(doWork(), NodeFileSystem.layer)
}
```

A library that hard-codes `NodeFileSystem.layer` cannot be used in Bun or browser environments. Shared libraries should declare their requirements as `Tag`-keyed services and let the application entry point provide the layer. Only `app/main.ts` (or its Bun or browser equivalent) should reference `@effect/platform-node`.

**Importing from `@effect/platform/internal/*`:**

```ts
// Wrong — internal paths are sealed
import { make } from "@effect/platform/internal/httpClient"
```

The `"./internal/*": null` entry in `repos/effect/packages/platform/package.json:36` causes this import to throw at resolution time. Internal modules are not part of the public API and can change without a version bump. Use the namespaced public API — `HttpClient.HttpClient`, `HttpClient.execute`, and so on — from `@effect/platform`.

**Dropping Effects inside service calls:**

```ts
// Wrong — fire-and-forget inside Effect.gen loses error propagation
const bad = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  fs.writeFile("out.txt", new Uint8Array([1, 2, 3])) // not yielded — error is lost
})
```

`writeFile` returns an `Effect` — not yielding it means the write is never executed. Always `yield*` effectful operations inside `Effect.gen`.

---

## See also

- [Chapter 09 — Layer: building, merging, and providing services](../part-1-foundations/09-layer.md) — the injection mechanism that makes the abstract platform layer composable; `Layer.provide`, `Layer.merge`, and `Layer.mergeAll` are how the platform layer is assembled at the entry point.
- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md) — `Schema.TaggedError` is the base for `BadArgument` and `SystemError`; `HttpApiEndpoint` uses `Schema.Schema` for typed request/response bodies.
- [Chapter 16 — Stream: pull-based async iteration](../part-1-foundations/16-stream.md) — `FileSystem.watch`, `CommandExecutor.stream`, `CommandExecutor.streamLines`, and `Worker.execute` all return `Stream<..., PlatformError>`. The Stream combinators from Chapter 16 compose directly with platform IO.
- [Chapter 23 — Platform on Node.js](23-platform-node.md) — provides `NodeFileSystem.layer`, `NodeHttpClient.layer`, `NodeHttpServer.layer`, and `NodeCommandExecutor.layer`; introduces the `Pool` pattern for connection management.
- [Chapter 24 — Platform on Bun and the browser](24-platform-bun-browser.md) — `@effect/platform-bun` and `@effect/platform-browser` implementations; introduces the `RcRef` / `RcMap` pattern for reference-counted resources.
- [Chapter 25 — SQL part 1: the @effect/sql abstraction layer](25-sql-core.md) — `@effect/sql` follows the same contract-first discipline as `@effect/platform`; `SqlClient` is a `Tag`-keyed service, implementations are swapped via `Layer`.
- [Patterns catalog — The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — the catalog entry for the pattern introduced in this chapter.
- [Per-package research note — @effect/platform](../../research/packages/platform.md) — extended API surface notes, open questions on `ChannelSchema`, `HttpLayerRouter` vs `HttpRouter`, and the `FetchHttpClient` portability criterion.
